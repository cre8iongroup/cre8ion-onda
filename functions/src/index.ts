/**
 * Onda Cloud Functions — Entry Point
 *
 * Exports all Cloud Functions. Each function is in its own module
 * to keep cold-start payloads small.
 */

export { recallWebhook }      from './recallWebhook'
export { onTranscriptChunk }  from './onTranscriptChunk'
export { onSessionEnd }       from './onSessionEnd'
export { summarizeSession }   from './summarize'
export { syncDeepLGlossary }  from './syncDeepLGlossary'
