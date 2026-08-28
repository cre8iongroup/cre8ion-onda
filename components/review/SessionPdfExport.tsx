'use client'

import { useState } from 'react'
import { parseAiSummary } from '@/lib/review/parseAiSummary'
import type { SessionDoc, TranscriptChunk, WithId } from '@/types'

type Props = {
  showName: string
  session: SessionDoc
  chunks: WithId<TranscriptChunk>[]
  scheduledLabel: string | null
  primaryColor?: string
}

export default function SessionPdfExport({
  showName,
  session,
  chunks,
  scheduledLabel,
  primaryColor = '#5b3aee',
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function downloadPdf() {
    setBusy(true)
    setError(null)
    try {
      const [{ pdf }, { SessionPdfDocument, buildTranscriptLines }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/review/SessionPdfDocument'),
      ])

      const parsed = parseAiSummary(session.aiSummary)
      const summary = parsed.ok ? parsed.summary : null
      const transcriptLines = buildTranscriptLines(chunks)
      const title = session.friendlyName || session.title

      const blob = await pdf(
        <SessionPdfDocument
          showName={showName}
          sessionTitle={title}
          scheduledLabel={scheduledLabel}
          primaryColor={primaryColor}
          summary={summary}
          transcriptLines={transcriptLines}
        />,
      ).toBlob()

      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${title.replace(/[^\w.-]+/g, '_') || 'session'}-notes.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      console.error('SessionPdfExport: failed', err)
      setError(err instanceof Error ? err.message : 'PDF export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>Export PDF</h3>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
        Download a branded letter-size PDF with the AI summary and full English transcript.
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
