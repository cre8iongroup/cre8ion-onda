'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import { formatSessionDateTime } from '@/lib/attendee/schedule'
import { sessionStatusBadgeClass, sessionStatusLabel } from '@/lib/sessionStatus'
import { normalizeReviewState } from '@/lib/review/sessionReview'
import type { SessionDoc, ShowDoc, WithId } from '@/types'
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge'

type ReviewListRow = {
  showId: string
  showName: string
  showTimezone: string
  session: WithId<SessionDoc>
}

export default function ReviewSessionsPage() {
  const { userDoc } = useAuthContext()
  const [rows, setRows] = useState<ReviewListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const assignedShowIds = useMemo(
    () => (Array.isArray(userDoc?.assignedShows) ? userDoc!.assignedShows : []),
    [userDoc?.assignedShows],
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!userDoc) return
      setLoading(true)
      setError(null)

      if (assignedShowIds.length === 0) {
        setRows([])
        setLoading(false)
        return
      }

      try {
        const fs = getClientFirestore()
        const out: ReviewListRow[] = []

        for (const showId of assignedShowIds) {
          const showSnap = await getDoc(doc(fs, 'shows', showId))
          if (!showSnap.exists()) continue
          const show = showSnap.data() as ShowDoc
          const tz = show.showTimezone || 'America/New_York'

          const sessionsSnap = await getDocs(
            query(
              collection(fs, 'shows', showId, 'sessions'),
              orderBy('scheduledStart', 'asc'),
            ),
          )

          for (const sessDoc of sessionsSnap.docs) {
            out.push({
              showId,
              showName: show.name,
              showTimezone: tz,
              session: { id: sessDoc.id, ...(sessDoc.data() as SessionDoc) },
            })
          }
        }

        out.sort(
          (a, b) =>
            (a.session.scheduledStart?.toMillis?.() ?? 0) -
            (b.session.scheduledStart?.toMillis?.() ?? 0),
        )

        if (!cancelled) setRows(out)
      } catch (err: unknown) {
        console.error('ReviewSessionsPage: load failed', err)
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sessions.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [userDoc, assignedShowIds])

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 'var(--space-8)' }}>
        <span className="spinner" aria-label="Loading sessions" />
      </div>
    )
  }

  return (
    <div>
      <header style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
          Sessions to Review
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          All sessions from your assigned shows — including incomplete or missing content.
        </p>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      ) : null}

      {assignedShowIds.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <p style={{ marginBottom: 'var(--space-2)' }}>No shows assigned.</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Ask an administrator to assign you to one or more shows before you can review sessions.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            No sessions found on your assigned shows.
          </p>
        </div>
      ) : (
        <div className="form-group">
          {rows.map(({ showId, showName, showTimezone, session }) => {
            const reviewState = normalizeReviewState(session, userDoc?.email ?? 'reviewer')
            const startMs = session.scheduledStart?.toMillis?.() ?? 0

            return (
              <article key={`${showId}-${session.id}`} className="card show-list-item">
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
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {showName}
                    </p>
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
