import { NextResponse } from 'next/server'
import { resolveShowBySlug } from '@/lib/attendee/load'

export const runtime = 'nodejs'

/** GET /api/public/shows/[slug] — safe public show payload (no secrets). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params
  const show = await resolveShowBySlug(slug)
  if (!show) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(show)
}
