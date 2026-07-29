import { NextRequest, NextResponse } from 'next/server'
import {
  AdminAuthError,
  requireAdminUser,
  requireShowEditCapability,
} from '@/lib/admin/requireAdminUser'
import {
  resetSessionToStandby,
  TechLifecycleError,
} from '@/lib/tech/sessionLifecycle'

/**
 * POST /api/admin/sessions/reset
 *
 * Admin override: force session feedState → standby from any state.
 * Body: { showId, sessionId }
 * Auth: Firebase ID token + canEditShows | canCreateShows
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request)
    requireShowEditCapability(admin.capabilities)

    const body = (await request.json().catch(() => ({}))) as {
      showId?: string
      sessionId?: string
    }
    const showId = typeof body.showId === 'string' ? body.showId.trim() : ''
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    if (!showId || !sessionId) {
      return NextResponse.json(
        { error: 'showId and sessionId are required', code: 'missing_ids' },
        { status: 400 },
      )
    }

    const result = await resetSessionToStandby({
      showId,
      sessionId,
      performedBy: admin.uid,
    })

    return NextResponse.json({
      ok: true,
      session: result.session,
      previousFeedState: result.previousFeedState,
      recallStop: result.recallStop,
    })
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    if (err instanceof TechLifecycleError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    console.error('[admin/sessions/reset] failed', err)
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 })
  }
}
