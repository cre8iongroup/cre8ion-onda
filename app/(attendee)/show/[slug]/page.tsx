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
  const hasLive = sessions.some((s) => s.feedState === 'live')

  return (
    <AttendeeShell branding={show.branding}>
      {show.branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="attendee-logo" src={show.branding.logoUrl} alt="" />
      ) : null}
      <h1 className="attendee-title">{show.name}</h1>
      <p className="attendee-lede">{show.clientName}</p>

      {show.links.length > 0 ? (
        <ul className="attendee-link-list">
          {show.links.map((link) => (
            <li key={`${link.order}-${link.url}`}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '0.85rem', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.65, marginBottom: '0.75rem' }}>
          Rooms
        </h2>
        {show.rooms.length === 0 ? (
          <p className="attendee-lede">Rooms will appear here when published.</p>
        ) : (
          <ul className="attendee-entry-list">
            {show.rooms.map((room) => (
              <li key={room.id}>
                <Link href={`/room/${room.id}`}>
                  <span>{room.name}</span>
                  <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p style={{ marginBottom: '1rem' }}>
        <Link href={`/show/${show.slug}/sessions`}>
          Browse all sessions{hasLive ? ' · Live now' : ''}
        </Link>
      </p>

      <AttendeeFooter eventTitle={show.name} legalNotice={show.legalNotice} />
    </AttendeeShell>
  )
}
