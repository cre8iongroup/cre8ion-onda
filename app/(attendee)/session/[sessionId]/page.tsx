import { notFound } from 'next/navigation'
import { loadPublicSessionById } from '@/lib/attendee/load'
import LiveCaptionFeed from './LiveCaptionFeed'
import '../attendee.css'

export const dynamic = 'force-dynamic'

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const result = await loadPublicSessionById(sessionId)
  if (!result) notFound()

  const { session, show, branding } = result

  return (
    <LiveCaptionFeed
      sessionId={session.id}
      title={session.friendlyName || session.title}
      showName={show.name}
      branding={branding}
      initialFeedState={session.feedState}
    />
  )
}
