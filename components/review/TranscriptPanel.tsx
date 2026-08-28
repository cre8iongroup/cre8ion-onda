'use client'

import { useMemo, useState } from 'react'
import type { TranscriptChunk, WithId } from '@/types'

type Props = {
  chunks: WithId<TranscriptChunk>[]
}

export default function TranscriptPanel({ chunks }: Props) {
  const [copied, setCopied] = useState(false)

  const fullText = useMemo(() => {
    const sorted = [...chunks].sort(
      (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
    )
    return sorted
      .map((c) => {
        const prefix = c.speakerLabel ? `${c.speakerLabel}: ` : ''
        return `${prefix}${c.text}`
      })
      .join('\n')
  }, [chunks])

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(fullText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard denied */
    }
  }

  if (chunks.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-5)' }}>
        <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>Transcript</h3>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No transcript chunks in Firestore yet.
        </p>
      </div>
    )
  }

  const sorted = [...chunks].sort(
    (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
  )

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <div
        className="flex items-center justify-between gap-4"
        style={{ marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}
      >
        <h3 style={{ fontSize: 'var(--text-md)' }}>
          Transcript <span className="text-sm" style={{ fontWeight: 400 }}>({chunks.length} chunks)</span>
        </h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyAll()}>
          {copied ? 'Copied!' : 'Copy all'}
        </button>
      </div>
      <div
        style={{
          maxHeight: '28rem',
          overflow: 'auto',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 'var(--text-sm)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {sorted.map((chunk) => (
          <p key={chunk.id} style={{ marginBottom: 'var(--space-3)' }}>
            {chunk.speakerLabel ? (
              <span style={{ color: 'var(--color-text-muted)' }}>{chunk.speakerLabel}: </span>
            ) : null}
            {chunk.text}
          </p>
        ))}
      </div>
    </div>
  )
}
