import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { loadPublicSessionsForShow, resolveShowBySlug } from '@/lib/attendee/load'
import { formatSessionTime, groupSessionsByDay } from '@/lib/attendee/schedule'
import { attendeePageMetadata } from '@/lib/attendee/shareMeta'
import { AttendeeFooter, AttendeeShell } from '../../../AttendeeChrome'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const show = await resolveShowBySlug(slug)
  if (!show) {
    return attendeePageMetadata({ title: 'Sessions', showBranding: null })
  }
  return attendeePageMetadata({
    title: `Sessions · ${show.name}`,
    description: `All visible sessions for ${show.name}`,
    showBranding: show.branding,
  })
}

export default async function ShowSessionsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const show = await resolveShowBySlug(slug)
  if (!show) notFound()

  const sessions = await loadPublicSessionsForShow(show.id)
  const groups = groupSessionsByDay(sessions, show.showTimezone)
  const roomName = (roomId: string) =>
    show.rooms.find((r) => r.id === roomId)?.name || 'Room'

  return (
    <AttendeeShell branding={show.branding}>
      <p style={{ marginBottom: '1rem', fontSize: '0.875rem', opacity: 0.7 }}>
        <Link href={`/show/${show.slug}`}>← {show.name}</Link>
      </p>
      <h1 className="attendee-title">Sessions</h1>
      <p className="attendee-lede">All visible sessions for this event.</p>

      {groups.length === 0 ? (
        <p className="attendee-lede">No sessions published yet.</p>
      ) : (
        groups.map((group) => (
          <section key={group.dayKey} className="schedule-day">
            <h2>{group.label}</h2>
            {group.sessions.map((session) => (
              <Link
                key={session.id}
                href={`/session/${session.id}`}
                className={`schedule-row${session.feedState === 'live' ? ' is-live' : ''}`}
              >
                <span className="schedule-time">
                  {formatSessionTime(session.scheduledStartMs, show.showTimezone)}
                </span>
                <span>
                  <strong>{session.friendlyName || session.title}</strong>
                  <span style={{ display: 'block', fontSize: '0.85rem', opacity: 0.7 }}>
                    {roomName(session.roomId)}
                    {session.feedState === 'live' ? ' · Live' : ''}
                  </span>
                </span>
              </Link>
            ))}
          </section>
        ))
      )}

      <AttendeeFooter eventTitle={show.name} legalNotice={show.legalNotice} />
    </AttendeeShell>
  )
}
