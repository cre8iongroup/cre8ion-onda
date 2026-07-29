import { NextRequest, NextResponse } from 'next/server'
import {
  TechLifecycleError,
  unlockShowByCredential,
} from '@/lib/tech/sessionLifecycle'
import { assertCorrectFirebaseProject } from '@/lib/firebase/admin'

/**
 * POST /api/tech/unlock
 *
 * Body: { credential: string }
 * Finds the Show with matching techCredential and returns show + rooms + sessions.
 * Electron uses this instead of reading Firestore directly.
 */
export async function POST(request: NextRequest) {
  try {
    assertCorrectFirebaseProject()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, code: 'wrong_firebase_project' }, { status: 500 })
  }

  let body: { credential?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const result = await unlockShowByCredential(body.credential ?? '')
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof TechLifecycleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[tech/unlock] failed', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
