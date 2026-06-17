import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

if (!admin.apps.length) admin.initializeApp()
const db = admin.database()

interface RecallPayload {
  sessionId: string
  text: string
  speaker?: string
  timestamp: number       // Unix ms
  isFinal: boolean
  sequenceNumber?: number
}

/**
 * HTTP Cloud Function — receives Recall.AI Desktop SDK transcript chunks.
 *
 * Validates the shared secret header (RECALL_WEBHOOK_SECRET) and writes
 * each chunk to the Realtime Database buffer at /liveSessions/{sessionId}/chunks/{autoId}.
 *
 * Only the server (Admin SDK) has write access to this RTDB path.
 * The tech operator's machine never holds credentials.
 */
export const recallWebhook = functions.https.onRequest(async (req, res) => {
  // ── 1. Method guard
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed')
    return
  }

  // ── 2. Shared secret validation
  const secret = req.headers['x-recall-secret']
  const expected = process.env.RECALL_WEBHOOK_SECRET
  if (!expected || secret !== expected) {
    functions.logger.warn('recallWebhook: invalid or missing secret', { secret })
    res.status(401).send('Unauthorized')
    return
  }

  // ── 3. Parse & validate payload
  const payload = req.body as Partial<RecallPayload>
  if (!payload.sessionId || typeof payload.text !== 'string') {
    res.status(400).send('Bad Request: missing sessionId or text')
    return
  }

  const { sessionId, text, speaker, timestamp, isFinal, sequenceNumber } = payload

  try {
    // ── 4. Write chunk to RTDB buffer
    const chunksRef = db.ref(`liveSessions/${sessionId}/chunks`)
    await chunksRef.push({
      text,
      speakerLabel: speaker ?? null,
      timestamp: timestamp ?? Date.now(),
      sequenceNumber: sequenceNumber ?? 0,
      isFinal: isFinal ?? false,
      translations: {},
      isFinalized: isFinal ?? false,
    })

    functions.logger.info('recallWebhook: chunk written', { sessionId, isFinal })
    res.status(200).json({ ok: true })
  } catch (err) {
    functions.logger.error('recallWebhook: write failed', err)
    res.status(500).send('Internal Server Error')
  }
})
