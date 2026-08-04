import * as functions from 'firebase-functions/v1'
import * as admin from 'firebase-admin'
import * as deepl from 'deepl-node'

if (!admin.apps.length) admin.initializeApp()
const db = admin.database()
const firestore = admin.firestore()

// Map our internal language codes to DeepL target language codes
const LANG_MAP: Record<string, deepl.TargetLanguageCode> = {
  es: 'es',
  pt: 'pt-BR',
  fr: 'fr',
}

/**
 * RTDB Trigger — fires when a new transcript chunk is written to
 * /liveSessions/{sessionId}/chunks/{chunkId}
 *
 * Only processes finalized (isFinalized: true) chunks to avoid wasting API calls
 * on mid-word partial transcripts from Recall.AI.
 *
 * Fans out to DeepL in parallel for each Show defaultLanguages target (minus en).
 * Writes successful translations back to the same RTDB chunk node. Per-language
 * failures are skipped + logged — English text stays available; attendees on the
 * failed language simply omit that line.
 *
 * Respects show-level deepLGlossaryIds by looking up session → show.
 */
export const onTranscriptChunk = functions.database
  .ref('/liveSessions/{sessionId}/chunks/{chunkId}')
  .onCreate(async (snapshot, context) => {
    const chunk = snapshot.val()
    const { sessionId, chunkId } = context.params

    // Only translate finalized chunks
    if (!chunk.isFinalized) {
      functions.logger.debug('onTranscriptChunk: skipping non-final chunk', { chunkId, sessionId })
      return null
    }

    const sourceText = typeof chunk.text === 'string' ? chunk.text.trim() : ''
    if (!sourceText) {
      functions.logger.debug('onTranscriptChunk: skipping empty text', { chunkId, sessionId })
      return null
    }

    const apiKey = process.env.DEEPL_API_KEY
    if (!apiKey) {
      functions.logger.error('onTranscriptChunk: DEEPL_API_KEY not set', { chunkId, sessionId })
      return null
    }

    const translator = new deepl.Translator(apiKey)

    // ── Resolve show's DeepL glossary IDs + defaultLanguages
    let deepLGlossaryIds: Record<string, string> = {}
    let defaultLanguages: string[] = []
    try {
      const sessionsQuery = await firestore
        .collectionGroup('sessions')
        .where(admin.firestore.FieldPath.documentId(), '==', sessionId)
        .limit(1)
        .get()

      if (!sessionsQuery.empty) {
        const sessionRef = sessionsQuery.docs[0].ref
        const showRef = sessionRef.parent.parent
        if (showRef) {
          const showSnap = await showRef.get()
          const showData = showSnap.data() ?? {}
          deepLGlossaryIds = showData.deepLGlossaryIds ?? {}
          defaultLanguages = Array.isArray(showData.defaultLanguages)
            ? showData.defaultLanguages.filter((l: unknown): l is string => typeof l === 'string')
            : []
        }
      } else {
        functions.logger.warn('onTranscriptChunk: session not found for glossary/languages', {
          chunkId,
          sessionId,
        })
      }
    } catch (err) {
      functions.logger.warn('onTranscriptChunk: could not resolve show config', {
        chunkId,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Targets = Show defaultLanguages minus en, limited to known DeepL map keys
    const targetLangs = defaultLanguages.filter(
      (lang) => lang !== 'en' && Object.prototype.hasOwnProperty.call(LANG_MAP, lang),
    )

    if (targetLangs.length === 0) {
      functions.logger.info('onTranscriptChunk: no target languages — skipping DeepL', {
        chunkId,
        sessionId,
        defaultLanguages,
      })
      return null
    }

    // ── Fan out DeepL calls in parallel
    const translationResults = await Promise.allSettled(
      targetLangs.map(async (langKey) => {
        const deeplLang = LANG_MAP[langKey]
        const langPairKey = `en-${langKey}`
        const glossaryId = deepLGlossaryIds[langPairKey]

        const result = await translator.translateText(
          sourceText,
          'en' as deepl.SourceLanguageCode,
          deeplLang,
          {
            glossary: glossaryId ?? undefined,
          },
        )
        const translation = Array.isArray(result) ? result[0]?.text : result.text
        if (!translation) {
          throw new Error('DeepL returned empty translation')
        }
        return { langKey, translation }
      }),
    )

    // ── Build translations object — skip + log per-language failures
    const translations: Record<string, string> = {}
    for (let i = 0; i < translationResults.length; i++) {
      const result = translationResults[i]
      const langKey = targetLangs[i]
      if (result.status === 'fulfilled') {
        translations[result.value.langKey] = result.value.translation
      } else {
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason ?? 'unknown error')
        functions.logger.error('onTranscriptChunk: translation failed — skipping language', {
          chunkId,
          sessionId,
          language: langKey,
          error: reason,
        })
      }
    }

    // ── Write translations back to RTDB chunk (partial OK)
    await db.ref(`/liveSessions/${sessionId}/chunks/${chunkId}/translations`).set(translations)
    functions.logger.info('onTranscriptChunk: translations written', {
      chunkId,
      sessionId,
      languages: Object.keys(translations),
      skipped: targetLangs.filter((l) => !translations[l]),
    })

    return null
  })
