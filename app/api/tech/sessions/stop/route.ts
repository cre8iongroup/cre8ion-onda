import { NextRequest, NextResponse } from 'next/server'
import { TechLifecycleError, stopSession } from '@/lib/tech/sessionLifecycle'
import { assertCorrectFirebaseProject } from '@/lib/firebase/admin'

/**
 * POST /api/tech/sessions/stop
 *
 * Marks feedState=stopping immediately (NOT ended). Ended is applied
 * when Recall upload-complete lands on the webhook.
 */
export async function POST(request: NextRequest) {
  try {
    assertCorrectFirebaseProject()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, code: 'wrong_firebase_project' }, { status: 500 })
  }

  let body: { credential?: string; showId?: string; sessionId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { credential, showId, sessionId } = body
  if (!credential || !showId || !sessionId) {
    return NextResponse.json(
      { error: 'credential, showId, and sessionId are required' },
      { status: 400 },
    )
  }

  try {
    const result = await stopSession({ credential, showId, sessionId })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof TechLifecycleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[tech/sessions/stop] failed', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
