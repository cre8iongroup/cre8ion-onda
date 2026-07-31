'use client'

import { useEffect, useState } from 'react'
import {
  limitToLast,
  onChildAdded,
  onValue,
  orderByChild,
  query,
  ref,
} from 'firebase/database'
import { getClientDatabase } from '@/lib/firebase/client'
import type { EffectiveBranding, FeedState, RTDBChunk, WithId } from '@/types'
import { brandingStyle } from '../../AttendeeChrome'

type ChunkRow = WithId<RTDBChunk>

export default function LiveCaptionFeed({
  sessionId,
  title,
  showName,
  branding,
  initialFeedState,
}: {
  sessionId: string
  title: string
  showName: string
  branding: EffectiveBranding
  initialFeedState: FeedState
}) {
  const [feedState, setFeedState] = useState<FeedState>(initialFeedState)
  const [chunks, setChunks] = useState<ChunkRow[]>([])

  useEffect(() => {
    const db = getClientDatabase()
    const stateRef = ref(db, `liveSessions/${sessionId}/feedState`)
    const unsub = onValue(stateRef, (snap) => {
      const val = snap.val()
      if (typeof val === 'string') setFeedState(val as FeedState)
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => {
    if (feedState !== 'live') {
      setChunks([])
      return
    }

    const db = getClientDatabase()
    const chunksRef = query(
      ref(db, `liveSessions/${sessionId}/chunks`),
      orderByChild('timestamp'),
      limitToLast(120),
    )
    const seen = new Map<string, ChunkRow>()

    const unsubAdded = onChildAdded(chunksRef, (snap) => {
      const val = snap.val() as RTDBChunk
      if (!val?.text) return
      seen.set(snap.key!, { id: snap.key!, ...val })
      setChunks(
        Array.from(seen.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
      )
    })

    return () => unsubAdded()
  }, [sessionId, feedState])

  const isLive = feedState === 'live'

  return (
    <div className="caption-shell" style={brandingStyle(branding)}>
      <header className="caption-header">
        <div style={{ fontSize: '0.75rem', opacity: 0.65, marginBottom: '0.25rem' }}>{showName}</div>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: '0.8rem', marginTop: '0.35rem', opacity: 0.75 }}>
          {isLive ? 'Live captions' : feedState === 'ended' ? 'Session ended' : 'Waiting for live…'}
        </div>
      </header>

      {!isLive ? (
        <div className="caption-waiting">
          <p>
            {feedState === 'ended'
              ? 'This session is no longer live.'
              : 'Captions appear here when the session goes live.'}
          </p>
        </div>
      ) : (
        <div className="caption-feed" aria-live="polite">
          {chunks.length === 0 ? (
            <p className="caption-waiting" style={{ margin: 0 }}>
              Listening for captions…
            </p>
          ) : (
            chunks.map((c) => (
              <p key={c.id} className="caption-line">
                {c.text}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  )
}
