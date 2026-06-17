import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import * as deepl from 'deepl-node'

if (!admin.apps.length) admin.initializeApp()
const db = admin.database()
const firestore = admin.firestore()

const SUPPORTED_TARGET_LANGS: deepl.TargetLanguageCode[] = ['es', 'pt-BR', 'fr']

// Map our internal language codes to DeepL target language codes
const LANG_MAP: Record<string, deepl.TargetLanguageCode> = {
  es: 'es',
  pt: 'pt-BR',
  fr: 'fr',
}

// Map language pairs to firestore field keys
const LANG_FIELD: Record<string, string> = {
  es: 'es',
  pt: 'pt',
  fr: 'fr',
}

/**
 * RTDB Trigger — fires when a new transcript chunk is written to
 * /liveSessions/{sessionId}/chunks/{chunkId}
 *
 * Only processes finalized (isFinal: true) chunks to avoid wasting API calls
 * on mid-word partial transcripts from Recall.AI.
 *
 * Fans out to DeepL in parallel for each target language. Writes translations
 * back to the same RTDB chunk node. Respects the show-level DeepL glossary IDs
 * by looking up the session → show → deepLGlossaryIds.
 *
 * Test term: "ALPFA Militia" should pass through unchanged if present in glossary.
 */
export const onTranscriptChunk = functions.database
  .ref('/liveSessions/{sessionId}/chunks/{chunkId}')
  .onCreate(async (snapshot, context) => {
    const chunk = snapshot.val()
    const { sessionId, chunkId } = context.params

    // Only translate finalized chunks
    if (!chunk.isFinalized) {
      functions.logger.debug('onTranscriptChunk: skipping non-final chunk', { chunkId })
      return null
    }

    const apiKey = process.env.DEEPL_API_KEY
    if (!apiKey) {
      functions.logger.error('onTranscriptChunk: DEEPL_API_KEY not set')
      return null
    }

    const translator = new deepl.Translator(apiKey)

    // ── Resolve show's DeepL glossary IDs
    let deepLGlossaryIds: Record<string, string> = {}
    try {
      // The session node in Firestore holds its showId via the collection path.
      // We need to query: shows where sessions contains sessionId
      // For efficiency in v1: query sessions across all shows (TODO: optimize with index)
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
          deepLGlossaryIds = showSnap.data()?.deepLGlossaryIds ?? {}
        }
      }
    } catch (err) {
      functions.logger.warn('onTranscriptChunk: could not resolve glossary IDs', err)
    }

    // ── Fan out DeepL calls in parallel
    const translationResults = await Promise.allSettled(
      Object.entries(LANG_MAP).map(async ([langKey, deeplLang]) => {
        const langPairKey = `en-${langKey}`
        const glossaryId = deepLGlossaryIds[langPairKey]

        const result = await translator.translateText(
          chunk.text,
          'en' as deepl.SourceLanguageCode,
          deeplLang,
          {
            glossary: glossaryId ?? undefined,
          }
        )
        return { langKey, translation: result.text }
      })
    )

    // ── Build translations object
    const translations: Record<string, string> = {}
    for (const result of translationResults) {
      if (result.status === 'fulfilled') {
        translations[result.value.langKey] = result.value.translation
      } else {
        functions.logger.error('onTranscriptChunk: translation failed', result.reason)
      }
    }

    // ── Write translations back to RTDB chunk
    await db.ref(`/liveSessions/${sessionId}/chunks/${chunkId}/translations`).set(translations)
    functions.logger.info('onTranscriptChunk: translations written', { chunkId, languages: Object.keys(translations) })

    return null
  })
