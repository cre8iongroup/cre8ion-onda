import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadPublicRoomById } from '@/lib/attendee/load'
import { formatSessionTime, groupSessionsByDay } from '@/lib/attendee/schedule'
import { AttendeeFooter, AttendeeShell } from '../../AttendeeChrome'

export const dynamic = 'force-dynamic'

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params
  const room = await loadPublicRoomById(roomId)
  if (!room) notFound()

  const tz = room.show.showTimezone
  const groups = groupSessionsByDay(room.sessions, tz)
  const live = room.liveSession

  return (
    <AttendeeShell branding={room.branding}>
      <p style={{ marginBottom: '1rem', fontSize: '0.875rem', opacity: 0.7 }}>
        <Link href={`/show/${room.show.slug}`}>← {room.show.name}</Link>
      </p>
      {room.branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="attendee-logo" src={room.branding.logoUrl} alt="" />
      ) : null}
      <h1 className="attendee-title">{room.name}</h1>

      {live ? (
        <div className="live-card">
          <div className="live-badge">Live now</div>
          <Link href={`/session/${live.id}`}>
            <strong style={{ fontSize: '1.25rem' }}>{live.friendlyName || live.title}</strong>
            <span style={{ display: 'block', marginTop: '0.35rem', opacity: 0.85 }}>
              Open live captions →
            </span>
          </Link>
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.dayKey} className="schedule-day">
          <h2>{group.label}</h2>
          {group.sessions.map((session) => (
            <Link
              key={session.id}
              href={`/session/${session.id}`}
              className={`schedule-row${session.feedState === 'live' ? ' is-live' : ''}`}
            >
              <span className="schedule-time">
                {formatSessionTime(session.scheduledStartMs, tz)}
              </span>
              <span>
                <strong>{session.friendlyName || session.title}</strong>
                {session.feedState === 'live' ? (
                  <span style={{ display: 'block', fontSize: '0.85rem' }}>Live</span>
                ) : null}
              </span>
            </Link>
          ))}
        </section>
      ))}

      {groups.length === 0 ? (
        <p className="attendee-lede">No sessions scheduled in this room yet.</p>
      ) : null}

      <AttendeeFooter eventTitle={room.show.name} legalNotice={room.show.legalNotice} />
    </AttendeeShell>
  )
}
