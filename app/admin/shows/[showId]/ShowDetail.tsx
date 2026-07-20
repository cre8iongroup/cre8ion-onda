'use client'

import { useCallback, useEffect, useState } from 'react'
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
import CreateSessionModal from './CreateSessionModal'

function formatDateRange(start?: Timestamp, end?: Timestamp): string {
  if (!start || !end) return 'Dates TBD'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  return `${start.toDate().toLocaleDateString(undefined, opts)} – ${end.toDate().toLocaleDateString(undefined, opts)}`
}

function formatDateTime(ts?: Timestamp): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function statusBadgeClass(status: SessionDoc['lifecycleStatus']): string {
  switch (status) {
    case 'live':
      return 'badge-live'
    case 'published':
    case 'approved':
      return 'badge-success'
    case 'ready':
      return 'badge-info'
    case 'underReview':
      return 'badge-warning'
    default:
      return 'badge-muted'
  }
}

export default function ShowDetail({ showId }: { showId: string }) {
  const { user, capabilities } = useAuthContext()
  const [show, setShow] = useState<WithId<ShowDoc> | null>(null)
  const [sessions, setSessions] = useState<WithId<SessionDoc>[]>([])
  const [loadingShow, setLoadingShow] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const canCreate = Boolean(capabilities?.canCreateShows || capabilities?.canEditShows)

  useEffect(() => {
    const fs = getClientFirestore()
    const unsub = onSnapshot(
      doc(fs, 'shows', showId),
      (snap) => {
        if (!snap.exists()) {
          setShow(null)
          setError('Show not found.')
        } else {
          setShow({ id: snap.id, ...(snap.data() as ShowDoc) })
          setError(null)
        }
        setLoadingShow(false)
      },
      (err) => {
        console.error('ShowDetail: failed to load show', err)
        setError(err.message || 'Failed to load show.')
        setLoadingShow(false)
      }
    )
    return () => unsub()
  }, [showId])

  useEffect(() => {
    const fs = getClientFirestore()
    const q = query(
      collection(fs, 'shows', showId, 'sessions'),
      orderBy('scheduledStart', 'asc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) })))
        setLoadingSessions(false)
      },
      (err) => {
        console.error('ShowDetail: failed to load sessions', err)
        setError(err.message || 'Failed to load sessions.')
        setLoadingSessions(false)
      }
    )
    return () => unsub()
  }, [showId])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 4000)
    return () => window.clearTimeout(t)
  }, [flash])

  const openCreate = useCallback(() => {
    if (!canCreate) {
      setError('You do not have permission to create sessions.')
      return
    }
    setModalOpen(true)
  }, [canCreate])

  if (loadingShow) {
    return (
      <div className="panel-content">
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading show" />
        </div>
      </div>
    )
  }

  if (!show) {
    return (
      <div className="panel-content">
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error || 'Show not found.'}
        </div>
        <Link href="/admin" className="btn btn-ghost">
          ← Back to Shows
        </Link>
      </div>
    )
  }

  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Link
          href="/admin"
          id="link-back-to-shows"
          className="text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          ← Shows
        </Link>
      </div>

      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 'var(--space-8)', gap: 'var(--space-4)', flexWrap: 'wrap' }}
      >
        <div>
          <div className="flex items-center gap-4" style={{ marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>{show.name}</h1>
            <span className={`badge ${show.portalPublished ? 'badge-success' : 'badge-muted'}`}>
              {show.portalPublished ? 'Published' : 'Draft'}
            </span>
          </div>
          <p style={{ color: 'var(--color-text-secondary)' }}>{show.clientName}</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
            {formatDateRange(show.startDate, show.endDate)}
            {' · '}
            /portal/{show.branding?.portalURL || '—'}
          </p>
        </div>
        {canCreate && (
          <button
            id="btn-create-session"
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
          >
            + Create Session
          </button>
        )}
      </div>

      {flash && (
        <div className="alert alert-success" role="status" style={{ marginBottom: 'var(--space-6)' }}>
          {flash}
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error}
        </div>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Sessions</h2>

        {loadingSessions ? (
          <div className="flex items-center justify-center" style={{ padding: 'var(--space-12)' }}>
            <span className="spinner" aria-label="Loading sessions" />
          </div>
        ) : sessions.length === 0 ? (
          <div
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-12)',
              textAlign: 'center',
              gap: 'var(--space-4)',
            }}
          >
            <div style={{ fontSize: '2.5rem' }}>🎙️</div>
            <h3 style={{ fontSize: 'var(--text-md)' }}>No sessions yet</h3>
            <p style={{ maxWidth: 360, color: 'var(--color-text-secondary)' }}>
              Create a session for each room or stage. Sessions hold live feed state, transcripts,
              and review workflow.
            </p>
            <button
              id="btn-create-session-empty"
              type="button"
              className="btn btn-primary"
              onClick={openCreate}
              disabled={!canCreate}
            >
              + Create Session
            </button>
          </div>
        ) : (
          <div className="show-list">
            {sessions.map((session) => (
              <article key={session.id} id={`session-${session.id}`} className="card show-list-item">
                <div className="flex items-center justify-between gap-4" style={{ flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-1)' }}>
                      {session.title}
                    </h3>
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {session.friendlyName}
                      {session.location ? ` · ${session.location}` : ''}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                      {formatDateTime(session.scheduledStart)} – {formatDateTime(session.scheduledEnd)}
                    </p>
                  </div>
                  <div className="flex gap-2" style={{ alignItems: 'center' }}>
                    <span className={`badge ${statusBadgeClass(session.lifecycleStatus)}`}>
                      {session.lifecycleStatus}
                    </span>
                    <span className="badge badge-muted">{session.feedState}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <CreateSessionModal
        open={modalOpen}
        showId={showId}
        createdBy={user?.uid || ''}
        canCreate={canCreate}
        defaultLanguages={show.defaultLanguages || ['en']}
        onClose={() => setModalOpen(false)}
        onCreated={() => setFlash('Session created.')}
      />
    </div>
  )
}
