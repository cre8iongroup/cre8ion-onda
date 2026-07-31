'use client'

import { useEffect, useState } from 'react'

type QrType = 'room' | 'session'
type Busy = 'generate' | 'regenerate' | 'png' | 'svg' | null

async function authHeaders(): Promise<HeadersInit> {
  const { getClientAuth } = await import('@/lib/firebase/client')
  const user = getClientAuth().currentUser
  if (!user) throw new Error('Sign in required')
  const token = await user.getIdToken()
  return {
    'content-type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

/**
 * Shared QR UI for the QR codes tab and Session/Room edit pages.
 * Generate/Regenerate → canGenerate (canEditShows).
 * Preview/Download → canDownload (canDownloadQr).
 * Contributors never see Generate; missing codes show "Not yet generated".
 */
export default function QrCodeCard({
  type,
  showId,
  id,
  label,
  deepLinkPath,
  canGenerate,
  canDownload,
  existingUrl,
  compact,
  onUrlChange,
}: {
  type: QrType
  showId: string
  id: string
  label: string
  deepLinkPath: string
  canGenerate: boolean
  canDownload: boolean
  existingUrl?: string
  compact?: boolean
  onUrlChange?: (url: string) => void
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingUrl || null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [originHint, setOriginHint] = useState('')

  useEffect(() => {
    setOriginHint(typeof window !== 'undefined' ? window.location.origin : '')
  }, [])

  useEffect(() => {
    setPreviewUrl(existingUrl || null)
  }, [existingUrl])

  async function callQr(action: 'generate' | 'regenerate' | 'download', format: 'png' | 'svg') {
    const headers = await authHeaders()
    const res = await fetch('/api/admin/qr', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type, showId, id, format, action }),
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      throw new Error(json.error || `QR failed (${res.status})`)
    }
    const blob = await res.blob()
    const persisted = res.headers.get('X-Onda-Qr-Url')
    return { blob, persisted }
  }

  async function generate(action: 'generate' | 'regenerate') {
    if (!canGenerate || busy) return
    setBusy(action)
    setError(null)
    try {
      const { blob, persisted } = await callQr(action, 'png')
      const objectUrl = URL.createObjectURL(blob)
      setPreviewUrl(objectUrl)
      if (persisted) onUrlChange?.(persisted)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'QR generate failed')
    } finally {
      setBusy(null)
    }
  }

  async function download(format: 'png' | 'svg') {
    if (!canDownload || busy) return
    setBusy(format)
    setError(null)
    try {
      const { blob } = await callQr('download', format)
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `${type}-${id}.qr.${format}`
      a.click()
      URL.revokeObjectURL(objectUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'QR download failed')
    } finally {
      setBusy(null)
    }
  }

  const absoluteHint = originHint ? `${originHint}${deepLinkPath}` : deepLinkPath
  const previewSize = compact ? 160 : 280
  const hasCode = Boolean(previewUrl)

  return (
    <div
      className="card"
      style={{
        padding: 'var(--space-4)',
        display: 'grid',
        gap: 'var(--space-3)',
      }}
    >
      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>
          <code>{absoluteHint}</code>
        </p>
      </div>

      {hasCode ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl!}
          alt={`${label} QR`}
          width={previewSize}
          height={previewSize}
          style={{
            width: previewSize,
            height: previewSize,
            background: '#fff',
            borderRadius: 8,
            padding: 12,
            display: 'block',
          }}
        />
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Not yet generated
        </p>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
        {canGenerate && !hasCode ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy !== null}
            onClick={() => void generate('generate')}
          >
            {busy === 'generate' ? 'Generating…' : 'Generate'}
          </button>
        ) : null}

        {canGenerate && hasCode ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy !== null}
            onClick={() => void generate('regenerate')}
          >
            {busy === 'regenerate' ? 'Regenerating…' : 'Regenerate'}
          </button>
        ) : null}

        {canDownload && hasCode ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void download('png')}
            >
              {busy === 'png' ? '…' : 'Download PNG'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null}
              onClick={() => void download('svg')}
            >
              {busy === 'svg' ? '…' : 'Download SVG'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
