'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  limitToLast,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onValue,
  orderByChild,
  query,
  ref,
} from 'firebase/database'
import { getClientDatabase } from '@/lib/firebase/client'
import { buildCaptionDisplayLines } from '@/lib/attendee/captionLines'
import { mapChunksForCaptionLanguage } from '@/lib/attendee/captionLanguage'
import { resolveOutputTextColor } from '@/lib/output/resolveTextColor'
import { rtdbLiveSessionChunksPath, rtdbOutputLivePath } from '@/lib/rtdbPaths'
import {
  DEFAULT_OUTPUT_BACKGROUND,
  DEFAULT_OUTPUT_FONT_SIZE_PX,
} from '@/lib/output/defaults'
import type { FeedState, OutputWindowConfig, RTDBChunk, WithId } from '@/types'

type ChunkRow = WithId<RTDBChunk>

function sortChunks(rows: ChunkRow[]): ChunkRow[] {
  return [...rows].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}

export default function OutputWindowClient({
  roomId,
  windowIndex,
  brandTextColor,
  initialWindowConfig,
  initialLiveSessionId,
}: {
  roomId: string
  windowIndex: number
  brandTextColor: string
  initialWindowConfig: OutputWindowConfig | null
  initialLiveSessionId: string | null
}) {
  const [windowConfig, setWindowConfig] = useState<OutputWindowConfig | null>(initialWindowConfig)
  const [liveSessionId, setLiveSessionId] = useState<string | null>(initialLiveSessionId)
  const [feedState, setFeedState] = useState<FeedState | null>(
    initialLiveSessionId ? 'live' : null,
  )
  const [chunks, setChunks] = useState<ChunkRow[]>([])
  const feedRef = useRef<HTMLDivElement>(null)

  // Poll public room API for live-session changes (anonymous clients can't read Firestore).
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const res = await fetch(`/api/public/rooms/${encodeURIComponent(roomId)}`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = (await res.json()) as {
          liveSession?: { id?: string; feedState?: FeedState } | null
          outputConfig?: { windows?: OutputWindowConfig[] } | null
        }
        if (cancelled) return
        const nextId =
          data.liveSession?.feedState === 'live' && data.liveSession.id
            ? data.liveSession.id
            : null
        setLiveSessionId(nextId)
        if (!nextId) setFeedState(null)

        const windows = data.outputConfig?.windows
        if (Array.isArray(windows) && windows[windowIndex]) {
          // Prefer RTDB for live styling; only seed from API if we have no config yet
          setWindowConfig((prev) => prev ?? windows[windowIndex]!)
        }
      } catch {
        /* ignore transient network errors */
      }
    }
    refresh()
    const interval = window.setInterval(refresh, 8000)
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [roomId, windowIndex])

  // Live output config from RTDB
  useEffect(() => {
    const db = getClientDatabase()
    const unsub = onValue(ref(db, rtdbOutputLivePath(roomId)), (snap) => {
      const val = snap.val() as { windows?: OutputWindowConfig[] } | null
      const w = val?.windows?.[windowIndex]
      if (w && typeof w === 'object') {
        setWindowConfig({
          language: w.language === undefined ? null : w.language,
          fontSize:
            typeof w.fontSize === 'number' && Number.isFinite(w.fontSize)
              ? w.fontSize
              : DEFAULT_OUTPUT_FONT_SIZE_PX,
          backgroundColor:
            typeof w.backgroundColor === 'string' && w.backgroundColor
              ? w.backgroundColor
              : DEFAULT_OUTPUT_BACKGROUND,
          ...(typeof w.textColor === 'string' && w.textColor.trim()
            ? { textColor: w.textColor.trim() }
            : {}),
        })
      }
    })
    return () => unsub()
  }, [roomId, windowIndex])

  // feedState for resolved live session
  useEffect(() => {
    if (!liveSessionId) {
      setFeedState(null)
      return
    }
    const db = getClientDatabase()
    const unsub = onValue(ref(db, `liveSessions/${liveSessionId}/feedState`), (snap) => {
      const val = snap.val()
      if (typeof val === 'string') setFeedState(val as FeedState)
    })
    return () => unsub()
  }, [liveSessionId])

  // Caption chunks — only while feedState === 'live' (intentional: idle during sound check)
  useEffect(() => {
    if (!liveSessionId || feedState !== 'live') {
      setChunks([])
      return
    }

    const db = getClientDatabase()
    const chunksRef = query(
      ref(db, rtdbLiveSessionChunksPath(liveSessionId)),
      orderByChild('timestamp'),
      limitToLast(120),
    )
    const seen = new Map<string, ChunkRow>()

    function publish() {
      setChunks(sortChunks(Array.from(seen.values())))
    }

    const unsubAdded = onChildAdded(chunksRef, (snap) => {
      const val = snap.val() as RTDBChunk
      if (!val?.text || !snap.key) return
      seen.set(snap.key, { id: snap.key, ...val })
      publish()
    })
    const unsubChanged = onChildChanged(chunksRef, (snap) => {
      const val = snap.val() as RTDBChunk
      if (!snap.key) return
      if (!val?.text) {
        seen.delete(snap.key)
        publish()
        return
      }
      seen.set(snap.key, { id: snap.key, ...val })
      publish()
    })
    const unsubRemoved = onChildRemoved(chunksRef, (snap) => {
      if (!snap.key) return
      seen.delete(snap.key)
      publish()
    })

    return () => {
      unsubAdded()
      unsubChanged()
      unsubRemoved()
    }
  }, [liveSessionId, feedState])

  const language = windowConfig?.language ?? null
  const isLive = feedState === 'live' && Boolean(liveSessionId)
  const languageReady = typeof language === 'string' && language.length > 0

  const displayLines = useMemo(() => {
    if (!isLive || !languageReady) return []
    return buildCaptionDisplayLines(mapChunksForCaptionLanguage(chunks, language))
  }, [chunks, isLive, language, languageReady])

  useLayoutEffect(() => {
    if (!isLive) return
    const el = feedRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [displayLines, isLive])

  const bg = windowConfig?.backgroundColor || DEFAULT_OUTPUT_BACKGROUND
  const fontSize = windowConfig?.fontSize || DEFAULT_OUTPUT_FONT_SIZE_PX
  const color = resolveOutputTextColor(windowConfig, brandTextColor)

  let idleMessage = 'Waiting for live session…'
  if (isLive && !languageReady) idleMessage = 'Language not set'
  else if (feedState && feedState !== 'live') idleMessage = 'Waiting for live session…'

  return (
    <div
      className="output-window-root"
      style={{
        margin: 0,
        minHeight: '100vh',
        width: '100%',
        boxSizing: 'border-box',
        background: bg,
        color,
        fontSize: `${fontSize}px`,
        fontFamily: 'Georgia, "Times New Roman", serif',
        lineHeight: 1.35,
        overflow: 'hidden',
      }}
    >
      {isLive && languageReady ? (
        <div
          ref={feedRef}
          style={{
            height: '100vh',
            overflow: 'hidden',
            padding: '4vh 4vw',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          {displayLines.length === 0 ? null : (
            displayLines.map((line, i) => {
              const isLatest = i === displayLines.length - 1
              return (
                <p
                  key={line.id}
                  style={{
                    margin: '0 0 0.35em',
                    // Must set color on <p>: globals.css `p { color: … }` overrides
                    // inherited color from the root (background is unaffected).
                    color,
                    opacity: isLatest ? 1 : 0.72,
                    fontWeight: isLatest ? 600 : 400,
                  }}
                >
                  {line.text}
                </p>
              )
            })
          )}        </div>
      ) : (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.35,
            fontSize: Math.min(fontSize, 28),
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {idleMessage}
        </div>
      )}
    </div>
  )
}
