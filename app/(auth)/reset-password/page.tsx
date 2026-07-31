'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuthContext } from '@/context/AuthContext'

export default function ResetPasswordPage() {
  const { resetPassword } = useAuthContext()
  const [email, setEmail]     = useState('')
  const [sent, setSent]       = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">〜 cre8ion Onda</div>
        <p className="auth-tagline">Reset your password</p>

        {sent ? (
          <div style={{ marginTop: 'var(--space-6)' }}>
            <div className="alert alert-success" role="status">
              Check your email — a password reset link has been sent to <strong>{email}</strong>.
            </div>
            <div className="text-center mt-6">
              <Link href="/login" className="btn btn-secondary btn-sm">
                Back to sign in
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="form-group" noValidate>
            <div className="field">
              <label htmlFor="reset-email" className="label">Email address</label>
              <input
                id="reset-email"
                type="email"
                className={`input ${error ? 'error' : ''}`}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@cre8ion.com"
                autoComplete="email"
                required
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="alert alert-error" role="alert">{error}</div>
            )}

            <button
              id="btn-reset-password"
              type="submit"
              className="btn btn-primary btn-lg w-full"
              disabled={submitting || !email}
            >
              {submitting ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Sending…
                </>
              ) : (
                'Send reset link'
              )}
            </button>

            <div className="text-center">
              <Link href="/login" style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
