'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import SessionReviewList from '@/components/review/SessionReviewList'
import type { SessionDoc, ShowDoc, WithId } from '@/types'

function canAccessShow(
  showId: string,
  isAdmin: boolean,
  assignedShowIds: string[],
): boolean {
  if (isAdmin) return true
  return assignedShowIds.includes(showId)
}

export default function ReviewShowSessionsPage() {
  const params = useParams()
  const showId = typeof params.showId === 'string' ? params.showId : ''
  const { userDoc } = useAuthContext()
  const [show, setShow] = useState<WithId<ShowDoc> | null>(null)
  const [sessions, setSessions] = useState<WithId<SessionDoc>[]>([])
  const [loadingShow, setLoadingShow] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = userDoc?.baseRole === 'admin'
  const assignedShowIds = useMemo(
    () => (Array.isArray(userDoc?.assignedShows) ? userDoc!.assignedShows : []),
    [userDoc?.assignedShows],
  )

  const hasAccess = showId ? canAccessShow(showId, isAdmin, assignedShowIds) : false

  useEffect(() => {
    if (!showId || !userDoc) return

    if (!hasAccess) {
      setShow(null)
      setSessions([])
      setLoadingShow(false)
      setLoadingSessions(false)
      setError('You do not have access to this show.')
      return
    }

    setError(null)
    setLoadingShow(true)
    setLoadingSessions(true)

    const fs = getClientFirestore()
    const unsubShow = onSnapshot(
      doc(fs, 'shows', showId),
      (snap) => {
        if (!snap.exists()) {
          setShow(null)
          setError('Show not found.')
        } else {
          setShow({ id: snap.id, ...(snap.data() as ShowDoc) })
        }
        setLoadingShow(false)
      },
      (err) => {
        console.error('ReviewShowSessionsPage: failed to load show', err)
        setError(err.message || 'Failed to load show.')
        setLoadingShow(false)
      },
    )

    const sessionsQuery = query(
      collection(fs, 'shows', showId, 'sessions'),
      orderBy('scheduledStart', 'asc'),
    )
    const unsubSessions = onSnapshot(
      sessionsQuery,
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) })))
        setLoadingSessions(false)
      },
      (err) => {
        console.error('ReviewShowSessionsPage: failed to load sessions', err)
        setError(err.message || 'Failed to load sessions.')
        setLoadingSessions(false)
      },
    )

    return () => {
      unsubShow()
      unsubSessions()
    }
  }, [showId, userDoc, hasAccess])

  if (!showId) {
    return (
      <div className="alert alert-error" role="alert">
        Invalid show.
      </div>
    )
  }

  if (loadingShow) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 'var(--space-8)' }}>
        <span className="spinner" aria-label="Loading show" />
      </div>
    )
  }

  if (!hasAccess || !show) {
    return (
      <div>
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <Link
            href="/review"
            className="text-sm"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ← Shows
          </Link>
        </div>
        <div className="alert alert-error" role="alert">
          {error || 'Show not found or access denied.'}
        </div>
      </div>
    )
  }

  const showTimezone = show.showTimezone || 'America/New_York'

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Link
          href="/review"
          className="text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          ← Shows
        </Link>
      </div>

      <header style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
          {show.name}
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {show.clientName} — sessions to review, including incomplete or missing content.
        </p>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      ) : null}

      <SessionReviewList
        showId={showId}
        showTimezone={showTimezone}
        sessions={sessions}
        reviewerEmail={userDoc?.email ?? 'reviewer'}
        loading={loadingSessions}
        emptyMessage="No sessions found on this show."
      />
    </div>
  )
}
