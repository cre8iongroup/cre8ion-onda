'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthContext } from '@/context/AuthContext'
import { WhyOndaLink } from '@/components/WhyOndaModal'

const ADMIN_NAV = [
  { href: '/admin',               label: 'Shows',        icon: '🎬', show: () => true },
  { href: '/admin/users',         label: 'Users',        icon: '👥', show: (c: { canManageUsers?: boolean }) => Boolean(c.canManageUsers) },
  { href: '/admin/layouts',       label: 'Output Presets', icon: '🖥️', show: (c: { canManageOutputLayouts?: boolean }) => Boolean(c.canManageOutputLayouts) },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, userDoc, capabilities, loading, signOut } = useAuthContext()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/login?from=/admin')
      return
    }
    // Must have at least one staff capability (editors/admins or QR-only contributors)
    if (
      !capabilities?.canCreateShows &&
      !capabilities?.canManageUsers &&
      !capabilities?.canEditShows &&
      !capabilities?.canDownloadQr &&
      !capabilities?.canManageTech &&
      !capabilities?.canManageBranding
    ) {
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

  return (
    <div className="panel-shell">
      {/* Sidebar */}
      <aside className="panel-sidebar" aria-label="Admin navigation">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">〜 cre8ion Onda</div>
          <div className="sidebar-logo-sub">Admin Panel</div>
        </div>

        <nav>
          {ADMIN_NAV.filter((item) => item.show(capabilities || {})).map(({ href, label, icon }) => (
            <Link key={href} href={href} className="nav-item">
              <span>{icon}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* User info + sign out */}
        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--color-border)' }}>
          <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
            {userDoc?.displayName || userDoc?.email}
          </p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
            {userDoc?.baseRole}
          </p>
          <button
            id="btn-admin-signout"
            className="btn btn-ghost btn-sm w-full"
            onClick={async () => {
              await signOut()
              document.cookie = 'onda-session=; Max-Age=0; path=/'
              router.replace('/login')
            }}
          >
            Sign out
          </button>
          <div className="sidebar-footer-link">
            <WhyOndaLink id="btn-admin-why-onda" />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="panel-main">
        {children}
      </main>
    </div>
  )
}
