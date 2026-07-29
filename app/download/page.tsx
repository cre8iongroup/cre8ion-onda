import Link from 'next/link'
import type { Metadata } from 'next'
import './download.css'

export const metadata: Metadata = {
  title: 'Download Onda Operator',
  description: 'Download Onda Operator for Windows or Mac. Installers coming soon.',
}

export default function DownloadPage() {
  return (
    <div className="dl-shell">
      <header className="dl-topbar">
        <Link href="/docs/getting-started" className="dl-brand">
          Onda
        </Link>
        <nav className="dl-top-links" aria-label="Site">
          <Link href="/docs/getting-started">Docs</Link>
        </nav>
      </header>

      <main className="dl-main">
        <h1 className="dl-title">Download Onda Operator</h1>
        <p className="dl-lede">
          Desktop installers for live session operation. Coming soon — links will appear here when
          builds are ready.
        </p>

        <div className="dl-cards">
          <div className="dl-card" aria-disabled="true">
            <h2>Windows</h2>
            <p>Onda Operator for Windows (x64).</p>
            <button type="button" className="btn btn-primary" disabled>
              Download for Windows — coming soon
            </button>
          </div>

          <div className="dl-card" aria-disabled="true">
            <h2>Mac</h2>
            <p>Onda Operator for macOS.</p>
            <button type="button" className="btn btn-primary" disabled>
              Download for Mac — coming soon
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
