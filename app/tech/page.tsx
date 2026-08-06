'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import type { SessionDoc, ShowDoc, WithId } from '@/types'
import { resolveRoomName } from '@/lib/rooms'

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfTomorrow(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 2)
  return d
}

function formatWhen(ts?: Timestamp): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isRelevantNow(session: SessionDoc): boolean {
  const start = session.scheduledStart?.toDate?.()
  const end = session.scheduledEnd?.toDate?.()
  if (!start || !end) return true
  const windowStart = startOfToday()
  const windowEnd = endOfTomorrow()
  const liveish =
    session.feedState === 'live' ||
    session.feedState === 'stopping' ||
    session.feedState === 'testing'
  if (liveish) return true
  return end >= windowStart && start <= windowEnd
}

export default function TechSessionsPage() {
  const { userDoc } = useAuthContext()
  const assignedShows = useMemo(
    () => (Array.isArray(userDoc?.assignedShows) ? userDoc!.assignedShows : []),
    [userDoc],
  )
  const isAdmin = userDoc?.baseRole === 'admin'
  const needsShowPicker = isAdmin || assignedShows.length !== 1

  const [showId, setShowId] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState<Array<{ id: string; name: string }>>([])
  const [show, setShow] = useState<WithId<ShowDoc> | null>(null)
  const [sessions, setSessions] = useState<WithId<SessionDoc>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!needsShowPicker && assignedShows[0]) {
      setShowId(assignedShows[0])
      return
    }
    if (!needsShowPicker) return
    const fs = getClientFirestore()
    return onSnapshot(
      query(collection(fs, 'shows'), orderBy('name', 'asc')),
      (snap) => {
        const opts = snap.docs.map((d) => ({
          id: d.id,
          name: (d.data() as ShowDoc).name || d.id,
        }))
        setShowOptions(opts)
        setShowId((prev) => prev || opts[0]?.id || null)
        setLoading(false)
      },
      (err) => {
        setError(err.message || 'Failed to load shows.')
        setLoading(false)
      },
    )
  }, [needsShowPicker, assignedShows])

  useEffect(() => {
    if (!showId) {
      if (!needsShowPicker) {
        setLoading(false)
        setError('This tech account is not assigned to a show.')
      }
      return
    }

    const fs = getClientFirestore()
    const unsubShow = onSnapshot(
      doc(fs, 'shows', showId),
      (snap) => {
        if (!snap.exists()) {
          setError('Assigned show not found.')
          setShow(null)
        } else {
          setShow({ id: snap.id, ...(snap.data() as ShowDoc) })
          setError(null)
        }
      },
      (err) => {
        console.error('TechSessions: show load failed', err)
        setError(err.message || 'Failed to load show.')
      },
    )

    const q = query(
      collection(fs, 'shows', showId, 'sessions'),
      orderBy('scheduledStart', 'asc'),
    )
    const unsubSessions = onSnapshot(
      q,
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) })))
        setLoading(false)
      },
      (err) => {
        console.error('TechSessions: sessions load failed', err)
        setError(err.message || 'Failed to load sessions.')
        setLoading(false)
      },
    )

    return () => {
      unsubShow()
      unsubSessions()
    }
  }, [showId, needsShowPicker])

  const relevant = sessions.filter((s) => s.isDraft !== true && isRelevantNow(s))

  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>Sessions</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          {show ? (
            <>
              {show.name}
              <span style={{ color: 'var(--color-text-muted)' }}> · {show.clientName}</span>
            </>
          ) : (
            'Select a show'
          )}
        </p>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
          Showing upcoming / live sessions for today and tomorrow.
        </p>
      </div>

      {needsShowPicker && showOptions.length > 0 ? (
        <div className="field" style={{ maxWidth: 360, marginBottom: 'var(--space-6)' }}>
          <label htmlFor="tech-sessions-show" className="label">Show</label>
          <select
            id="tech-sessions-show"
            className="input"
            value={showId || ''}
            onChange={(e) => {
              setShowId(e.target.value || null)
              setLoading(true)
            }}
          >
            {showOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading sessions" />
        </div>
      ) : relevant.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>No sessions in window</h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {sessions.length === 0
              ? 'This show has no sessions yet. Ask an admin to create one.'
              : 'No sessions scheduled for today/tomorrow. Live or stopping feeds still appear here.'}
          </p>
        </div>
      ) : (
        <div className="show-list">
          {relevant.map((session) => (
            <Link
              key={session.id}
              id={`link-tech-session-${session.id}`}
              href={`/tech/sessions/${session.id}?showId=${showId}`}
              className="card card-interactive show-list-item"
            >
              <div className="flex items-center justify-between gap-4" style={{ flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
                    {session.title}
                  </h2>
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {session.friendlyName}
                    {session.roomId
                      ? ` · ${resolveRoomName(show?.rooms, session.roomId)}`
                      : ''}
                  </p>
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                    {formatWhen(session.scheduledStart)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className={`badge ${session.feedState === 'live' ? 'badge-live' : 'badge-standby'}`}>
                    feed: {session.feedState}
                  </span>
                  {session.isDraft ? (
                    <span className="badge badge-muted">draft</span>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
