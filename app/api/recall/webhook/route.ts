import { NextRequest, NextResponse } from 'next/server'
import { getAdminDatabase } from '@/lib/firebase/admin'
import type { RecallWebhookPayload } from '@/types'

/**
 * POST /api/recall/webhook
 *
 * Receives transcript chunks from the Recall.AI Desktop SDK running on the
 * tech operator's laptop. Validates the shared secret header, then writes
 * the chunk to the Realtime Database ephemeral buffer via Admin SDK.
 *
 * No credentials are stored on the operator's machine — they just need
 * the webhook URL and the shared secret (set in Recall.AI SDK config).
 */
export async function POST(request: NextRequest) {
  // ── 1. Shared secret validation
  const secret = request.headers.get('x-recall-secret')
  const expected = process.env.RECALL_WEBHOOK_SECRET

  if (!expected || secret !== expected) {
    console.warn('[recall/webhook] Invalid or missing x-recall-secret header')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Parse payload
  let payload: Partial<RecallWebhookPayload>
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { sessionId, text, speaker, timestamp, isFinal, sequenceNumber } = payload

  if (!sessionId || typeof text !== 'string') {
    return NextResponse.json({ error: 'Missing sessionId or text' }, { status: 400 })
  }

  // ── 3. Write to RTDB ephemeral buffer
  try {
    const db = getAdminDatabase()
    const chunksRef = db.ref(`liveSessions/${sessionId}/chunks`)

    await chunksRef.push({
      text,
      speakerLabel:   speaker   ?? null,
      timestamp:      timestamp  ?? Date.now(),
      sequenceNumber: sequenceNumber ?? 0,
      isFinalized:    isFinal    ?? false,
      translations:   {},
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    console.error('[recall/webhook] RTDB write failed:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * OPTIONS — CORS preflight for Recall.AI Desktop SDK cross-origin POST
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-recall-secret',
    },
  })
}
