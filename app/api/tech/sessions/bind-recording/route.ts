import { NextRequest, NextResponse } from 'next/server'
import { TechLifecycleError, bindRecording } from '@/lib/tech/sessionLifecycle'
import { assertCorrectFirebaseProject } from '@/lib/firebase/admin'

/**
 * POST /api/tech/sessions/bind-recording
 *
 * Body: { credential, showId, sessionId, recordingId, uploadId? }
 * Stores recordingId → sessionId so Recall Svix lifecycle webhooks (which
 * often omit useful metadata) can resolve the correct session.
 */
export async function POST(request: NextRequest) {
  try {
    assertCorrectFirebaseProject()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, code: 'wrong_firebase_project' }, { status: 500 })
  }

  let body: {
    credential?: string
    showId?: string
    sessionId?: string
    recordingId?: string
    uploadId?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { credential, showId, sessionId, recordingId, uploadId } = body
  if (!credential || !showId || !sessionId || !recordingId) {
    return NextResponse.json(
      { error: 'credential, showId, sessionId, and recordingId are required' },
      { status: 400 },
    )
  }

  try {
    await bindRecording({ credential, showId, sessionId, recordingId, uploadId })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    if (err instanceof TechLifecycleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[tech/sessions/bind-recording] failed', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
