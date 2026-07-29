import { Suspense } from 'react'
import type { Metadata } from 'next'
import '../download/download.css'
import './download-success.css'
import DownloadSuccessClient from './DownloadSuccessClient'

export const metadata: Metadata = {
  title: 'Download started — Onda Operator',
  description: 'Your Onda Operator download should begin shortly. Install instructions for Windows and Mac.',
}

export default function DownloadSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="dl-shell">
          <main className="dl-main">
            <p className="dl-lede">Preparing your download…</p>
          </main>
        </div>
      }
    >
      <DownloadSuccessClient />
    </Suspense>
  )
}
