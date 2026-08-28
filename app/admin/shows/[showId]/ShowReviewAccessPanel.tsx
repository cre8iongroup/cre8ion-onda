'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import {
  addShowToUserAssignedShows,
  removeShowFromUserAssignedShows,
} from '@/lib/users/assignedShows'
import type { UserDoc, WithId } from '@/types'

type Props = {
  showId: string
  active: boolean
  isAdmin: boolean
}

export default function ShowReviewAccessPanel({ showId, active, isAdmin }: Props) {
  const [users, setUsers] = useState<WithId<UserDoc>[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [selectedReviewerId, setSelectedReviewerId] = useState('')

  useEffect(() => {
    if (!active || !isAdmin) {
      setUsers([])
      setLoadingUsers(false)
      return
    }

    setLoadingUsers(true)
    const fs = getClientFirestore()
    const q = query(collection(fs, 'users'), orderBy('email', 'asc'))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setUsers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as UserDoc) })))
        setError(null)
        setLoadingUsers(false)
      },
      (err) => {
        console.error('ShowReviewAccessPanel: failed to load users', err)
        setError(err.message || 'Failed to load users.')
        setLoadingUsers(false)
      },
    )

    return () => unsub()
  }, [active, isAdmin])

  const reviewerUsers = useMemo(
    () => users.filter((u) => u.baseRole === 'reviewer'),
    [users],
  )

  const assignedReviewers = useMemo(
    () =>
      reviewerUsers.filter((u) =>
        Array.isArray(u.assignedShows) && u.assignedShows.includes(showId),
      ),
    [reviewerUsers, showId],
  )

  const addableReviewers = useMemo(
    () =>
      reviewerUsers.filter(
        (u) => !Array.isArray(u.assignedShows) || !u.assignedShows.includes(showId),
      ),
    [reviewerUsers, showId],
  )

  useEffect(() => {
    if (addableReviewers.some((u) => u.id === selectedReviewerId)) return
    setSelectedReviewerId(addableReviewers[0]?.id ?? '')
  }, [addableReviewers, selectedReviewerId])

  async function handleAddReviewer() {
    if (!selectedReviewerId) return
    const user = addableReviewers.find((u) => u.id === selectedReviewerId)
    if (!user) return

    setBusyUserId(user.id)
    setError(null)
    try {
      const current = Array.isArray(user.assignedShows) ? user.assignedShows : []
      await addShowToUserAssignedShows(user.id, current, showId)
    } catch (err: unknown) {
      console.error('ShowReviewAccessPanel: add reviewer failed', err)
      setError(err instanceof Error ? err.message : 'Failed to add reviewer.')
    } finally {
      setBusyUserId(null)
    }
  }

  async function handleRemoveReviewer(user: WithId<UserDoc>) {
    const current = Array.isArray(user.assignedShows) ? user.assignedShows : []
    const wouldBeLastShow = user.baseRole === 'reviewer' && current.length === 1

    if (wouldBeLastShow) {
      const confirmed = window.confirm(
        `Remove “${user.displayName || user.email}” from this show? They will be left with zero assigned shows. Reviewers must be assigned to at least one show — assign another show in Users before removing their last one.`,
      )
      if (!confirmed) return
    }

    setBusyUserId(user.id)
    setError(null)
    try {
      await removeShowFromUserAssignedShows(user.id, current, showId, user.baseRole)
    } catch (err: unknown) {
      console.error('ShowReviewAccessPanel: remove reviewer failed', err)
      setError(err instanceof Error ? err.message : 'Failed to remove reviewer.')
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="form-group">
      <section className="card" style={{ padding: 'var(--space-5)' }}>
        <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>
          Review panel
        </h3>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
          Open the session list for post-event content review and publishing on this show.
        </p>
        <Link href={`/review/${showId}`} className="btn btn-primary">
          Open Review Panel
        </Link>
      </section>

      {isAdmin ? (
        <section className="card" style={{ padding: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>
            Reviewers for this show
          </h3>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
            Manage which reviewer accounts can access sessions on this show. Updates the same{' '}
            <code>assignedShows</code> field as Users → Edit.
          </p>

          {error ? (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
              {error}
            </div>
          ) : null}

          {loadingUsers ? (
            <div className="flex items-center justify-center" style={{ padding: 'var(--space-6)' }}>
              <span className="spinner" aria-label="Loading reviewers" />
            </div>
          ) : reviewerUsers.length === 0 ? (
            <div
              className="card"
              style={{
                padding: 'var(--space-4)',
                background: 'var(--color-surface-muted, var(--color-bg-subtle))',
              }}
            >
              <p style={{ marginBottom: 'var(--space-2)' }}>No reviewer accounts yet.</p>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Create a reviewer in{' '}
                <Link href="/admin/users">Users → Create User</Link>.
              </p>
            </div>
          ) : (
            <>
              {assignedReviewers.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
                  No reviewers assigned to this show yet.
                </p>
              ) : (
                <div className="table-wrap" style={{ marginBottom: 'var(--space-6)' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {assignedReviewers.map((user) => (
                        <tr key={user.id}>
                          <td>{user.displayName || '—'}</td>
                          <td>{user.email}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busyUserId === user.id}
                              onClick={() => void handleRemoveReviewer(user)}
                            >
                              {busyUserId === user.id ? 'Removing…' : 'Remove'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div>
                <span className="label" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                  Add reviewer
                </span>
                {addableReviewers.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    All reviewer accounts are already assigned to this show.
                  </p>
                ) : (
                  <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <select
                      className="input"
                      value={selectedReviewerId}
                      onChange={(e) => setSelectedReviewerId(e.target.value)}
                      disabled={busyUserId !== null}
                      aria-label="Select reviewer to add"
                    >
                      {addableReviewers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.displayName || user.email} ({user.email})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!selectedReviewerId || busyUserId !== null}
                      onClick={() => void handleAddReviewer()}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Reviewer assignments are managed by admins in Users.
        </p>
      )}
    </div>
  )
}
