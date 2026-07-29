'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  limitToLast,
  onChildAdded,
  onValue,
  orderByChild,
  query,
  ref,
} from 'firebase/database'
import { getClientDatabase } from '@/lib/firebase/client'
import type { RTDBChunk, WithId } from '@/types'

type ChunkRow = WithId<RTDBChunk>

export default function PrivateTranscriptPreview({
  sessionId,
  onLastChunkAt,
}: {
  sessionId: string
  onLastChunkAt?: (ts: number | null) => void
}) {
  const [chunks, setChunks] = useState<ChunkRow[]>([])
  const [connection, setConnection] = useState<'connecting' | 'live' | 'lost'>('connecting')
  const [armedAt, setArmedAt] = useState<number | null>(null)

  useEffect(() => {
    setChunks([])
    setConnection('connecting')
    setArmedAt(Date.now())
    onLastChunkAt?.(null)

    const db = getClientDatabase()
    const chunksRef = query(
      ref(db, `liveSessions/${sessionId}/chunks`),
      orderByChild('timestamp'),
      limitToLast(80)
    )

    const seen = new Map<string, ChunkRow>()

    const onListenError = () => {
      setConnection('lost')
    }

    const unsubAdded = onChildAdded(
      chunksRef,
      (snap) => {
        const val = snap.val() as RTDBChunk
        if (!val?.text) return
        seen.set(snap.key!, { id: snap.key!, ...val })
        const next = Array.from(seen.values()).sort(
          (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
        )
        setChunks(next)
        setConnection('live')
        onLastChunkAt?.(val.timestamp || Date.now())
      },
      onListenError,
    )

    // Also listen once for initial empty state settle
    const unsubValue = onValue(
      chunksRef,
      (snap) => {
        if (!snap.exists()) {
          setConnection((c) => (c === 'live' ? c : 'connecting'))
        }
      },
      onListenError,
    )

    return () => {
      unsubAdded()
      unsubValue()
    }
  }, [sessionId, onLastChunkAt])

  // Stale detection while armed / previously live
  useEffect(() => {
    const id = window.setInterval(() => {
      if (chunks.length === 0) {
        if (armedAt && Date.now() - armedAt > 45000) {
          setConnection((c) => (c === 'live' ? 'lost' : c))
        }
        return
      }
      const last = chunks[chunks.length - 1]
      const age = Date.now() - (last.timestamp || 0)
      if (age > 20000) setConnection('lost')
      else setConnection('live')
    }, 2000)
    return () => window.clearInterval(id)
  }, [chunks, armedAt])

  const statusLabel = useMemo(() => {
    switch (connection) {
      case 'live':
        return 'Receiving transcript'
      case 'lost':
        return 'Connection lost / stalled'
      default:
        return 'Waiting for Recall webhook chunks'
    }
  }, [connection])

  return (
    <div className="card transcript-preview" id="tech-private-preview">
      <div className="flex items-center justify-between gap-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div>
          <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-1)' }}>
            Private transcript preview
          </h3>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Includes speaker labels (internal only — not shown to attendees).
          </p>
        </div>
        <span
          className={`badge ${
            connection === 'live' ? 'badge-success' : connection === 'lost' ? 'badge-live' : 'badge-standby'
          }`}
          id="tech-preview-connection-status"
        >
          {statusLabel}
        </span>
      </div>

      {connection === 'lost' && (
        <div className="alert alert-warning" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          No new transcript chunks. Check Recall Desktop SDK, network, and webhook secret —
          do not assume the feed is still capturing.
        </div>
      )}

      <div className="transcript-scroll" aria-live="polite">
        {chunks.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Waiting for chunks at <code>liveSessions/{sessionId}/chunks</code> via{' '}
            <code>/api/recall/webhook</code>…
          </p>
        ) : (
          chunks.map((c) => (
            <div key={c.id} className="transcript-line">
              {c.speakerLabel && (
                <span className="transcript-speaker">{c.speakerLabel}</span>
              )}
              <span className="transcript-text">{c.text}</span>
              {!c.isFinalized && (
                <span className="badge badge-muted" style={{ marginLeft: 8 }}>partial</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
