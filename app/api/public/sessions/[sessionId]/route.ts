import { NextResponse } from 'next/server'
import { loadPublicSessionById } from '@/lib/attendee/load'

export const runtime = 'nodejs'

/** GET /api/public/sessions/[sessionId] — safe public session metadata (no secrets). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params
  const result = await loadPublicSessionById(sessionId)
  if (!result) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
