import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import * as deepl from 'deepl-node'

if (!admin.apps.length) admin.initializeApp()
const firestore = admin.firestore()

interface SyncGlossaryRequest {
  showId: string
}

// Language pairs to register (source always English)
const LANG_PAIRS: Array<{ source: deepl.SourceLanguageCode; target: deepl.TargetLanguageCode; fieldKey: string }> = [
  { source: 'en', target: 'es',    fieldKey: 'en-es' },
  { source: 'en', target: 'pt-BR', fieldKey: 'en-pt' },
  { source: 'en', target: 'fr',    fieldKey: 'en-fr' },
]

/**
 * Callable Cloud Function — triggered by admin "Sync Glossary to DeepL" button.
 *
 * Reads the show's glossary array from Firestore, creates or replaces a DeepL
 * registered glossary per language pair, and writes the returned glossary IDs
 * back to the show document as deepLGlossaryIds: { 'en-es': '...', ... }.
 *
 * Note: DeepL requires both source and target terms to be non-empty.
 * Glossary entries with missing translations for a language are skipped for that pair.
 *
 * Test validation: "ALPFA Militia" should be present as a test term to confirm
 * correct passthrough in translation requests.
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
  const showSnap = await showRef.get()
  if (!showSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Show not found')
  }

  const showData = showSnap.data()!
  const glossaryEntries: Array<{
    term: string
    translations: { es?: string; pt?: string; fr?: string }
  }> = showData.glossary ?? []

  if (glossaryEntries.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Show has no glossary entries')
  }

  const translator = new deepl.Translator(apiKey)
  const showName = (showData.name ?? showId).replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 40)

  const langKeyMap: Record<string, 'es' | 'pt' | 'fr'> = {
    'en-es': 'es',
    'en-pt': 'pt',
    'en-fr': 'fr',
  }

  const newGlossaryIds: Record<string, string> = {}

  // ── 4. Register glossary per language pair
  await Promise.all(
    LANG_PAIRS.map(async ({ source, target, fieldKey }) => {
      const translationKey = langKeyMap[fieldKey]
      const entries = glossaryEntries
        .filter(e => e.translations[translationKey])
        .map(e => ({ source: e.term, target: e.translations[translationKey]! }))

      if (entries.length === 0) {
        functions.logger.warn('syncDeepLGlossary: no entries for pair', { fieldKey })
        return
      }

      const glossaryName = `onda-${showName}-${fieldKey}`

      // Delete existing glossary with same name if it exists
      try {
        const existing = await translator.listGlossaries()
        const match = existing.find(g => g.name === glossaryName)
        if (match) await translator.deleteGlossary(match.glossaryId)
      } catch (err) {
        functions.logger.warn('syncDeepLGlossary: could not clean up old glossary', err)
      }

      const glossary = await translator.createGlossary(
        glossaryName,
        source,
        target,
        new deepl.GlossaryEntries({ entries })
      )

      newGlossaryIds[fieldKey] = glossary.glossaryId
      functions.logger.info('syncDeepLGlossary: glossary created', {
        fieldKey,
        glossaryId: glossary.glossaryId,
        entryCount: entries.length,
      })
    })
  )

  // ── 5. Write glossary IDs back to Firestore show doc
  await showRef.update({ deepLGlossaryIds: newGlossaryIds })

  // ── 6. Audit log
  await firestore.collection('auditLog').add({
    action: 'GLOSSARY_SYNCED',
    performedBy: context.auth.uid,
    performedAt: admin.firestore.FieldValue.serverTimestamp(),
    showId,
    metadata: { newGlossaryIds, entryCount: glossaryEntries.length },
  })

  return { ok: true, glossaryIds: newGlossaryIds }
})
