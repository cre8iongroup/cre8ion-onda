import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { resolveShowBySlug, loadPublicSessionsForShow } from '@/lib/attendee/load'
import { attendeePageMetadata } from '@/lib/attendee/shareMeta'
import { AttendeeFooter, AttendeeShell } from '../../AttendeeChrome'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const show = await resolveShowBySlug(slug)
  if (!show) {
    return attendeePageMetadata({ title: 'Event', showBranding: null })
  }
  return attendeePageMetadata({
    title: show.name,
    description: show.clientName
      ? `${show.clientName} · Live captions and session info`
      : undefined,
    showBranding: show.branding,
  })
}

export default async function ShowHomePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const show = await resolveShowBySlug(slug)
  if (!show) notFound()

  const sessions = await loadPublicSessionsForShow(show.id)
  const liveRoomIds = new Set(
    sessions
      .filter((s) => s.feedState === 'live' && s.roomId)
      .map((s) => s.roomId),
  )

  return (
    <AttendeeShell branding={show.branding}>
      {show.branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="attendee-logo attendee-logo--hero" src={show.branding.logoUrl} alt="" />
      ) : null}
      <h1 className="attendee-title">{show.name}</h1>

      <section className="attendee-quick-links" aria-labelledby="attendee-quick-links-heading">
        <div className="attendee-section-rule" aria-hidden />
        <h2 id="attendee-quick-links-heading" className="attendee-section-label">
          Quick Links
        </h2>
        <ul className="attendee-link-list">
          <li>
            <Link href={`/show/${show.slug}/sessions`} className="attendee-quick-link">
              Attendee Hub
            </Link>
          </li>
          {show.links.map((link) => (
            <li key={`${link.order}-${link.url}`}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="attendee-quick-link">
                {link.title}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="attendee-rooms-section" aria-labelledby="attendee-rooms-heading">
        <h2 id="attendee-rooms-heading" className="attendee-section-label">
          Rooms
        </h2>
        {show.rooms.length === 0 ? (
          <p className="attendee-lede">Rooms will appear here when published.</p>
        ) : (
          <ul className="attendee-room-grid">
            {show.rooms.map((room) => {
              const isLive = liveRoomIds.has(room.id)
              return (
                <li key={room.id}>
                  <Link
                    href={`/room/${room.id}`}
                    className={`attendee-room-card${isLive ? ' is-live' : ''}`}
                  >
                    {isLive ? (
                      <span className="attendee-room-live-badge">Live</span>
                    ) : null}
                    <span className="attendee-room-card-name">{room.name}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <AttendeeFooter eventTitle={show.name} legalNotice={show.legalNotice} />
    </AttendeeShell>
  )
}
