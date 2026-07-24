/**
 * Normalize Recall Desktop SDK realtime transcript events into the Onda
 * webhook payload shape used by /api/recall/webhook and recallWebhook CF.
 *
 * Supports:
 *  1. Onda custom payload (already normalized) — pass-through
 *  2. Recall `transcript.data` / `transcript.partial_data` event envelopes
 *
 * sessionId may come from the body, or from a query/path param (Recall webhook
 * realtime endpoints should encode it as ?sessionId=…).
 */

import type { RecallWebhookPayload } from '@/types'

export type NormalizedRecallChunk = RecallWebhookPayload

type RecallWord = {
  text?: string
  word?: string
  start_timestamp?: { relative?: number }
  end_timestamp?: { relative?: number }
}

type RecallParticipant = {
  id?: number | string
  name?: string | null
}

type RecallTranscriptData = {
  words?: RecallWord[]
  participant?: RecallParticipant
}

/**
 * Extract utterance text + speaker from a Recall realtime event body.
 * Returns null if the payload is not a recognizable transcript event.
 */
export function extractRecallTranscript(
  body: unknown,
  eventHint?: string | null,
): { text: string; speaker?: string; isFinal: boolean; timestamp: number } | null {
  if (!body || typeof body !== 'object') return null

  const root = body as Record<string, unknown>
  const event =
    (typeof root.event === 'string' ? root.event : null) ??
    eventHint ??
    null

  // Already-normalized Onda payload
  if (typeof root.text === 'string' && root.sessionId) {
    return {
      text: root.text,
      speaker: typeof root.speaker === 'string' ? root.speaker : undefined,
      isFinal: Boolean(root.isFinal ?? true),
      timestamp: typeof root.timestamp === 'number' ? root.timestamp : Date.now(),
    }
  }

  const isPartial = event === 'transcript.partial_data'
  const isFinalEvent = event === 'transcript.data' || event === null

  // Nested Recall envelope: { event, data: { data: { words, participant } } }
  // or { data: { words, participant } }
  const dataLayer = (root.data ?? root) as Record<string, unknown>
  const inner =
    (dataLayer.data as Record<string, unknown> | undefined) ?? dataLayer
  const transcript: RecallTranscriptData =
    (inner.words ? inner : (inner.data as RecallTranscriptData | undefined)) ??
    (dataLayer as RecallTranscriptData)

  const words = transcript.words
  if (!Array.isArray(words) || words.length === 0) {
    // Only treat as Recall event if event name says so
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

  const firstRelative = words[0]?.start_timestamp?.relative
  const timestamp =
    typeof firstRelative === 'number'
      ? Date.now() // relative offset alone isn't wall-clock; use receive time
      : Date.now()

  return {
    text,
    speaker,
    isFinal: isFinalEvent && !isPartial,
    timestamp,
  }
}

export function normalizeToOndaPayload(
  body: unknown,
  sessionId: string,
  options?: { sequenceNumber?: number; eventHint?: string | null },
): NormalizedRecallChunk | null {
  if (!sessionId) return null

  const extracted = extractRecallTranscript(body, options?.eventHint)
  if (!extracted || !extracted.text) return null

  const root = body as Record<string, unknown>
  const sequenceNumber =
    options?.sequenceNumber ??
    (typeof root.sequenceNumber === 'number' ? root.sequenceNumber : 0)

  return {
    sessionId,
    text: extracted.text,
    speaker: extracted.speaker,
    timestamp: extracted.timestamp,
    isFinal: extracted.isFinal,
    sequenceNumber,
  }
}
