'use client'

import { useCallback, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { ref, set } from 'firebase/database'
import { getClientDatabase, getClientFirestore } from '@/lib/firebase/client'
import type { FeedState } from '@/types'

interface GoLiveControlProps {
  showId: string
  sessionId: string
  feedState: FeedState
  canControl: boolean
  onError?: (message: string) => void
}

export default function GoLiveControl({
  showId,
  sessionId,
  feedState,
  canControl,
  onError,
}: GoLiveControlProps) {
  const [confirmLive, setConfirmLive] = useState(false)
  const [busy, setBusy] = useState(false)

  const setFeed = useCallback(
    async (next: FeedState) => {
      if (!canControl) {
        onError?.('You do not have permission to control the live feed.')
        return
      }
      setBusy(true)
      try {
        const fs = getClientFirestore()
        const db = getClientDatabase()
        await Promise.all([
          updateDoc(doc(fs, 'shows', showId, 'sessions', sessionId), { feedState: next }),
          set(ref(db, `liveSessions/${sessionId}/feedState`), next),
        ])
        setConfirmLive(false)
      } catch (err: any) {
        console.error('GoLiveControl: failed to update feedState', err)
        onError?.(err?.message || 'Failed to update feed state.')
      } finally {
        setBusy(false)
      }
    },
    [canControl, onError, sessionId, showId]
  )

  return (
    <div className="card go-live-panel" id="tech-go-live-control">
      <div className="alert alert-warning" role="status" style={{ marginBottom: 'var(--space-4)' }}>
        This page is outdated — use Onda Operator to run live sessions.
      </div>
      <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>Feed control</h3>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
        Current feed state:{' '}
        <span className={`badge ${feedState === 'live' ? 'badge-live' : 'badge-standby'}`}>
          {feedState}
        </span>
      </p>

      {!confirmLive ? (
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            id="btn-prepare-go-live"
            className="btn btn-live"
            disabled={busy || !canControl || feedState === 'live'}
            onClick={() => setConfirmLive(true)}
          >
            Go Live…
          </button>
          <button
            type="button"
            id="btn-feed-standby"
            className="btn btn-secondary"
            disabled={busy || !canControl || feedState === 'standby'}
            onClick={() => setFeed('standby')}
          >
            Standby
          </button>
          <button
            type="button"
            id="btn-feed-end"
            className="btn btn-ghost"
            disabled={busy || !canControl || feedState === 'ended'}
            onClick={() => setFeed('ended')}
          >
            End feed
          </button>
        </div>
      ) : (
        <div className="alert alert-warning" role="alertdialog" aria-labelledby="go-live-confirm-title">
          <div>
            <p id="go-live-confirm-title" style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>
              Confirm Go Live
            </p>
            <p className="text-sm" style={{ marginBottom: 'var(--space-4)' }}>
              This publishes the live transcript to attendee and output views. Only continue when
              audio capture and the private preview look correct.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                id="btn-confirm-go-live"
                className="btn btn-live"
                disabled={busy}
                onClick={() => setFeed('live')}
              >
                {busy ? 'Going live…' : 'Yes, go live now'}
              </button>
              <button
                type="button"
                id="btn-cancel-go-live"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => setConfirmLive(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
