'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import type { ShowDoc, UserDoc, WithId } from '@/types'
import CreateUserModal from './CreateUserModal'
import EditUserModal from './EditUserModal'

export default function UsersDashboard() {
  const { user, userDoc, capabilities } = useAuthContext()
  const [users, setUsers] = useState<WithId<UserDoc>[]>([])
  const [shows, setShows] = useState<WithId<ShowDoc>[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editUser, setEditUser] = useState<WithId<UserDoc> | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  const canManage = Boolean(capabilities?.canManageUsers)
  const isAdminRole = userDoc?.baseRole === 'admin'

  const showNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const show of shows) map.set(show.id, show.name)
    return map
  }, [shows])

  useEffect(() => {
    if (!canManage || !isAdminRole) {
      setLoadingUsers(false)
      return
    }

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
        console.error('UsersDashboard: failed to load users', err)
        setError(err.message || 'Failed to load users. Admin role is required by Firestore rules.')
        setLoadingUsers(false)
      }
    )
    return () => unsub()
  }, [canManage, isAdminRole])

  useEffect(() => {
    const fs = getClientFirestore()
    const q = query(collection(fs, 'shows'), orderBy('name', 'asc'))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setShows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ShowDoc) })))
      },
      (err) => console.warn('UsersDashboard: failed to load shows for assignment', err)
    )
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!flash && !createdPassword) return
    const t = window.setTimeout(() => {
      setFlash(null)
    }, 8000)
    return () => window.clearTimeout(t)
  }, [flash, createdPassword])

  const openCreate = useCallback(() => {
    if (!canManage || !isAdminRole) {
      setError('Only admins can manage users (Firestore rules require baseRole admin).')
      return
    }
    setCreatedPassword(null)
    setModalOpen(true)
  }, [canManage, isAdminRole])

  function formatAssignedShows(ids: string[] | undefined | null): string {
    if (!Array.isArray(ids) || ids.length === 0) return 'All shows'
    return ids.map((id) => showNameById.get(id) || String(id).slice(0, 8)).join(', ')
  }

  if (!canManage || !isAdminRole) {
    return (
      <div className="panel-content">
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>Users</h1>
        <div className="alert alert-warning" role="alert">
          You need the Admin role to manage users.
        </div>
      </div>
    )
  }

  return (
    <div className="panel-content">
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 'var(--space-8)', gap: 'var(--space-4)', flexWrap: 'wrap' }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>Users</h1>
          <p>Staff accounts, roles, and show assignments.</p>
        </div>
        <button
          id="btn-create-user"
          type="button"
          className="btn btn-primary"
          onClick={openCreate}
        >
          + Create User
        </button>
      </div>

      {flash && (
        <div className="alert alert-success" role="status" style={{ marginBottom: 'var(--space-6)' }}>
          {flash}
        </div>
      )}

      {createdPassword && (
        <div className="alert alert-info" role="status" style={{ marginBottom: 'var(--space-6)' }}>
          Temporary password (copy now — it won’t be shown again):{' '}
          <code id="created-user-temp-password">{createdPassword}</code>
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error}
        </div>
      )}

      {loadingUsers ? (
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading users" />
        </div>
      ) : users.length === 0 ? (
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
          <div style={{ fontSize: '3rem' }}>👥</div>
          <h2 style={{ fontSize: 'var(--text-lg)' }}>No users found</h2>
          <p style={{ maxWidth: 360 }}>
            Create a staff account to grant Admin, Editor, Tech, or Reviewer access.
          </p>
          <button
            id="btn-create-user-empty"
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
          >
            + Create User
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table" id="users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Assigned shows</th>
                <th>Overrides</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const overrideCount = Object.keys(u.customPermissions || {}).length
                return (
                  <tr key={u.id} id={`user-row-${u.id}`}>
                    <td>
                      {u.displayName || '—'}
                      {u.id === user?.uid && (
                        <span className="badge badge-info" style={{ marginLeft: 'var(--space-2)' }}>
                          You
                        </span>
                      )}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className="badge badge-muted">{u.baseRole}</span>
                    </td>
                    <td className="text-sm">{formatAssignedShows(u.assignedShows)}</td>
                    <td className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      {overrideCount === 0 ? '—' : `${overrideCount} custom`}
                    </td>
                    <td>
                      <button
                        type="button"
                        id={`btn-edit-user-${u.id}`}
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditUser(u)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        createdBy={user?.uid || ''}
        canManage={canManage && isAdminRole}
        shows={shows}
        onCreated={(_uid, tempPassword) => {
          setFlash('User created.')
          setCreatedPassword(tempPassword)
        }}
      />

      <EditUserModal
        open={editUser !== null}
        onClose={() => setEditUser(null)}
        user={editUser}
        shows={shows}
        canManage={canManage && isAdminRole}
        onSaved={() => setFlash('User updated.')}
      />
    </div>
  )
}
