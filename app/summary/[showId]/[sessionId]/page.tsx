import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { loadPublishedSummary } from '@/lib/summary/load'
import { attendeePageMetadata } from '@/lib/attendee/shareMeta'
import { AttendeeFooter, AttendeeShell } from '@/app/(attendee)/AttendeeChrome'
import { formatSessionDateTime } from '@/lib/attendee/schedule'
import '@/app/(attendee)/attendee.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ showId: string; sessionId: string }>
}): Promise<Metadata> {
  const { showId, sessionId } = await params
  const data = await loadPublishedSummary(showId, sessionId)
  if (!data) {
    return attendeePageMetadata({ title: 'Session notes', showBranding: null })
  }
  return attendeePageMetadata({
    title: data.sessionFriendlyName,
    description: `${data.showName} · Session notes`,
    showBranding: data.branding,
  })
}

export default async function PublicSummaryPage({
  params,
}: {
  params: Promise<{ showId: string; sessionId: string }>
}) {
  const { showId, sessionId } = await params
  const data = await loadPublishedSummary(showId, sessionId)
  if (!data) notFound()

  const { summary, branding } = data
  const tz = data.showTimezone
  const when =
    data.scheduledStartMs > 0
      ? formatSessionDateTime(data.scheduledStartMs, tz)
      : null

  return (
    <AttendeeShell branding={branding}>
      {branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="attendee-logo attendee-logo--hero" src={branding.logoUrl} alt="" />
      ) : null}

      <header style={{ marginBottom: '2rem' }}>
        <p style={{ opacity: 0.75, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
          {data.showName}
          {data.clientName ? ` · ${data.clientName}` : ''}
        </p>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          {data.sessionFriendlyName}
        </h1>
        {when ? (
          <p style={{ opacity: 0.7, fontSize: '0.875rem' }}>{when}</p>
        ) : null}
      </header>

      <article className="form-group" style={{ gap: '2rem' }}>
        <section>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Executive summary
          </h2>
          <p style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{summary.executiveSummary}</p>
        </section>

        {summary.keyTopics.length > 0 ? (
          <section>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              Key topics
            </h2>
            <ul style={{ paddingLeft: '1.25rem', lineHeight: 1.65 }}>
              {summary.keyTopics.map((topic) => (
                <li key={topic}>{topic}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {summary.actionItems.length > 0 ? (
          <section>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              Action items
            </h2>
            <ul style={{ paddingLeft: '1.25rem', lineHeight: 1.65 }}>
              {summary.actionItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {summary.quotes.length > 0 ? (
          <section>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              Notable quotes
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {summary.quotes.map((quote, i) => (
                <figure
                  key={`${i}-${quote.text.slice(0, 20)}`}
                  style={{
                    margin: 0,
                    padding: '1rem 1.25rem',
                    borderLeft: '3px solid var(--attendee-accent, #5b3aee)',
                    background: 'rgba(255,255,255,0.04)',
                  }}
                >
                  <blockquote style={{ margin: 0, fontStyle: 'italic' }}>
                    “{quote.text}”
                  </blockquote>
                  {quote.speaker ? (
                    <figcaption style={{ marginTop: '0.5rem', fontSize: '0.875rem', opacity: 0.75 }}>
                      — {quote.speaker}
                    </figcaption>
                  ) : null}
                </figure>
              ))}
            </div>
          </section>
        ) : null}
      </article>

      <AttendeeFooter eventTitle={data.showName} legalNotice={data.legalNotice} />
    </AttendeeShell>
  )
}
