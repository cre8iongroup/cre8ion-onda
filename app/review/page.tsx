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
import { userFacingError } from '@/lib/review/userFacingError'
import type { ShowDoc, WithId } from '@/types'

function formatDateRange(start?: Timestamp, end?: Timestamp): string {
  if (!start || !end) return 'Dates TBD'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  return `${start.toDate().toLocaleDateString(undefined, opts)} – ${end.toDate().toLocaleDateString(undefined, opts)}`
}

export default function ReviewShowsPage() {
  const { userDoc } = useAuthContext()
  const [shows, setShows] = useState<WithId<ShowDoc>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = userDoc?.baseRole === 'admin'
  const assignedShowIds = useMemo(
    () => (Array.isArray(userDoc?.assignedShows) ? userDoc!.assignedShows : []),
    [userDoc?.assignedShows],
  )

  useEffect(() => {
    if (!userDoc) return

    const fs = getClientFirestore()

    if (isAdmin) {
      const q = query(collection(fs, 'shows'), orderBy('createdAt', 'desc'))
      const unsub = onSnapshot(
        q,
        (snap) => {
          setShows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ShowDoc) })))
          setError(null)
          setLoading(false)
        },
        (err) => {
          setError(userFacingError(err, 'These shows couldn\'t be loaded.'))
          setLoading(false)
        },
      )
      return () => unsub()
    }

    if (assignedShowIds.length === 0) {
      setShows([])
      setLoading(false)
      return
    }

    setLoading(true)
    const unsubs: Array<() => void> = []
    const showMap = new Map<string, WithId<ShowDoc>>()

    function syncShows() {
      setShows(
        assignedShowIds
          .map((id) => showMap.get(id))
          .filter((s): s is WithId<ShowDoc> => Boolean(s)),
      )
      setLoading(false)
    }

    for (const showId of assignedShowIds) {
      const unsub = onSnapshot(
        doc(fs, 'shows', showId),
        (snap) => {
          if (snap.exists()) {
            showMap.set(showId, { id: snap.id, ...(snap.data() as ShowDoc) })
          } else {
            showMap.delete(showId)
          }
          syncShows()
        },
        (err) => {
          setError(userFacingError(err, 'These shows couldn\'t be loaded.'))
          setLoading(false)
        },
      )
      unsubs.push(unsub)
    }

    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [userDoc, isAdmin, assignedShowIds])

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 'var(--space-8)' }}>
        <span className="spinner" aria-label="Loading shows" />
      </div>
    )
  }

  return (
    <div>
      <header style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
          Shows to Review
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Select a show to review its sessions.
        </p>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      ) : null}

      {!isAdmin && assignedShowIds.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <p style={{ marginBottom: 'var(--space-2)' }}>No shows assigned.</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Ask an administrator to assign you to one or more shows before you can review sessions.
          </p>
        </div>
      ) : shows.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            No shows found.
          </p>
        </div>
      ) : (
        <div className="show-list">
          {shows.map((show) => (
            <Link
              key={show.id}
              id={`link-review-show-${show.id}`}
              href={`/review/${show.id}`}
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
                  <p
                    className="text-sm"
                    style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}
                  >
                    {formatDateRange(show.startDate, show.endDate)}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
