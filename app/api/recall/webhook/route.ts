import { NextRequest, NextResponse } from 'next/server'
import { getAdminDatabase } from '@/lib/firebase/admin'
import { normalizeToOndaPayload } from '@/lib/recall/normalizeTranscript'

/**
 * POST /api/recall/webhook
 *
 * Receives transcript chunks from:
 *  1. Onda Electron spike / Tech desktop bridge — custom payload + x-recall-secret
 *  2. Recall realtime `webhook` endpoints — native transcript.data envelope
 *     (sessionId via ?sessionId= query param — required for native format)
 *
 * Writes to RTDB: liveSessions/{sessionId}/chunks
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-recall-secret')
  const expected = process.env.RECALL_WEBHOOK_SECRET

  if (!expected || secret !== expected) {
    console.warn('[recall/webhook] Invalid or missing x-recall-secret header')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sessionIdFromQuery = request.nextUrl.searchParams.get('sessionId')
  const bodyObj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const sessionId =
    (typeof bodyObj.sessionId === 'string' ? bodyObj.sessionId : null) ??
    sessionIdFromQuery

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Missing sessionId (body.sessionId or ?sessionId=)' },
      { status: 400 },
    )
  }

  const eventHint =
    typeof bodyObj.event === 'string' ? bodyObj.event : request.nextUrl.searchParams.get('event')

  // Skip non-transcript Recall lifecycle events if they land here
  if (
    typeof bodyObj.event === 'string' &&
    bodyObj.event !== 'transcript.data' &&
    bodyObj.event !== 'transcript.partial_data' &&
    typeof bodyObj.text !== 'string'
  ) {
    return NextResponse.json({ ok: true, skipped: bodyObj.event }, { status: 200 })
  }

  const normalized = normalizeToOndaPayload(body, sessionId, { eventHint })
  if (!normalized) {
    return NextResponse.json({ error: 'Unrecognized transcript payload' }, { status: 400 })
  }

  try {
    const db = getAdminDatabase()
    const chunksRef = db.ref(`liveSessions/${normalized.sessionId}/chunks`)

    await chunksRef.push({
      text: normalized.text,
      speakerLabel: normalized.speaker ?? null,
      timestamp: normalized.timestamp,
      sequenceNumber: normalized.sequenceNumber ?? 0,
      isFinalized: normalized.isFinal,
      translations: {},
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    console.error('[recall/webhook] RTDB write failed:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-recall-secret',
    },
  })
}
