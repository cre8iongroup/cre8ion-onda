'use client'

import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { provisionTechAuthUser } from '@/lib/tech/provisionTechUser'

export default function TechCredentialPanel({
  showId,
  portalSlug,
  hasCredential,
  createdBy,
  canEdit,
}: {
  showId: string
  portalSlug: string
  hasCredential: boolean
  createdBy: string
  canEdit: boolean
}) {
  const [credential, setCredential] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!canEdit) return
    if (credential.trim().length < 8) {
      setError('Credential must be at least 8 characters.')
      return
    }
    if (!portalSlug) {
      setError('Portal slug is required before provisioning tech login.')
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await updateDoc(doc(getClientFirestore(), 'shows', showId), {
        techCredential: credential.trim(),
      })
      const result = await provisionTechAuthUser({
        showId,
        portalSlug,
        techCredential: credential.trim(),
        createdBy,
      })
      if (result.existed) {
        setMessage(
          'Show credential saved. A tech Auth user already existed for this slug — password was not rotated automatically. Use a new portal slug or reset via Firebase Auth if needed.'
        )
      } else {
        setMessage('Tech login provisioned. Operators can sign in at /tech/login with this slug + credential.')
      }
      setCredential('')
    } catch (err: any) {
      console.error('TechCredentialPanel:', err)
      setError(err?.message || 'Failed to save tech credential.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
        Shared Tech Panel login for this show. Status:{' '}
        <span className={`badge ${hasCredential ? 'badge-success' : 'badge-muted'}`}>
          {hasCredential ? 'credential set' : 'not set'}
        </span>
      </p>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
        Login URL: <code>/tech/login</code> · Show code: <code>{portalSlug || '—'}</code>
      </p>

      {canEdit && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="tech-cred-input" className="label">Set / replace credential</label>
            <input
              id="tech-cred-input"
              type="password"
              className="input"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="Min 8 characters"
              autoComplete="new-password"
              disabled={busy}
            />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label className="label">&nbsp;</label>
            <button
              type="button"
              id="btn-save-tech-credential"
              className="btn btn-primary"
              onClick={save}
              disabled={busy || !credential}
            >
              {busy ? 'Saving…' : 'Save tech credential'}
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className="alert alert-success" role="status" style={{ marginTop: 'var(--space-4)' }}>
          {message}
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
