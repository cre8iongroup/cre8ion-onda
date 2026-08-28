'use client'

import Link from 'next/link'
import { formatSessionDateTime } from '@/lib/attendee/schedule'
import { sessionStatusBadgeClass, sessionStatusLabel } from '@/lib/sessionStatus'
import { normalizeReviewState } from '@/lib/review/sessionReview'
import type { SessionDoc, WithId } from '@/types'
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge'

export type SessionReviewListProps = {
  showId: string
  showTimezone: string
  sessions: WithId<SessionDoc>[]
  reviewerEmail: string
  /** When true, each row includes the show name (cross-show lists). */
  showShowName?: boolean
  showName?: string
  loading?: boolean
  emptyMessage?: string
}

export default function SessionReviewList({
  showId,
  showTimezone,
  sessions,
  reviewerEmail,
  showShowName = false,
  showName,
  loading = false,
  emptyMessage = 'No sessions found.',
}: SessionReviewListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 'var(--space-8)' }}>
        <span className="spinner" aria-label="Loading sessions" />
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-5)' }}>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {emptyMessage}
        </p>
      </div>
    )
  }

  const sorted = [...sessions].sort(
    (a, b) =>
      (a.scheduledStart?.toMillis?.() ?? 0) - (b.scheduledStart?.toMillis?.() ?? 0),
  )

  return (
    <div className="form-group">
      {sorted.map((session) => {
        const reviewState = normalizeReviewState(session, reviewerEmail)
        const startMs = session.scheduledStart?.toMillis?.() ?? 0

        return (
          <article key={session.id} className="card show-list-item">
            <div
              className="flex items-center justify-between gap-4"
              style={{ flexWrap: 'wrap' }}
            >
              <div>
                <h4 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-1)' }}>
                  <Link href={`/review/${showId}/${session.id}`}>
                    {session.friendlyName || session.title}
                  </Link>
                </h4>
                {showShowName && showName ? (
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {showName}
                  </p>
                ) : null}
                <p
                  className="text-sm"
                  style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}
                >
                  {startMs > 0
                    ? formatSessionDateTime(startMs, showTimezone)
                    : 'Schedule TBD'}
                </p>
              </div>
              <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <ReviewStatusBadge status={reviewState.status} />
                <span
                  className={`badge ${sessionStatusBadgeClass({
                    isDraft: session.isDraft,
                    feedState: session.feedState,
                  })}`}
                  title="Live session state (read-only)"
                >
                  {sessionStatusLabel(
                    { isDraft: session.isDraft, feedState: session.feedState },
                    'admin',
                  )}
                </span>
                <Link
                  href={`/review/${showId}/${session.id}`}
                  className="btn btn-secondary btn-sm"
                >
                  Review
                </Link>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
