'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthContext } from '@/context/AuthContext'

const REVIEW_NAV = [
  { href: '/review', label: 'Shows', icon: '📋' },
]

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  const { user, userDoc, capabilities, loading, signOut } = useAuthContext()
  const router = useRouter()

  const isDedicatedReviewer = userDoc?.baseRole === 'reviewer'
  const showAdminExit = !isDedicatedReviewer

  const navItems = useMemo(() => {
    if (!showAdminExit) return REVIEW_NAV
    return [
      { href: '/admin', label: 'Admin Panel', icon: '⚙️' },
      ...REVIEW_NAV,
    ]
  }, [showAdminExit])

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/login?from=/review')
      return
    }
    if (!capabilities?.canApproveTranscripts) {
      router.replace('/login?error=unauthorized')
    }
  }, [user, capabilities, loading, router])

  if (loading || !user || !capabilities) {
    return (
      <div className="auth-shell">
        <span className="spinner" aria-label="Loading" />
      </div>
    )
  }

  const roleBadgeClass = isDedicatedReviewer ? 'badge-info' : 'badge-muted'
  const roleLabel = userDoc?.baseRole ?? 'staff'

  return (
    <div className="panel-shell">
      <aside className="panel-sidebar" aria-label="Review navigation">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">〜 cre8ion Onda</div>
          <div className="sidebar-logo-sub">
            {showAdminExit ? 'Review' : 'Reviewer Panel'}
          </div>
        </div>

        <nav>
          {navItems.map(({ href, label, icon }) => (
            <Link key={href} href={href} className="nav-item">
              <span>{icon}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--color-border)' }}>
          <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
            {userDoc?.displayName || userDoc?.email}
          </p>
          <span className={`badge ${roleBadgeClass}`} style={{ marginBottom: 'var(--space-3)' }}>
            {roleLabel}
          </span>
          <button
            id="btn-review-signout"
            className="btn btn-ghost btn-sm w-full"
            onClick={async () => {
              await signOut()
              document.cookie = 'onda-session=; Max-Age=0; path=/'
              router.replace('/login')
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="panel-main">
        <div className="panel-content">{children}</div>
      </main>
    </div>
  )
}
