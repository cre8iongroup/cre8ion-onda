'use client'

import { useEffect, useId, useState } from 'react'
import { getPublicAppOrigin } from '@/lib/attendee/urls'

type QrType = 'room' | 'session'
type Busy = 'generate' | 'regenerate' | 'png' | 'svg' | null
type Variant = 'card' | 'row'

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
 *
 * variant="card" — full card (edit pages).
 * variant="row" — dense list row + modal for full-size QR / downloads (hub tab).
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
  variant = 'card',
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
  /** @deprecated Prefer variant="row" on the QR hub; kept for callers using compact cards. */
  compact?: boolean
  variant?: Variant
  onUrlChange?: (url: string) => void
}) {
  const titleId = useId()
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingUrl || null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [originHint, setOriginHint] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    setOriginHint(getPublicAppOrigin() || (typeof window !== 'undefined' ? window.location.origin : ''))
  }, [])

  useEffect(() => {
    setPreviewUrl(existingUrl || null)
  }, [existingUrl])

  useEffect(() => {
    if (!modalOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalOpen])

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
      if (variant === 'row') setModalOpen(true)
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
  const hasCode = Boolean(previewUrl)
  const cardPreviewSize = compact ? 160 : 280
  const thumbSize = 72

  const deepLink = (
    <a
      className="admin-public-link"
      href={absoluteHint}
      target="_blank"
      rel="noopener noreferrer"
    >
      <code>{absoluteHint}</code>
    </a>
  )

  const actionButtons = (
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
  )

  const modal =
    modalOpen && hasCode ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={() => setModalOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-4)',
        }}
      >
        <div
          className="card"
          onClick={(e) => e.stopPropagation()}
          style={{
            padding: 'var(--space-5)',
            maxWidth: 420,
            width: '100%',
            display: 'grid',
            gap: 'var(--space-4)',
          }}
        >
          <div className="flex items-center justify-between" style={{ gap: 'var(--space-3)' }}>
            <div>
              <div id={titleId} style={{ fontWeight: 600 }}>
                {label}
              </div>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
                {deepLink}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setModalOpen(false)}
            >
              Close
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl!}
            alt={`${label} QR`}
            width={280}
            height={280}
            style={{
              width: 280,
              height: 280,
              maxWidth: '100%',
              background: '#fff',
              borderRadius: 8,
              padding: 12,
              display: 'block',
              margin: '0 auto',
            }}
          />
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          {actionButtons}
        </div>
      </div>
    ) : null

  if (variant === 'row') {
    return (
      <>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: '8px 0',
            borderBottom: '1px solid var(--color-border)',
            minHeight: thumbSize + 8,
          }}
        >
          {hasCode ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              title="View QR"
              style={{
                flexShrink: 0,
                padding: 0,
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
                lineHeight: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl!}
                alt=""
                width={thumbSize}
                height={thumbSize}
                style={{ width: thumbSize, height: thumbSize, display: 'block', padding: 6 }}
              />
            </button>
          ) : (
            <div
              aria-hidden
              style={{
                width: thumbSize,
                height: thumbSize,
                flexShrink: 0,
                borderRadius: 6,
                border: '1px dashed var(--color-border)',
                background: 'var(--color-bg-muted, transparent)',
              }}
            />
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{label}</div>
            <p
              className="text-sm"
              style={{
                color: 'var(--color-text-muted)',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {deepLink}
            </p>
            {!hasCode ? (
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                Not yet generated
              </p>
            ) : null}
            {error && !modalOpen ? (
              <div className="alert alert-error" role="alert" style={{ marginTop: 6 }}>
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex gap-2" style={{ flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {hasCode ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setModalOpen(true)}
              >
                View
              </button>
            ) : null}
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
          </div>
        </div>
        {modal}
      </>
    )
  }

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
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {deepLink}
        </p>
      </div>

      {hasCode ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl!}
          alt={`${label} QR`}
          width={cardPreviewSize}
          height={cardPreviewSize}
          style={{
            width: cardPreviewSize,
            height: cardPreviewSize,
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

      {actionButtons}
    </div>
  )
}
