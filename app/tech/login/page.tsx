'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/client'
import { setCookie } from '@/lib/utils/cookies'
import { techEmailForPortalSlug } from '@/lib/tech/credentials'

function TechLoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('from') || '/tech'

  const [portalSlug, setPortalSlug] = useState('')
  const [credential, setCredential] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    const slug = portalSlug.trim().toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setError('Enter a valid portal slug (lowercase letters, numbers, hyphens).')
      setSubmitting(false)
      return
    }

    try {
      const auth = getClientAuth()
      await signInWithEmailAndPassword(auth, techEmailForPortalSlug(slug), credential)
      setCookie('onda-session', '1', 7)
      router.replace(returnTo.startsWith('/tech') ? returnTo : '/tech')
    } catch (err: any) {
      console.error('TechLogin: sign-in failed', err)
      const code = err?.code || ''
      if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
        setError('Invalid show code or tech credential.')
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Try again later.')
      } else {
        setError(err?.message || 'Sign-in failed.')
      }
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
            <label htmlFor="tech-portal-slug" className="label">Show code (portal slug)</label>
            <input
              id="tech-portal-slug"
              className={`input ${error ? 'error' : ''}`}
              value={portalSlug}
              onChange={(e) => setPortalSlug(e.target.value)}
              placeholder="alpfa-2026"
              autoComplete="username"
              required
              disabled={submitting}
            />
          </div>

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
            />
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
            disabled={submitting || !portalSlug || !credential}
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
