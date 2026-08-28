'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { formatSessionDateTime } from '@/lib/attendee/schedule'
import { sessionStatusBadgeClass, sessionStatusLabel } from '@/lib/sessionStatus'
import { normalizeReviewState } from '@/lib/review/sessionReview'
import { sortSessionsByScheduledStart, isAvTestSession } from '@/lib/sessions/sessionFilters'
import { useSessionFilters } from '@/hooks/useSessionFilters'
import SessionFilterBar from '@/components/sessions/SessionFilterBar'
import type { ReviewStatus, SessionDoc, ShowRoom, WithId } from '@/types'
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge'

export type SessionReviewListProps = {
  showId: string
  showTimezone: string
  sessions: WithId<SessionDoc>[]
  reviewerEmail: string
  rooms?: ShowRoom[]
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
  rooms = [],
  showShowName = false,
  showName,
  loading = false,
  emptyMessage = 'No sessions found.',
}: SessionReviewListProps) {
  const [hideAvTestSessions, setHideAvTestSessions] = useState(true)

  const getReviewStatus = useCallback(
    (session: WithId<SessionDoc>): ReviewStatus =>
      normalizeReviewState(session, reviewerEmail).status,
    [reviewerEmail],
  )

  const {
    search,
    setSearch,
    roomId,
    setRoomId,
    dateKey,
    setDateKey,
    timeBucket,
    setTimeBucket,
    reviewStatus,
    setReviewStatus,
    dateOptions,
    filteredSessions,
    filtersActive,
    clearFilters,
  } = useSessionFilters(sessions, { getReviewStatus })

  const visibleSessions = useMemo(() => {
    const sorted = sortSessionsByScheduledStart(filteredSessions, 'asc')
    if (!hideAvTestSessions) return sorted
    return sorted.filter((session) => !isAvTestSession(session))
  }, [filteredSessions, hideAvTestSessions])

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

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <SessionFilterBar
        idPrefix="review-sessions"
        search={search}
        onSearchChange={setSearch}
        rooms={rooms}
        roomId={roomId}
        onRoomIdChange={setRoomId}
        dateOptions={dateOptions}
        dateKey={dateKey}
        onDateKeyChange={setDateKey}
        timeBucket={timeBucket}
        onTimeBucketChange={setTimeBucket}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
        showReviewStatusFilter
        reviewStatus={reviewStatus}
        onReviewStatusChange={setReviewStatus}
        showHideAvTestSessionsToggle
        hideAvTestSessions={hideAvTestSessions}
        onHideAvTestSessionsChange={setHideAvTestSessions}
      />

      {visibleSessions.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: 0 }}>
            No sessions match the current filters.
          </p>
        </div>
      ) : (
        <div className="form-group">
          {visibleSessions.map((session) => {
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
      )}
    </div>
  )
}
