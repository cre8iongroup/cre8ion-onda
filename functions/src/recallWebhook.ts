import * as functions from 'firebase-functions/v1'
import * as admin from 'firebase-admin'
import {
  applyTextCorrections,
  textCorrectionsFromGlossary,
  type TextCorrectionRule,
} from './applyTextCorrections'

if (!admin.apps.length) admin.initializeApp()
const db = admin.database()
const firestore = admin.firestore()

interface RecallWord {
  text?: string
  word?: string
}

interface NormalizedChunk {
  sessionId: string
  text: string
  speaker?: string
  timestamp: number
  isFinal: boolean
  sequenceNumber?: number
}

type CacheEntry = { expiresAt: number; rules: TextCorrectionRule[] }
const CACHE_TTL_MS = 30_000
const correctionCache = new Map<string, CacheEntry>()

async function loadTextCorrectionsForSession(sessionId: string): Promise<TextCorrectionRule[]> {
  const now = Date.now()
  const hit = correctionCache.get(sessionId)
  if (hit && hit.expiresAt > now) return hit.rules

  try {
    const sessionsQuery = await firestore
      .collectionGroup('sessions')
      .where(admin.firestore.FieldPath.documentId(), '==', sessionId)
      .limit(1)
      .get()

    if (sessionsQuery.empty) {
      correctionCache.set(sessionId, { expiresAt: now + CACHE_TTL_MS, rules: [] })
      return []
    }

    const showRef = sessionsQuery.docs[0].ref.parent.parent
    if (!showRef) {
      correctionCache.set(sessionId, { expiresAt: now + CACHE_TTL_MS, rules: [] })
      return []
    }

    const showSnap = await showRef.get()
    const glossary = showSnap.data()?.glossary
    const rules = textCorrectionsFromGlossary(Array.isArray(glossary) ? glossary : [])
    correctionCache.set(sessionId, { expiresAt: now + CACHE_TTL_MS, rules })
    return rules
  } catch (err) {
    functions.logger.warn('recallWebhook: failed to load text corrections', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return hit?.rules ?? []
  }
}

/**
 * Normalize Onda custom payload OR Recall transcript.data envelope.
 * sessionId may come from body or ?sessionId= query (Recall webhook realtime).
 */
function normalizePayload(
  body: Record<string, unknown>,
  sessionIdFromQuery: string | undefined,
): NormalizedChunk | null {
  const sessionId =
    (typeof body.sessionId === 'string' ? body.sessionId : undefined) ??
    sessionIdFromQuery

  if (!sessionId) return null

  // Onda custom shape
  if (typeof body.text === 'string') {
    return {
      sessionId,
      text: body.text,
      speaker: typeof body.speaker === 'string' ? body.speaker : undefined,
      timestamp: typeof body.timestamp === 'number' ? body.timestamp : Date.now(),
      isFinal: Boolean(body.isFinal ?? true),
      sequenceNumber: typeof body.sequenceNumber === 'number' ? body.sequenceNumber : 0,
    }
  }

  const event = typeof body.event === 'string' ? body.event : null
  if (
    event &&
    event !== 'transcript.data' &&
    event !== 'transcript.partial_data'
  ) {
    return null
  }

  const dataLayer = (body.data ?? body) as Record<string, unknown>
  const inner = (dataLayer.data as Record<string, unknown> | undefined) ?? dataLayer
  const transcript =
    (Array.isArray((inner as { words?: unknown }).words)
      ? inner
      : (inner.data as Record<string, unknown> | undefined)) ?? dataLayer

  const words = (transcript as { words?: RecallWord[] }).words
  if (!Array.isArray(words) || words.length === 0) return null

  const text = words
    .map((w) => w.text ?? w.word ?? '')
    .filter(Boolean)
    .join(' ')
    .trim()
  if (!text) return null

  const participant = (transcript as { participant?: { name?: string } }).participant

  return {
    sessionId,
    text,
    speaker: participant?.name,
    timestamp: Date.now(),
    isFinal: event !== 'transcript.partial_data',
    sequenceNumber: 0,
  }
}

/**
 * HTTP Cloud Function — receives Recall.AI Desktop SDK transcript chunks.
 *
 * Validates the shared secret header (RECALL_WEBHOOK_SECRET) and writes
 * each chunk to the Realtime Database buffer at /liveSessions/{sessionId}/chunks/{autoId}.
 *
 * Accepts Onda custom JSON or native Recall transcript.data (with ?sessionId=).
 */
export const recallWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed')
    return
  }

  const secret = req.headers['x-recall-secret']
  const expected = process.env.RECALL_WEBHOOK_SECRET
  if (!expected || secret !== expected) {
    functions.logger.warn('recallWebhook: invalid or missing secret', { secret })
    res.status(401).send('Unauthorized')
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const sessionIdFromQuery =
    typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined

  // Skip non-transcript lifecycle events cleanly
  if (
    typeof body.event === 'string' &&
    body.event !== 'transcript.data' &&
    body.event !== 'transcript.partial_data' &&
    typeof body.text !== 'string'
  ) {
    res.status(200).json({ ok: true, skipped: body.event })
    return
  }

  const normalized = normalizePayload(body, sessionIdFromQuery)
  if (!normalized) {
    res.status(400).send('Bad Request: unrecognized payload or missing sessionId/text')
    return
  }

  try {
    const corrections = await loadTextCorrectionsForSession(normalized.sessionId)
    const correctedText = applyTextCorrections(normalized.text, corrections)

    // Canonical path — must match database.rules.json + Next.js webhook writers
    // (liveSessions/{sessionId}/chunks). Never write to root {sessionId}/chunks.
    const chunksRef = db.ref(`liveSessions/${normalized.sessionId}/chunks`)
    await chunksRef.push({
      text: correctedText,
      speakerLabel: normalized.speaker ?? null,
      timestamp: normalized.timestamp,
      sequenceNumber: normalized.sequenceNumber ?? 0,
      isFinal: normalized.isFinal,
      translations: {},
      isFinalized: normalized.isFinal,
    })

    functions.logger.info('recallWebhook: chunk written', {
      sessionId: normalized.sessionId,
      isFinal: normalized.isFinal,
    })
    res.status(200).json({ ok: true })
  } catch (err) {
    functions.logger.error('recallWebhook: write failed', err)
    res.status(500).send('Internal Server Error')
  }
})
