'use client'

import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  INSTALLERS,
  parsePlatform,
  type DownloadPlatform,
  type InstallerConfig,
} from '@/app/download/installers'
import { PlatformInstructions } from './PlatformInstructions'

function triggerDownload(installer: InstallerConfig) {
  const a = document.createElement('a')
  a.href = installer.url
  a.download = installer.filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export default function DownloadSuccessClient() {
  const searchParams = useSearchParams()
  const platform = parsePlatform(searchParams.get('platform'))

  const installer: InstallerConfig | null = useMemo(() => {
    if (!platform) return null
    return INSTALLERS[platform]
  }, [platform])

  useEffect(() => {
    if (!installer?.available) return
    triggerDownload(installer)
  }, [installer])

  const title = platformTitle(platform)
  const lede = platformLede(platform, installer)

  return (
    <div className="dl-shell">
      <header className="dl-topbar">
        <Link href="/docs/getting-started" className="dl-brand">
          Onda
        </Link>
        <nav className="dl-top-links" aria-label="Site">
          <Link href="/download">Download</Link>
          <Link href="/docs/getting-started">Docs</Link>
        </nav>
      </header>

      <main className="dl-main dl-success-main">
        <p className="dl-eyebrow">Download started</p>
        <h1 className="dl-title">{title}</h1>
        <p className="dl-lede">{lede}</p>

        {installer?.available ? (
          <p className="dl-fallback">
            If the download did not start automatically,{' '}
            <a href={installer.url} download={installer.filename}>
              click here to download {installer.filename}
            </a>
            .
          </p>
        ) : platform === 'mac' ? (
          <p className="dl-fallback dl-note">
            The Mac installer is not published yet. These steps will apply once the Mac build is
            enabled on the download page.
          </p>
        ) : null}

        <section className="dl-instructions" aria-labelledby="install-heading">
          <h2 id="install-heading" className="dl-instructions-title">
            Install instructions
          </h2>
          <PlatformInstructions platform={platform} />
        </section>

        <p className="dl-back">
          <Link href="/download">← Back to download</Link>
        </p>
      </main>
    </div>
  )
}

function platformTitle(platform: DownloadPlatform | null): string {
  if (platform === 'windows') return 'Downloading Onda Operator for Windows'
  if (platform === 'mac') return 'Downloading Onda Operator for Mac'
  return 'Downloading Onda Operator'
}

function platformLede(platform: DownloadPlatform | null, installer: InstallerConfig | null): string {
  if (platform === 'windows' && installer?.available) {
    return 'Your Windows installer should begin downloading now. Follow the steps below to install — including the SmartScreen prompt, which is expected for this unsigned internal build.'
  }
  if (platform === 'mac') {
    return 'Follow the Mac install steps below. When the Mac download is enabled, this page will also start the .dmg automatically.'
  }
  return 'Follow the install steps for your platform below. You can return to the download page anytime for a platform-specific link.'
}
