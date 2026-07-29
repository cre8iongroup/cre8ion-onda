import Link from 'next/link'
import type { Metadata } from 'next'
import './download.css'

export const metadata: Metadata = {
  title: 'Download Onda Operator',
  description: 'Download Onda Operator for Windows. Mac installer coming soon.',
}

/** Stable Storage object — overwrite in place on each new Windows build. */
const WINDOWS_INSTALLER_PATH = 'installers/OndaOperatorSetup.exe'
const WINDOWS_INSTALLER_BUCKET = 'cre8ion-onda.firebasestorage.app'
const WINDOWS_INSTALLER_URL = `https://firebasestorage.googleapis.com/v0/b/${WINDOWS_INSTALLER_BUCKET}/o/${encodeURIComponent(WINDOWS_INSTALLER_PATH)}?alt=media`

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
          Desktop installer for live session operation. Windows is available now; Mac is coming
          soon.
        </p>

        <div className="dl-cards">
          <div className="dl-card">
            <h2>Windows</h2>
            <p>Onda Operator for Windows (x64).</p>
            <a
              className="btn btn-primary"
              href={WINDOWS_INSTALLER_URL}
              download="OndaOperatorSetup.exe"
            >
              Download for Windows
            </a>
            <p className="dl-note">
              For Windows only. Unsigned installer — click through the SmartScreen prompt on first
              run.
            </p>
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
