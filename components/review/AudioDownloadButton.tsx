'use client'

import { useState } from 'react'
import { getDownloadURL, ref } from 'firebase/storage'
import { getClientStorage } from '@/lib/firebase/client'

type Props = {
  audioStoragePath: string | undefined
  sessionLabel: string
}

/**
 * Downloads session audio via Firebase Storage getDownloadURL.
 * Pre-merge: confirm one production Session's audioStoragePath string manually.
 */
export default function AudioDownloadButton({ audioStoragePath, sessionLabel }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    if (!audioStoragePath) return
    setBusy(true)
    setError(null)
    try {
      const url = await getDownloadURL(ref(getClientStorage(), audioStoragePath))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${sessionLabel.replace(/[^\w.-]+/g, '_') || 'session'}.mp3`
      anchor.rel = 'noopener'
      anchor.target = '_blank'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (err: unknown) {
      console.error('AudioDownloadButton: download failed', err)
      setError(err instanceof Error ? err.message : 'Download failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!audioStoragePath) {
    return (
      <div className="card" style={{ padding: 'var(--space-5)' }}>
        <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>Session audio</h3>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No audio file on record for this session.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>Session audio</h3>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
        Download the mixed session recording (MP3). Playback is not available in the Reviewer panel.
      </p>
      {error ? (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-3)' }}>
          {error}
        </div>
      ) : null}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? 'Preparing…' : 'Download audio'}
      </button>
    </div>
  )
}
