import { NextRequest, NextResponse } from 'next/server'
import { TechLifecycleError, goLiveSession } from '@/lib/tech/sessionLifecycle'
import { assertCorrectFirebaseProject } from '@/lib/firebase/admin'

/**
 * POST /api/tech/sessions/go-live
 *
 * Body: { credential, showId, sessionId }
 * feedState testing → live only. Does not start/stop Recall.
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
    const result = await goLiveSession({ credential, showId, sessionId })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof TechLifecycleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[tech/sessions/go-live] failed', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
