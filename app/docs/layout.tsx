import Link from 'next/link'
import type { Metadata } from 'next'
import DocsSidebar from './DocsSidebar'
import './docs.css'

export const metadata: Metadata = {
  title: 'Docs',
  description: 'Onda documentation — setup, admin, and review.',
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-shell">
      <header className="docs-topbar">
        <Link href="/docs/getting-started" className="docs-brand">
          Onda Docs
        </Link>
        <nav className="docs-top-links" aria-label="Site">
          <Link href="/download">Download</Link>
        </nav>
      </header>
      <div className="docs-body">
        <DocsSidebar />
        <main className="docs-main">{children}</main>
      </div>
    </div>
  )
}
