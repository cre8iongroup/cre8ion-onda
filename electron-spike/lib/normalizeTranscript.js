/**
 * Normalize Recall realtime transcript events → Onda webhook payload.
 * Kept as plain JS so the Electron main process can require it without a build step.
 * Mirror of lib/recall/normalizeTranscript.ts in the Next.js app.
 */

function extractRecallTranscript(body, eventHint) {
  if (!body || typeof body !== 'object') return null

  const event =
    (typeof body.event === 'string' ? body.event : null) ?? eventHint ?? null

  if (typeof body.text === 'string' && body.sessionId) {
    return {
      text: body.text,
      speaker: typeof body.speaker === 'string' ? body.speaker : undefined,
      isFinal: Boolean(body.isFinal ?? true),
      timestamp: typeof body.timestamp === 'number' ? body.timestamp : Date.now(),
    }
  }

  const isPartial = event === 'transcript.partial_data'
  const isFinalEvent = event === 'transcript.data' || event === null

  const dataLayer = body.data ?? body
  const inner = dataLayer.data ?? dataLayer
  const transcript = Array.isArray(inner.words)
    ? inner
    : (inner.data ?? dataLayer)

  const words = transcript.words
  if (!Array.isArray(words) || words.length === 0) {
    if (event === 'transcript.data' || event === 'transcript.partial_data') {
      return { text: '', speaker: undefined, isFinal: !isPartial, timestamp: Date.now() }
    }
    return null
  }

  const text = words
    .map((w) => (typeof w.text === 'string' ? w.text : typeof w.word === 'string' ? w.word : ''))
    .filter(Boolean)
    .join(' ')
    .trim()

  if (!text) return null

  const speaker =
    typeof transcript.participant?.name === 'string' && transcript.participant.name
      ? transcript.participant.name
      : undefined

  return {
    text,
    speaker,
    isFinal: isFinalEvent && !isPartial,
    timestamp: Date.now(),
  }
}

function normalizeToOndaPayload(body, sessionId, options = {}) {
  if (!sessionId) return null
  const extracted = extractRecallTranscript(body, options.eventHint)
  if (!extracted || !extracted.text) return null

  const sequenceNumber =
    options.sequenceNumber ??
    (typeof body.sequenceNumber === 'number' ? body.sequenceNumber : 0)

  return {
    sessionId,
    text: extracted.text,
    speaker: extracted.speaker,
    timestamp: extracted.timestamp,
    isFinal: extracted.isFinal,
    sequenceNumber,
  }
}

module.exports = { extractRecallTranscript, normalizeToOndaPayload }
