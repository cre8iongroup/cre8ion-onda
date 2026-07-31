'use client'

import { useEffect, useState } from 'react'

/**
 * QR preview + download for Room/Session edit pages.
 * Calls POST /api/admin/qr (on-demand generation).
 */
export default function QrDownloadPanel({
  type,
  showId,
  id,
  deepLinkPath,
  canDownload,
  existingUrl,
}: {
  type: 'room' | 'session'
  showId: string
  id: string
  deepLinkPath: string
  canDownload: boolean
  existingUrl?: string
}) {
  const [busy, setBusy] = useState<'png' | 'svg' | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingUrl || null)
  const [error, setError] = useState<string | null>(null)
  const [originHint, setOriginHint] = useState('')

  useEffect(() => {
    setOriginHint(typeof window !== 'undefined' ? window.location.origin : '')
  }, [])

  useEffect(() => {
    setPreviewUrl(existingUrl || null)
  }, [existingUrl])

  async function download(format: 'png' | 'svg') {
    if (!canDownload || busy) return
    setBusy(format)
    setError(null)
    try {
      const { getClientAuth } = await import('@/lib/firebase/client')
      const user = getClientAuth().currentUser
      if (!user) throw new Error('Sign in required')
      const token = await user.getIdToken()
      const res = await fetch('/api/admin/qr', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type, showId, id, format }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error || `QR failed (${res.status})`)
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      if (format === 'png') setPreviewUrl(objectUrl)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `${type}-${id}.qr.${format}`
      a.click()
      if (format === 'svg') URL.revokeObjectURL(objectUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'QR download failed')
    } finally {
      setBusy(null)
    }
  }

  const absoluteHint = originHint ? `${originHint}${deepLinkPath}` : deepLinkPath

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-3)' }}>QR code</h3>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
        Encodes the production public URL. Generated on demand and stored in Firebase Storage.
      </p>
      <p className="text-sm" style={{ marginBottom: 'var(--space-4)' }}>
        Deep link:{' '}
        <code style={{ wordBreak: 'break-all' }}>{absoluteHint}</code>
      </p>

      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="QR preview"
          width={180}
          height={180}
          style={{
            display: 'block',
            marginBottom: 'var(--space-4)',
            background: '#fff',
            borderRadius: 8,
            padding: 8,
          }}
        />
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
          No QR generated yet — download PNG or SVG below.
        </p>
      )}

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}

      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canDownload || busy !== null}
          onClick={() => void download('png')}
        >
          {busy === 'png' ? 'Generating…' : 'Download PNG'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!canDownload || busy !== null}
          onClick={() => void download('svg')}
        >
          {busy === 'svg' ? 'Generating…' : 'Download SVG'}
        </button>
      </div>
    </div>
  )
}
