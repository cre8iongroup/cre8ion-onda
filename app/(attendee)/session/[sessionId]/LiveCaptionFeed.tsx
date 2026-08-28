'use client'

import Link from 'next/link'
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
import { formatSessionDateTime } from '@/lib/attendee/schedule'
import { buildCaptionDisplayLines } from '@/lib/attendee/captionLines'
import {
  CAPTION_LANGUAGE_OPTIONS,
  mapChunksForCaptionLanguage,
  normalizeCaptionLanguages,
  readStoredCaptionLang,
  writeStoredCaptionLang,
} from '@/lib/attendee/captionLanguage'
import type { EffectiveBranding, FeedState, RTDBChunk, WithId } from '@/types'
import { AttendeeFooter, AttendeeSafariTint, brandingStyle } from '../../AttendeeChrome'
import { AttendeeThemeColor } from '../../AttendeeThemeColor'

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

function sortChunks(rows: ChunkRow[]): ChunkRow[] {
  return [...rows].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
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
  defaultLanguages,
  publishedSummaryHref = null,
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
  defaultLanguages?: string[]
  /** When session ended — link to public notes if published; else omitted for "coming soon". */
  publishedSummaryHref?: string | null
}) {
  const availableLanguages = useMemo(
    () => normalizeCaptionLanguages(defaultLanguages),
    [defaultLanguages],
  )
  const showLanguageSelector = availableLanguages.length > 1

  const [feedState, setFeedState] = useState<FeedState>(initialFeedState)
  const [chunks, setChunks] = useState<ChunkRow[]>([])
  const [textSize, setTextSize] = useState<TextSize>('md')
  const [captionLang, setCaptionLang] = useState<string>('en')
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTextSize(readStoredTextSize())
    setCaptionLang(readStoredCaptionLang(availableLanguages))
  }, [availableLanguages])

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

    function publish() {
      setChunks(sortChunks(Array.from(seen.values())))
    }

    const unsubAdded = onChildAdded(chunksRef, (snap) => {
      const val = snap.val() as RTDBChunk
      if (!val?.text || !snap.key) return
      seen.set(snap.key, { id: snap.key, ...val })
      publish()
    })

    // Translation fills arrive as child updates on the same chunk node
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
  }, [sessionId, feedState])

  // Language toggle only remaps local state — same RTDB subscription.
  const displayLines = buildCaptionDisplayLines(
    mapChunksForCaptionLanguage(chunks, captionLang),
  )

  useLayoutEffect(() => {
    if (feedState !== 'live') return
    const el = feedRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chunks, feedState, textSize, captionLang])

  function selectTextSize(next: TextSize) {
    setTextSize(next)
    try {
      window.localStorage.setItem(TEXT_SIZE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  function selectCaptionLang(next: string) {
    if (!availableLanguages.includes(next)) return
    setCaptionLang(next)
    writeStoredCaptionLang(next)
  }

  const isLive = feedState === 'live'
  const waiting = waitingCopy(feedState)
  const scheduledLabel =
    scheduledStartMs > 0 ? formatSessionDateTime(scheduledStartMs, showTimezone) : null

  const langOptions = CAPTION_LANGUAGE_OPTIONS.filter((o) =>
    availableLanguages.includes(o.code),
  )

  return (
    <div className="session-shell" style={brandingStyle(branding)} data-text-size={textSize}>
      <AttendeeThemeColor backgroundColor={branding.backgroundColor} />
      <AttendeeSafariTint backgroundColor={branding.backgroundColor} />
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
          {isLive ? (
            <div className="session-header-controls">
              {showLanguageSelector ? (
                <label className="caption-lang-control">
                  <span className="visually-hidden">Caption language</span>
                  <select
                    className="caption-lang-select"
                    value={captionLang}
                    aria-label="Caption language"
                    onChange={(e) => selectCaptionLang(e.target.value)}
                  >
                    {langOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
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
                      size === 'sm'
                        ? 'Small captions'
                        : size === 'md'
                          ? 'Medium captions'
                          : 'Large captions'
                    }
                    onClick={() => selectTextSize(size)}
                  >
                    <span className={`caption-size-glyph caption-size-glyph--${size}`} aria-hidden>
                      A
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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
              {displayLines.length === 0 ? (
                <p className="caption-empty">Listening for captions…</p>
              ) : (
                displayLines.map((line, i) => {
                  const isLatest = i === displayLines.length - 1
                  return (
                    <p
                      key={line.id}
                      className={`caption-line${isLatest ? ' is-latest' : ' is-prior'}${
                        line.finalized ? '' : ' is-partial'
                      }`}
                    >
                      {line.text}
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
              {feedState === 'ended' ? (
                publishedSummaryHref ? (
                  <p className="caption-waiting-body" style={{ marginTop: '0.75rem' }}>
                    <Link href={publishedSummaryHref}>View session notes</Link>
                  </p>
                ) : (
                  <p className="caption-waiting-body" style={{ marginTop: '0.75rem', opacity: 0.85 }}>
                    Notes coming soon.
                  </p>
                )
              ) : null}
            </div>
          )}
        </section>

        <AttendeeFooter eventTitle={showName} legalNotice={legalNotice} />
      </div>
    </div>
  )
}
