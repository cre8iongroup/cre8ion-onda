'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { doc, setDoc, Timestamp } from 'firebase/firestore'
import { sendPasswordResetEmail } from 'firebase/auth'
import { getClientAuth, getClientFirestore } from '@/lib/firebase/client'
import {
  deleteAuthUserByIdToken,
  generateTempPassword,
  signUpAuthUser,
} from '@/lib/firebase/createManagedUser'
import { BASE_ROLE_CAPS } from '@/lib/permissions/roles'
import type { BaseRole, Capabilities, CustomPermissions, ShowDoc, UserDoc, WithId } from '@/types'

const ROLES: BaseRole[] = ['admin', 'editor', 'contributor', 'tech', 'reviewer']

const CAPABILITY_OPTIONS: Array<{ key: keyof Capabilities; label: string }> = [
  { key: 'canCreateShows', label: 'Create shows' },
  { key: 'canEditShows', label: 'Edit shows' },
  { key: 'canManageUsers', label: 'Manage users' },
  { key: 'canAccessTechPanel', label: 'Tech panel' },
  { key: 'canControlLiveFeed', label: 'Control live feed' },
  { key: 'canViewPrivatePreview', label: 'Private preview' },
  { key: 'canApproveTranscripts', label: 'Approve transcripts' },
  { key: 'canPublishSessions', label: 'Publish sessions' },
  { key: 'canExportTranscripts', label: 'Export transcripts' },
  { key: 'canManageBranding', label: 'Manage branding' },
  { key: 'canManageOutputLayouts', label: 'Manage output layouts' },
  { key: 'canDownloadQr', label: 'Download QR codes' },
]

const createUserSchema = z.object({
  email: z.string().trim().email('Valid email is required'),
  displayName: z.string().trim().min(2, 'Display name is required'),
  baseRole: z.enum(['admin', 'editor', 'contributor', 'tech', 'reviewer']),
})

type CreateUserFormValues = z.infer<typeof createUserSchema>

interface CreateUserModalProps {
  open: boolean
  onClose: () => void
  onCreated: (userId: string, tempPassword: string) => void
  createdBy: string
  canManage: boolean
  shows: WithId<ShowDoc>[]
}

export default function CreateUserModal({
  open,
  onClose,
  onCreated,
  createdBy,
  canManage,
  shows,
}: CreateUserModalProps) {
  const titleId = useId()
  const emailRef = useRef<HTMLInputElement | null>(null)
  const [assignedShows, setAssignedShows] = useState<string[]>([])
  const [overrides, setOverrides] = useState<CustomPermissions>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [sendReset, setSendReset] = useState(true)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      displayName: '',
      baseRole: 'editor',
    },
  })

  const { ref: emailRegisterRef, ...emailRegister } = register('email')
  const baseRole = watch('baseRole')

  useEffect(() => {
    if (!open) return
    setAssignedShows([])
    setOverrides({})
    setShowAdvanced(false)
    setSendReset(true)
    reset({ email: '', displayName: '', baseRole: 'editor' })
    const t = window.setTimeout(() => emailRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [open, reset])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, isSubmitting, onClose])

  if (!open) return null

  function toggleShow(showId: string) {
    setAssignedShows((prev) =>
      prev.includes(showId) ? prev.filter((id) => id !== showId) : [...prev, showId]
    )
  }

  function setOverride(key: keyof Capabilities, mode: 'default' | 'allow' | 'deny') {
    setOverrides((prev) => {
      const next = { ...prev }
      if (mode === 'default') delete next[key]
      else next[key] = mode === 'allow'
      return next
    })
  }

  function overrideMode(key: keyof Capabilities): 'default' | 'allow' | 'deny' {
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) return 'default'
    return overrides[key] ? 'allow' : 'deny'
  }

  async function onSubmit(values: CreateUserFormValues) {
    if (!canManage) {
      setError('root', { message: 'You do not have permission to manage users.' })
      return
    }

    const tempPassword = generateTempPassword()
    let authToken: string | null = null

    try {
      const { uid, idToken } = await signUpAuthUser(values.email.trim(), tempPassword)
      authToken = idToken

      const payload: UserDoc = {
        email: values.email.trim().toLowerCase(),
        displayName: values.displayName.trim(),
        baseRole: values.baseRole,
        customPermissions: overrides,
        assignedShows,
        createdAt: Timestamp.now(),
        createdBy,
      }

      const fs = getClientFirestore()
      await setDoc(doc(fs, 'users', uid), payload)

      if (sendReset) {
        try {
          await sendPasswordResetEmail(getClientAuth(), values.email.trim())
        } catch (err) {
          console.warn('CreateUserModal: password reset email failed', err)
        }
      }

      onCreated(uid, tempPassword)
      onClose()
    } catch (err: any) {
      console.error('CreateUserModal: failed to create user', err)
      if (authToken) {
        try {
          await deleteAuthUserByIdToken(authToken)
        } catch (rollbackErr) {
          console.error('CreateUserModal: failed to roll back Auth user', rollbackErr)
        }
      }
      setError('root', {
        message: err?.message || 'Failed to create user. Please try again.',
      })
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose()
      }}
    >
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <h2 id={titleId} style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
              Create User
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Creates a Firebase Auth account and Firestore profile. A temporary password is generated;
              optionally email a reset link.
            </p>
          </div>
          <button
            type="button"
            id="btn-create-user-close"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form className="form-group" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="field">
            <label htmlFor="user-email" className="label">Email</label>
            <input
              id="user-email"
              type="email"
              className={`input ${errors.email ? 'error' : ''}`}
              placeholder="name@cre8ion.com"
              disabled={isSubmitting}
              {...emailRegister}
              ref={(el) => {
                emailRegisterRef(el)
                emailRef.current = el
              }}
            />
            {errors.email && <p className="field-error">{errors.email.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="user-display-name" className="label">Display name</label>
            <input
              id="user-display-name"
              className={`input ${errors.displayName ? 'error' : ''}`}
              placeholder="Alex Sawyer"
              disabled={isSubmitting}
              {...register('displayName')}
            />
            {errors.displayName && <p className="field-error">{errors.displayName.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="user-role" className="label">Role</label>
            <select
              id="user-role"
              className={`input ${errors.baseRole ? 'error' : ''}`}
              disabled={isSubmitting}
              {...register('baseRole')}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </option>
              ))}
            </select>
            {errors.baseRole && <p className="field-error">{errors.baseRole.message}</p>}
          </div>

          <div className="field">
            <span className="label">Assigned shows</span>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
              Leave empty for all shows (typical for admins).
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
                      disabled={isSubmitting}
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

          <div className="field">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={sendReset}
                onChange={(e) => setSendReset(e.target.checked)}
                disabled={isSubmitting}
              />
              <span>Send password-reset email after create</span>
            </label>
          </div>

          <div>
            <button
              type="button"
              id="btn-toggle-permission-overrides"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowAdvanced((v) => !v)}
              disabled={isSubmitting}
            >
              {showAdvanced ? 'Hide' : 'Show'} permission overrides
            </button>
            {showAdvanced && (
              <div className="override-grid" style={{ marginTop: 'var(--space-3)' }}>
                {CAPABILITY_OPTIONS.map(({ key, label }) => {
                  const roleDefault = BASE_ROLE_CAPS[baseRole][key]
                  return (
                    <label key={key} className="field">
                      <span className="label">
                        {label}{' '}
                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                          (role: {roleDefault ? 'on' : 'off'})
                        </span>
                      </span>
                      <select
                        className="input"
                        value={overrideMode(key)}
                        onChange={(e) =>
                          setOverride(key, e.target.value as 'default' | 'allow' | 'deny')
                        }
                        disabled={isSubmitting}
                      >
                        <option value="default">Role default</option>
                        <option value="allow">Force allow</option>
                        <option value="deny">Force deny</option>
                      </select>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {errors.root && (
            <div className="alert alert-error" role="alert">
              {errors.root.message}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              id="btn-create-user-cancel"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-create-user-submit"
              className="btn btn-primary"
              disabled={isSubmitting || !canManage}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Creating…
                </>
              ) : (
                'Create User'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
