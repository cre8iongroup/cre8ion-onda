import { NextResponse } from 'next/server'
import { loadPublicSessionsForShow, resolveShowBySlug } from '@/lib/attendee/load'

export const runtime = 'nodejs'

/** GET /api/public/shows/[slug]/sessions — non-draft sessions for a published show. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params
  const show = await resolveShowBySlug(slug)
  if (!show) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const sessions = await loadPublicSessionsForShow(show.id)
  return NextResponse.json({ show, sessions })
}
