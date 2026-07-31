import { notFound } from 'next/navigation'
import { loadPublicSessionById } from '@/lib/attendee/load'
import LiveCaptionFeed from './LiveCaptionFeed'
import '@/app/(attendee)/attendee.css'

export const dynamic = 'force-dynamic'

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const result = await loadPublicSessionById(sessionId)
  if (!result) notFound()

  const { session, show, branding, room } = result

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
    />
  )
}
