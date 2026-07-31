'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import type { ShowDoc, WithId } from '@/types'
import CreateShowModal from './CreateShowModal'

function formatDateRange(start?: Timestamp, end?: Timestamp): string {
  if (!start || !end) return 'Dates TBD'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  return `${start.toDate().toLocaleDateString(undefined, opts)} – ${end.toDate().toLocaleDateString(undefined, opts)}`
}

export default function ShowsDashboard() {
  const router = useRouter()
  const { user, capabilities } = useAuthContext()
  const [shows, setShows] = useState<WithId<ShowDoc>[]>([])
  const [loadingShows, setLoadingShows] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const canCreate = Boolean(capabilities?.canCreateShows)

  useEffect(() => {
    const fs = getClientFirestore()
    const q = query(collection(fs, 'shows'), orderBy('createdAt', 'desc'))
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ShowDoc) }))
        setShows(next)
        setListError(null)
        setLoadingShows(false)
      },
      (err) => {
        console.error('ShowsDashboard: failed to load shows', err)
        setListError(err.message || 'Failed to load shows.')
        setLoadingShows(false)
      }
    )
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 4000)
    return () => window.clearTimeout(t)
  }, [flash])

  const openCreate = useCallback(() => {
    if (!canCreate) {
      setListError('You do not have permission to create shows.')
      return
    }
    setModalOpen(true)
  }, [canCreate])

  return (
    <div className="panel-content">
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 'var(--space-8)', gap: 'var(--space-4)', flexWrap: 'wrap' }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>Shows</h1>
          <p>All events managed through Onda.</p>
        </div>
        {canCreate && (
          <button
            id="btn-create-show"
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
          >
            + Create Show
          </button>
        )}
      </div>

      {flash && (
        <div className="alert alert-success" role="status" style={{ marginBottom: 'var(--space-6)' }}>
          {flash}
        </div>
      )}

      {listError && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {listError}
        </div>
      )}

      {loadingShows ? (
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading shows" />
        </div>
      ) : shows.length === 0 ? (
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-16)',
            textAlign: 'center',
            gap: 'var(--space-4)',
          }}
        >
          <div style={{ fontSize: '3rem' }}>🎬</div>
          <h2 style={{ fontSize: 'var(--text-lg)' }}>No shows yet</h2>
          <p style={{ maxWidth: 360 }}>
            Create your first show to get started. Shows hold all sessions, branding, and glossary
            for a single client event.
          </p>
          <button
            id="btn-create-show-empty"
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-2)' }}
            onClick={openCreate}
            disabled={!canCreate}
          >
            + Create Show
          </button>
          {!canCreate && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Your account cannot create shows. Ask an admin for access.
            </p>
          )}
        </div>
      ) : (
        <div className="show-list">
          {shows.map((show) => (
            <Link
              key={show.id}
              id={`link-show-${show.id}`}
              href={`/admin/shows/${show.id}`}
              className="card card-interactive show-list-item"
            >
              <div className="flex items-center justify-between gap-4" style={{ flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
                    {show.name}
                  </h2>
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {show.clientName}
                  </p>
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                    {formatDateRange(show.startDate, show.endDate)}
                    {' · '}
                    /show/{show.branding?.portalURL || '—'}
                  </p>
                </div>
                <span className={`badge ${show.portalPublished ? 'badge-success' : 'badge-muted'}`}>
                  {show.portalPublished ? 'Published' : 'Draft'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateShowModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        createdBy={user?.uid || ''}
        canCreate={canCreate}
        onCreated={(showId) => {
          setFlash('Show created.')
          router.push(`/admin/shows/${showId}`)
        }}
      />
    </div>
  )
}
