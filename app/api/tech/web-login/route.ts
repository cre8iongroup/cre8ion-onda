import { NextRequest, NextResponse } from 'next/server'
import { assertCorrectFirebaseProject } from '@/lib/firebase/admin'
import { TechLifecycleError } from '@/lib/tech/sessionLifecycle'
import { webLoginWithCredential } from '@/lib/tech/webLogin'

export const runtime = 'nodejs'

/**
 * POST /api/tech/web-login
 *
 * Body: { credential: string }
 *
 * Same show resolution as Operator unlock (Firestore techCredential equality).
 * Returns a Firebase custom token for the show's tech Auth user — no password
 * path. Client: signInWithCustomToken.
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
    const result = await webLoginWithCredential(body.credential ?? '')
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof TechLifecycleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[tech/web-login] failed', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
