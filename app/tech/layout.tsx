'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthContext } from '@/context/AuthContext'
import { portalSlugFromTechEmail } from '@/lib/tech/credentials'

const TECH_NAV = [
  { href: '/tech', label: 'Sessions', icon: '📡' },
  { href: '/tech/output', label: 'Output', icon: '🖥️' },
  { href: '/tech/network', label: 'Network', icon: '🌐' },
]

export default function TechLayout({ children }: { children: React.ReactNode }) {
  const { user, userDoc, capabilities, loading, signOut } = useAuthContext()
  const router = useRouter()
  const pathname = usePathname()
  const isLogin = pathname === '/tech/login' || pathname?.startsWith('/tech/login/')

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
    // Treating null as denied caused bounce to ?error=unauthorized after custom-token login.
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

  return (
    <div className="panel-shell">
      <aside className="panel-sidebar" aria-label="Tech navigation">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">〜 cre8ion Onda</div>
          <div className="sidebar-logo-sub">Tech Panel</div>
        </div>

        <nav>
          {TECH_NAV.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-item${pathname === href || (href !== '/tech' && pathname?.startsWith(href)) ? ' active' : ''}`}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </Link>
          ))}
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
            onClick={async () => {
              await signOut()
              document.cookie = 'onda-session=; Max-Age=0; path=/'
              router.replace('/tech/login')
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="panel-main">{children}</main>
    </div>
  )
}
