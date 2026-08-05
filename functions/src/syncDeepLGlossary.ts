import * as functions from 'firebase-functions/v1'
import * as admin from 'firebase-admin'
import * as deepl from 'deepl-node'

if (!admin.apps.length) admin.initializeApp()
const firestore = admin.firestore()

interface SyncGlossaryRequest {
  showId: string
}

// Language pairs to register (source always English)
const LANG_PAIRS: Array<{
  source: deepl.SourceLanguageCode
  target: deepl.TargetLanguageCode
  fieldKey: string
}> = [
  { source: 'en', target: 'es', fieldKey: 'en-es' },
  { source: 'en', target: 'pt-BR', fieldKey: 'en-pt' },
  { source: 'en', target: 'fr', fieldKey: 'en-fr' },
]

/**
 * Callable Cloud Function — triggered by admin glossary editor Save.
 *
 * Reads the show's glossary array from Firestore, creates or replaces a DeepL
 * registered glossary per language pair, and writes the returned glossary IDs
 * back to the show document as deepLGlossaryIds: { 'en-es': '...', ... }.
 *
 * Also maintains backend-only sync status fields:
 *   glossarySyncStatus / glossarySyncError / glossarySyncedAt
 *
 * Note: DeepL requires both source and target terms to be non-empty.
 * Blank language fields default to the English `term` (Term is the anchor spelling).
 */
export const syncDeepLGlossary = functions.https.onCall(async (data: SyncGlossaryRequest, context) => {
  // ── 1. Auth check
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required')
  }

  const { showId } = data
  if (!showId) {
    throw new functions.https.HttpsError('invalid-argument', 'showId required')
  }

  // ── 2. Permission check — admin or editor only
  const userDoc = await firestore.collection('users').doc(context.auth.uid).get()
  if (!userDoc.exists) {
    throw new functions.https.HttpsError('permission-denied', 'User not found')
  }
  const { baseRole } = userDoc.data() as { baseRole: string }
  if (!['admin', 'editor'].includes(baseRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions')
  }

  const apiKey = process.env.DEEPL_API_KEY
  if (!apiKey) {
    throw new functions.https.HttpsError('internal', 'DEEPL_API_KEY not configured')
  }

  // ── 3. Load show glossary
  const showRef = firestore.collection('shows').doc(showId)

  await showRef.update({
    glossarySyncStatus: 'syncing',
    glossarySyncError: null,
  })

  try {
    const showSnap = await showRef.get()
    if (!showSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Show not found')
    }

    const showData = showSnap.data()!
    const glossaryEntries: Array<{
      term: string
      translations: { es?: string; pt?: string; fr?: string }
    }> = showData.glossary ?? []

    const translator = new deepl.Translator(apiKey)
    const showName = (showData.name ?? showId).replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 40)

    const langKeyMap: Record<string, 'es' | 'pt' | 'fr'> = {
      'en-es': 'es',
      'en-pt': 'pt',
      'en-fr': 'fr',
    }

    // Empty glossary → clear DeepL IDs (no terms to register)
    if (glossaryEntries.length === 0) {
      await showRef.update({
        deepLGlossaryIds: {},
        glossarySyncStatus: 'idle',
        glossarySyncError: null,
        glossarySyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      })

      await firestore.collection('auditLog').add({
        action: 'GLOSSARY_SYNCED',
        performedBy: context.auth.uid,
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
        showId,
        metadata: { newGlossaryIds: {}, entryCount: 0, cleared: true },
      })

      return { ok: true, glossaryIds: {} }
    }

    const newGlossaryIds: Record<string, string> = {}
    const pairErrors: Array<{ fieldKey: string; error: string }> = []

    // ── 4. Register glossary per language pair
    await Promise.all(
      LANG_PAIRS.map(async ({ source, target, fieldKey }) => {
        const translationKey = langKeyMap[fieldKey]
        // Blank translation → default to English term (Term is the anchor spelling).
        const entries = glossaryEntries
          .filter((e) => e.term?.trim())
          .map((e) => {
            const source = e.term.trim()
            const rawTarget = e.translations?.[translationKey]?.trim() ?? ''
            return {
              source,
              target: rawTarget || source,
            }
          })

        if (entries.length === 0) {
          functions.logger.warn('syncDeepLGlossary: no entries for pair', { fieldKey, showId })
          return
        }

        const glossaryName = `onda-${showName}-${fieldKey}`

        try {
          // Delete existing glossary with same name if it exists
          try {
            const existing = await translator.listGlossaries()
            const match = existing.find((g) => g.name === glossaryName)
            if (match) await translator.deleteGlossary(match.glossaryId)
          } catch (err) {
            functions.logger.warn('syncDeepLGlossary: could not clean up old glossary', {
              fieldKey,
              showId,
              error: err instanceof Error ? err.message : String(err),
            })
          }

          const entriesRecord: Record<string, string> = {}
          for (const e of entries) {
            entriesRecord[e.source] = e.target
          }

          const glossary = await translator.createGlossary(
            glossaryName,
            source,
            target,
            new deepl.GlossaryEntries({ entries: entriesRecord }),
          )

          newGlossaryIds[fieldKey] = glossary.glossaryId
          functions.logger.info('syncDeepLGlossary: glossary created', {
            fieldKey,
            glossaryId: glossary.glossaryId,
            entryCount: entries.length,
            showId,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          pairErrors.push({ fieldKey, error: message })
          functions.logger.error('syncDeepLGlossary: pair failed', {
            fieldKey,
            showId,
            error: message,
          })
        }
      }),
    )

    if (pairErrors.length > 0 && Object.keys(newGlossaryIds).length === 0) {
      const message = pairErrors.map((e) => `${e.fieldKey}: ${e.error}`).join('; ')
      await showRef.update({
        glossarySyncStatus: 'error',
        glossarySyncError: message,
      })
      throw new functions.https.HttpsError('internal', `Glossary sync failed: ${message}`)
    }

    // ── 5. Write glossary IDs + success status back to Firestore show doc
    // Merge with any prior IDs for pairs that had no entries this run (keep last good),
    // but replace pairs we successfully recreated; drop pairs that now have zero entries.
    const previousIds: Record<string, string> = showData.deepLGlossaryIds ?? {}
    const mergedIds: Record<string, string> = { ...previousIds }

    for (const { fieldKey } of LANG_PAIRS) {
      const hasEntries = glossaryEntries.some((e) => e.term?.trim())
      if (newGlossaryIds[fieldKey]) {
        mergedIds[fieldKey] = newGlossaryIds[fieldKey]
      } else if (!hasEntries) {
        delete mergedIds[fieldKey]
      }
      // If hasEntries but create failed, leave previous ID (going-forward best-effort)
    }

    const statusError =
      pairErrors.length > 0
        ? pairErrors.map((e) => `${e.fieldKey}: ${e.error}`).join('; ')
        : null

    await showRef.update({
      deepLGlossaryIds: mergedIds,
      glossarySyncStatus: statusError ? 'error' : 'idle',
      glossarySyncError: statusError,
      glossarySyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // ── 6. Audit log
    await firestore.collection('auditLog').add({
      action: 'GLOSSARY_SYNCED',
      performedBy: context.auth.uid,
      performedAt: admin.firestore.FieldValue.serverTimestamp(),
      showId,
      metadata: {
        newGlossaryIds: mergedIds,
        entryCount: glossaryEntries.length,
        pairErrors,
      },
    })

    if (statusError) {
      // Partial success — still return ok with warning so admin Save can complete
      functions.logger.warn('syncDeepLGlossary: partial sync', { showId, statusError })
    }

    return { ok: true, glossaryIds: mergedIds, partialError: statusError }
  } catch (err) {
    const message =
      err instanceof functions.https.HttpsError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err)

    if (!(err instanceof functions.https.HttpsError)) {
      functions.logger.error('syncDeepLGlossary: unexpected failure', { showId, error: message })
    }

    try {
      await showRef.update({
        glossarySyncStatus: 'error',
        glossarySyncError: message,
      })
    } catch {
      /* ignore secondary write failure */
    }

    if (err instanceof functions.https.HttpsError) throw err
    throw new functions.https.HttpsError('internal', message)
  }
})
