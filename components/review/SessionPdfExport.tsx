'use client'

import { useState } from 'react'
import { parseAiSummary } from '@/lib/review/parseAiSummary'
import { userFacingError } from '@/lib/review/userFacingError'
import type { SessionDoc } from '@/types'

type Props = {
  showName: string
  session: SessionDoc
  scheduledLabel: string | null
  logoUrl?: string | null
  accentColor?: string
  variant?: 'default' | 'inline'
}

export default function SessionPdfExport({
  showName,
  session,
  scheduledLabel,
  logoUrl,
  accentColor,
  variant = 'default',
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function downloadPdf() {
    setBusy(true)
    setError(null)
    try {
      const [{ pdf }, { SessionPdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/review/SessionPdfDocument'),
      ])

      const parsed = parseAiSummary(session.aiSummary)
      const summary = parsed.ok ? parsed.summary : null
      const title = session.friendlyName || session.title

      const blob = await pdf(
        <SessionPdfDocument
          showName={showName}
          sessionTitle={title}
          scheduledLabel={scheduledLabel}
          logoUrl={logoUrl}
          accentColor={accentColor}
          summary={summary}
        />,
      ).toBlob()

      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${title.replace(/[^\w.-]+/g, '_') || 'session'}-summary.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      setError(userFacingError(err, 'The PDF couldn\'t be generated right now.'))
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'inline') {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => void downloadPdf()}
        >
          {busy ? 'Generating…' : 'Download PDF'}
        </button>
        {error ? (
          <span className="text-sm field-error" role="alert" style={{ marginTop: 'var(--space-1)' }}>
            {error}
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>Export PDF</h3>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
        Download a branded letter-size PDF with the AI session summary.
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
        onClick={() => void downloadPdf()}
      >
        {busy ? 'Generating…' : 'Download PDF'}
      </button>
    </div>
  )
}
