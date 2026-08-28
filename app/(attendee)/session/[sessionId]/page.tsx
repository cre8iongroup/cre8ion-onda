import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { loadPublicSessionById } from '@/lib/attendee/load'
import { hasPublishedSummary } from '@/lib/summary/load'
import { summaryPublicUrl } from '@/lib/attendee/urls'
import { attendeePageMetadata } from '@/lib/attendee/shareMeta'
import LiveCaptionFeed from './LiveCaptionFeed'
import '@/app/(attendee)/attendee.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sessionId: string }>
}): Promise<Metadata> {
  const { sessionId } = await params
  const result = await loadPublicSessionById(sessionId)
  if (!result) {
    return attendeePageMetadata({ title: 'Session', showBranding: null })
  }
  const title = result.session.friendlyName || result.session.title
  return attendeePageMetadata({
    title,
    description: `${result.show.name} · Live captions`,
    showBranding: result.show.branding,
  })
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const result = await loadPublicSessionById(sessionId)
  if (!result) notFound()

  const { session, show, branding, room } = result

  let publishedSummaryHref: string | null = null
  if (session.feedState === 'ended') {
    const published = await hasPublishedSummary(session.showId, session.id)
    if (published) {
      publishedSummaryHref = summaryPublicUrl(session.showId, session.id)
    }
  }

  return (
    <LiveCaptionFeed
      sessionId={session.id}
      title={session.friendlyName || session.title}
      showName={show.name}
      showTimezone={show.showTimezone}
      scheduledStartMs={session.scheduledStartMs}
      legalNotice={show.legalNotice}
      room={room}
      branding={branding}
      initialFeedState={session.feedState}
      defaultLanguages={show.defaultLanguages}
      publishedSummaryHref={publishedSummaryHref}
    />
  )
}
