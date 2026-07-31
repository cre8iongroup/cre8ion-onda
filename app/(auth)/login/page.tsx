'use client'

import { Suspense } from 'react'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setCookie } from '@/lib/utils/cookies'
import { useAuthContext } from '@/context/AuthContext'

function LoginForm() {
  const { user, loading, error, signIn } = useAuthContext()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('from') || '/admin'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (!loading && user) {
      router.replace(returnTo)
    }
  }, [user, loading, router, returnTo])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError('')
    setSubmitting(true)

    try {
      await signIn(email, password)
      setCookie('onda-session', '1', 7)
      router.replace(returnTo)
    } catch (err: any) {
      setLocalError(err.message || 'Sign-in failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="auth-shell">
        <span className="spinner" aria-label="Loading" />
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">〜 cre8ion Onda</div>
        <p className="auth-tagline">cre8ion Live Translation Platform</p>

        <form onSubmit={handleSubmit} className="form-group" noValidate>
          <div className="field">
            <label htmlFor="email" className="label">Email address</label>
            <input
              id="email"
              type="email"
              className={`input ${localError ? 'error' : ''}`}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@cre8ion.com"
              autoComplete="email"
              required
              disabled={submitting}
            />
          </div>

          <div className="field">
            <label htmlFor="password" className="label">Password</label>
            <input
              id="password"
              type="password"
              className={`input ${localError ? 'error' : ''}`}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              disabled={submitting}
            />
          </div>

          {(localError || error) && (
            <div className="alert alert-error" role="alert">
              {localError || error}
            </div>
          )}

          <button
            id="btn-sign-in"
            type="submit"
            className="btn btn-primary btn-lg w-full"
            disabled={submitting || !email || !password}
          >
            {submitting ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>

          <div className="text-center">
            <a
              href="/reset-password"
              style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}
            >
              Forgot your password?
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-shell">
          <span className="spinner" aria-label="Loading" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
