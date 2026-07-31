'use client'

import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  limitToLast,
  onChildAdded,
  onValue,
  orderByChild,
  query,
  ref,
} from 'firebase/database'
import { getClientDatabase } from '@/lib/firebase/client'
import { formatSessionDateTime } from '@/lib/attendee/schedule'
import type { EffectiveBranding, FeedState, RTDBChunk, WithId } from '@/types'
import { AttendeeFooter, brandingStyle } from '../../AttendeeChrome'

type ChunkRow = WithId<RTDBChunk>
type TextSize = 'sm' | 'md' | 'lg'

const TEXT_SIZE_KEY = 'onda.captionTextSize'
const TEXT_SIZES: TextSize[] = ['sm', 'md', 'lg']

function readStoredTextSize(): TextSize {
  if (typeof window === 'undefined') return 'md'
  try {
    const raw = window.localStorage.getItem(TEXT_SIZE_KEY)
    if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw
  } catch {
    /* ignore quota / private mode */
  }
  return 'md'
}

function waitingCopy(feedState: FeedState): { title: string; body: string; badge: string } {
  if (feedState === 'ended') {
    return {
      title: 'This session has ended',
      body: 'Captions are no longer updating for this session.',
      badge: 'Ended',
    }
  }
  if (feedState === 'stopping') {
    return {
      title: 'This session is wrapping up',
      body: 'Live captions will stop in a moment.',
      badge: 'Ending',
    }
  }
  return {
    title: "This session hasn't started yet",
    body: 'Captions will appear here when the session goes live.',
    badge: 'Starting soon',
  }
}

export default function LiveCaptionFeed({
  sessionId,
  title,
  showName,
  showTimezone,
  scheduledStartMs,
  legalNotice,
  room,
  branding,
  initialFeedState,
}: {
  sessionId: string
  title: string
  showName: string
  showTimezone: string
  scheduledStartMs: number
  legalNotice?: string
  room: { id: string; name: string } | null
  branding: EffectiveBranding
  initialFeedState: FeedState
}) {
  const [feedState, setFeedState] = useState<FeedState>(initialFeedState)
  const [chunks, setChunks] = useState<ChunkRow[]>([])
  const [textSize, setTextSize] = useState<TextSize>('md')
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTextSize(readStoredTextSize())
  }, [])

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

  useLayoutEffect(() => {
    if (feedState !== 'live') return
    const el = feedRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chunks, feedState, textSize])

  function selectTextSize(next: TextSize) {
    setTextSize(next)
    try {
      window.localStorage.setItem(TEXT_SIZE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const isLive = feedState === 'live'
  const waiting = waitingCopy(feedState)
  const scheduledLabel =
    scheduledStartMs > 0 ? formatSessionDateTime(scheduledStartMs, showTimezone) : null

  return (
    <div className="session-shell" style={brandingStyle(branding)} data-text-size={textSize}>
      <div className="session-inner">
        {room ? (
          <p className="session-back">
            <Link href={`/room/${room.id}`}>← {room.name}</Link>
          </p>
        ) : null}

        <header className="session-header">
          <div className="session-header-main">
            <p className="session-show-name">{showName}</p>
            <h1 className="session-title">{title}</h1>
          </div>
          <div
            className="caption-size-control"
            role="group"
            aria-label="Caption text size"
          >
            {TEXT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={`caption-size-btn${textSize === size ? ' is-active' : ''}`}
                aria-pressed={textSize === size}
                aria-label={
                  size === 'sm' ? 'Small captions' : size === 'md' ? 'Medium captions' : 'Large captions'
                }
                onClick={() => selectTextSize(size)}
              >
                <span className={`caption-size-glyph caption-size-glyph--${size}`} aria-hidden>
                  A
                </span>
              </button>
            ))}
          </div>
        </header>

        {/* Single feed container — waiting / live / ended share this box */}
        <section
          className={`caption-panel${isLive ? ' is-live' : ' is-waiting'}`}
          aria-live={isLive ? 'polite' : 'off'}
        >
          <div className="caption-panel-status">
            {isLive ? (
              <span className="session-badge session-badge--live">Live</span>
            ) : (
              <span className="session-badge">{waiting.badge}</span>
            )}
          </div>

          {isLive ? (
            <div ref={feedRef} className="caption-feed">
              {chunks.length === 0 ? (
                <p className="caption-empty">Listening for captions…</p>
              ) : (
                chunks.map((c, i) => {
                  const isLatest = i === chunks.length - 1
                  return (
                    <p
                      key={c.id}
                      className={`caption-line${isLatest ? ' is-latest' : ' is-prior'}`}
                    >
                      {c.text}
                    </p>
                  )
                })
              )}
            </div>
          ) : (
            <div className="caption-waiting-state">
              <h2 className="caption-waiting-title">{waiting.title}</h2>
              {feedState !== 'ended' && scheduledLabel ? (
                <p className="caption-waiting-time">Scheduled for {scheduledLabel}</p>
              ) : null}
              <p className="caption-waiting-body">{waiting.body}</p>
            </div>
          )}
        </section>

        <AttendeeFooter eventTitle={showName} legalNotice={legalNotice} />
      </div>
    </div>
  )
}
