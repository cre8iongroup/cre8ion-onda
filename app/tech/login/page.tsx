'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/client'
import { setCookie } from '@/lib/utils/cookies'

function TechLoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('from') || '/tech'
  const errorParam = searchParams.get('error')

  const [credential, setCredential] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(
    errorParam === 'unauthorized'
      ? 'Your account cannot access the Tech panel.'
      : '',
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    const trimmed = credential.trim()
    if (!trimmed) {
      setError('Enter the tech credential for this show.')
      setSubmitting(false)
      return
    }

    try {
      const res = await fetch('/api/tech/web-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential: trimmed }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        code?: string
        customToken?: string
      }
      if (!res.ok || !json.customToken) {
        if (json.code === 'invalid_credential' || res.status === 401) {
          setError('Invalid tech credential.')
        } else if (json.code === 'ambiguous_credential') {
          setError(json.error || 'Multiple shows share this credential — fix in Admin.')
        } else if (json.code === 'missing_portal_slug') {
          setError(json.error || 'Show is missing a portal slug.')
        } else {
          setError(json.error || 'Sign-in failed.')
        }
        return
      }

      const auth = getClientAuth()
      // Replace any prior session (e.g. admin) with the tech custom-token user.
      if (auth.currentUser) {
        await signOut(auth)
      }
      await signInWithCustomToken(auth, json.customToken)
      setCookie('onda-session', '1', 7)

      const dest =
        returnTo.startsWith('/tech') && !returnTo.startsWith('/tech/login')
          ? returnTo
          : '/tech'
      router.replace(dest)
    } catch (err: unknown) {
      console.error('TechLogin: sign-in failed', err)
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">〜 cre8ion Onda</div>
        <p className="auth-tagline">Tech Operator Panel</p>

        <form onSubmit={handleSubmit} className="form-group" noValidate>
          <div className="field">
            <label htmlFor="tech-credential" className="label">Tech credential</label>
            <input
              id="tech-credential"
              type="password"
              className={`input ${error ? 'error' : ''}`}
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="Shared show password"
              autoComplete="current-password"
              required
              disabled={submitting}
              autoFocus
            />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
              Same credential used in Onda Operator. No show code needed.
            </p>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <button
            id="btn-tech-sign-in"
            type="submit"
            className="btn btn-primary btn-lg w-full"
            disabled={submitting || !credential.trim()}
          >
            {submitting ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                Signing in…
              </>
            ) : (
              'Enter Tech Panel'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function TechLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-shell">
          <span className="spinner" aria-label="Loading" />
        </div>
      }
    >
      <TechLoginForm />
    </Suspense>
  )
}
