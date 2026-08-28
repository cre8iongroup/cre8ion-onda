'use client'

import { useEffect, useId, useState } from 'react'
import { getClientFirestore } from '@/lib/firebase/client'
import {
  setUserAssignedShows,
  validateReviewerAssignedShows,
} from '@/lib/users/assignedShows'
import type { ShowDoc, UserDoc, WithId } from '@/types'

interface EditUserModalProps {
  open: boolean
  onClose: () => void
  user: WithId<UserDoc> | null
  shows: WithId<ShowDoc>[]
  canManage: boolean
  onSaved: () => void
}

export default function EditUserModal({
  open,
  onClose,
  user,
  shows,
  canManage,
  onSaved,
}: EditUserModalProps) {
  const titleId = useId()
  const [assignedShows, setAssignedShows] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setAssignedShows(Array.isArray(user.assignedShows) ? [...user.assignedShows] : [])
    setError(null)
  }, [open, user])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, saving, onClose])

  if (!open || !user) return null

  function toggleShow(showId: string) {
    setAssignedShows((prev) =>
      prev.includes(showId) ? prev.filter((id) => id !== showId) : [...prev, showId],
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    if (!canManage) {
      setError('You do not have permission to manage users.')
      return
    }

    const validationError = validateReviewerAssignedShows(user.baseRole, assignedShows)
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError(null)

    try {
      await setUserAssignedShows(user.id, assignedShows)
      onSaved()
      onClose()
    } catch (err: unknown) {
      console.error('EditUserModal: failed to update user', err)
      setError(err instanceof Error ? err.message : 'Failed to update user. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <h2 id={titleId} style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
              Edit User
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {user.displayName || user.email}
            </p>
          </div>
          <button
            type="button"
            id="btn-edit-user-close"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form className="form-group" onSubmit={onSubmit} noValidate>
          <div className="field">
            <span className="label">Role</span>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              <span className="badge badge-muted">{user.baseRole}</span>
              {' '}
              Role changes are create-only for now — edit assigned shows below.
            </p>
          </div>

          <div className="field">
            <span className="label">Assigned shows</span>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
              {user.baseRole === 'reviewer'
                ? 'Required — reviewers only see sessions from assigned shows.'
                : 'Leave empty for all shows (typical for admins).'}
            </p>
            {shows.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No shows yet.</p>
            ) : (
              <div className="checkbox-grid">
                {shows.map((show) => (
                  <label key={show.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={assignedShows.includes(show.id)}
                      onChange={() => toggleShow(show.id)}
                      disabled={saving}
                    />
                    <span>
                      {show.name}
                      <span style={{ color: 'var(--color-text-muted)' }}> · {show.clientName}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              id="btn-edit-user-cancel"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-edit-user-submit"
              className="btn btn-primary"
              disabled={saving || !canManage}
            >
              {saving ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Saving…
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
