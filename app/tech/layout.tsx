'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthContext } from '@/context/AuthContext'
import { portalSlugFromTechEmail } from '@/lib/tech/credentials'
import {
  TECH_CHECKIN_EVENT,
  clearTechCheckIn,
  readTechCheckIn,
  techCheckInHref,
  techOutputHref,
  type TechCheckIn,
} from '@/lib/tech/checkIn'

export default function TechLayout({ children }: { children: React.ReactNode }) {
  const { user, userDoc, capabilities, loading, signOut } = useAuthContext()
  const router = useRouter()
  const pathname = usePathname()
  const isLogin = pathname === '/tech/login' || pathname?.startsWith('/tech/login/')

  const [checkIn, setCheckIn] = useState<TechCheckIn | null>(null)

  const refreshCheckIn = useCallback(() => {
    setCheckIn(readTechCheckIn())
  }, [])

  useEffect(() => {
    refreshCheckIn()
    window.addEventListener(TECH_CHECKIN_EVENT, refreshCheckIn)
    return () => window.removeEventListener(TECH_CHECKIN_EVENT, refreshCheckIn)
  }, [refreshCheckIn, pathname])

  useEffect(() => {
    if (isLogin) return
    if (loading) return
    if (!user) {
      const search = typeof window !== 'undefined' ? window.location.search : ''
      const from = `${pathname || '/tech'}${search || ''}`
      router.replace(`/tech/login?from=${encodeURIComponent(from)}`)
      return
    }
    // Wait until capabilities are loaded — null means still resolving users/{uid}.
    if (capabilities === null) return
    if (!capabilities.canAccessTechPanel) {
      router.replace('/tech/login?error=unauthorized')
    }
  }, [user, capabilities, loading, router, isLogin, pathname])

  if (isLogin) {
    return <>{children}</>
  }

  if (loading || !user || capabilities === null || !capabilities.canAccessTechPanel) {
    return (
      <div className="auth-shell">
        <span className="spinner" aria-label="Loading" />
      </div>
    )
  }

  const showLabel =
    portalSlugFromTechEmail(userDoc?.email || user.email || '') ||
    userDoc?.displayName ||
    'Tech'

  const assigned = userDoc?.assignedShows || []
  const inRoom = Boolean(checkIn)
  const outputHref = checkIn
    ? techOutputHref(checkIn.showId, checkIn.roomId)
    : '/tech'
  const onOutput =
    pathname === '/tech/output' || Boolean(pathname?.startsWith('/tech/output/'))
  const onCheckIn = pathname === '/tech'

  function handleChangeRoom() {
    const showId = checkIn?.showId || null
    clearTechCheckIn()
    router.push(techCheckInHref(showId))
  }

  async function handleSignOut() {
    clearTechCheckIn()
    await signOut()
    document.cookie = 'onda-session=; Max-Age=0; path=/'
    router.replace('/tech/login')
  }

  return (
    <div className="panel-shell">
      <aside className="panel-sidebar" aria-label="Tech navigation">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">〜 cre8ion Onda</div>
          <div className="sidebar-logo-sub">Tech Panel</div>
        </div>

        <nav>
          {inRoom ? (
            <>
              <div
                style={{
                  padding: 'var(--space-3) var(--space-6)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                <p
                  className="text-sm"
                  style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}
                >
                  Checked in
                </p>
                <p
                  className="truncate"
                  style={{
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    marginBottom: checkIn?.showName ? 'var(--space-1)' : 0,
                  }}
                  title={checkIn?.roomName}
                >
                  {checkIn?.roomName}
                </p>
                {checkIn?.showName ? (
                  <p
                    className="text-sm truncate"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={checkIn.showName}
                  >
                    {checkIn.showName}
                  </p>
                ) : null}
              </div>
              <Link
                href={outputHref}
                className={`nav-item${onOutput ? ' active' : ''}`}
                id="nav-tech-output"
              >
                <span>🖥️</span>
                <span>Output</span>
              </Link>
              <button
                type="button"
                id="btn-tech-change-room"
                className="nav-item"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                  color: 'inherit',
                }}
                onClick={handleChangeRoom}
              >
                <span>↩</span>
                <span>Change room</span>
              </button>
            </>
          ) : (
            <Link
              href="/tech"
              className={`nav-item${onCheckIn ? ' active' : ''}`}
              id="nav-tech-checkin"
            >
              <span>🚪</span>
              <span>Check in</span>
            </Link>
          )}
        </nav>

        <div style={{ flex: 1 }} />

        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--color-border)' }}>
          <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
            {showLabel}
          </p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
            {assigned.length === 1 ? '1 show scoped' : `${assigned.length || 0} shows scoped`}
          </p>
          <span className="badge badge-standby" style={{ marginBottom: 'var(--space-3)' }}>Tech</span>
          <button
            id="btn-tech-signout"
            className="btn btn-ghost btn-sm w-full"
            onClick={() => void handleSignOut()}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="panel-main">{children}</main>
    </div>
  )
}
