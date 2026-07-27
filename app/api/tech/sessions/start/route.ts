import { NextRequest, NextResponse } from 'next/server'
import { TechLifecycleError, startSession } from '@/lib/tech/sessionLifecycle'
import { assertCorrectFirebaseProject } from '@/lib/firebase/admin'

/**
 * POST /api/tech/sessions/start
 *
 * Body: { credential, showId, sessionId }
 * Validates the session is not already live, writes lifecycleStatus=live
 * (Admin SDK), then returns the per-session webhook path for Electron.
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
    const result = await startSession({ credential, showId, sessionId })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof TechLifecycleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[tech/sessions/start] failed', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
