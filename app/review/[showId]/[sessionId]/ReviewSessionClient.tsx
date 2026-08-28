'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import { summaryPublicUrl } from '@/lib/attendee/urls'
import { formatSessionDateTime } from '@/lib/attendee/schedule'
import { sessionStatusBadgeClass, sessionStatusLabel } from '@/lib/sessionStatus'
import { isSessionPublished } from '@/lib/review/reviewState'
import { normalizeReviewState } from '@/lib/review/sessionReview'
import ReviewStatusControls from '@/components/review/ReviewStatusControls'
import TranscriptPanel from '@/components/review/TranscriptPanel'
import AiSummaryPanel from '@/components/review/AiSummaryPanel'
import AudioDownloadButton from '@/components/review/AudioDownloadButton'
import ContentHealthPanel from '@/components/review/ContentHealthPanel'
import SessionPdfExport from '@/components/review/SessionPdfExport'
import type { SessionDoc, ShowDoc, TranscriptChunk, WithId } from '@/types'

export default function ReviewSessionClient({
  showId,
  sessionId,
}: {
  showId: string
  sessionId: string
}) {
  const { user, userDoc } = useAuthContext()
  const [show, setShow] = useState<ShowDoc | null>(null)
  const [session, setSession] = useState<WithId<SessionDoc> | null>(null)
  const [chunks, setChunks] = useState<WithId<TranscriptChunk>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fs = getClientFirestore()
    const showRef = doc(fs, 'shows', showId)
    const sessionRef = doc(fs, 'shows', showId, 'sessions', sessionId)
    const transcriptsQ = query(
      collection(fs, 'shows', showId, 'sessions', sessionId, 'transcripts'),
      orderBy('sequenceNumber', 'asc'),
    )

    let showOk = false
    let sessionOk = false
    let chunksOk = false

    function maybeDone() {
      if (showOk && sessionOk && chunksOk) setLoading(false)
    }

    const unsubShow = onSnapshot(
      showRef,
      (snap) => {
        if (!snap.exists()) {
          setError('Show not found or you are not assigned to it.')
          setShow(null)
        } else {
          setShow(snap.data() as ShowDoc)
        }
        showOk = true
        maybeDone()
      },
      (err) => {
        console.error('ReviewSessionClient: show listen failed', err)
        setError('Failed to load show.')
        showOk = true
        maybeDone()
      },
    )

    const unsubSession = onSnapshot(
      sessionRef,
      (snap) => {
        if (!snap.exists()) {
          setError('Session not found.')
          setSession(null)
        } else {
          setSession({ id: snap.id, ...(snap.data() as SessionDoc) })
        }
        sessionOk = true
        maybeDone()
      },
      (err) => {
        console.error('ReviewSessionClient: session listen failed', err)
        setError('Failed to load session.')
        sessionOk = true
        maybeDone()
      },
    )

    const unsubChunks = onSnapshot(
      transcriptsQ,
      (snap) => {
        setChunks(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as TranscriptChunk) })),
        )
        chunksOk = true
        maybeDone()
      },
      (err) => {
        console.error('ReviewSessionClient: transcripts listen failed', err)
        chunksOk = true
        maybeDone()
      },
    )

    return () => {
      unsubShow()
      unsubSession()
      unsubChunks()
    }
  }, [showId, sessionId])

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 'var(--space-8)' }}>
        <span className="spinner" aria-label="Loading session" />
      </div>
    )
  }

  if (error || !session || !show) {
    return (
      <div>
        <p style={{ marginBottom: 'var(--space-4)' }}>
          <Link href="/review">← Sessions to Review</Link>
        </p>
        <div className="alert alert-error" role="alert">
          {error || 'Session unavailable.'}
        </div>
      </div>
    )
  }

  const tz = show.showTimezone || 'America/New_York'
  const startMs = session.scheduledStart?.toMillis?.() ?? 0
  const reviewState = normalizeReviewState(session, user?.uid ?? 'reviewer')
  const publicSummaryUrl = isSessionPublished(reviewState)
    ? summaryPublicUrl(showId, sessionId)
    : null

  return (
    <div>
      <p style={{ marginBottom: 'var(--space-4)' }}>
        <Link href="/review">← Sessions to Review</Link>
      </p>

      <header style={{ marginBottom: 'var(--space-6)' }}>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>
          {show.name}
        </p>
        <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
          {session.friendlyName || session.title}
        </h1>
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {startMs > 0 ? (
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {formatSessionDateTime(startMs, tz)}
            </span>
          ) : null}
          <span
            className={`badge ${sessionStatusBadgeClass({
              isDraft: session.isDraft,
              feedState: session.feedState,
            })}`}
            title="Live session state (read-only)"
          >
            Live: {sessionStatusLabel(
              { isDraft: session.isDraft, feedState: session.feedState },
              'admin',
            )}
          </span>
        </div>
      </header>

      <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
        <ReviewStatusControls
          showId={showId}
          sessionId={sessionId}
          session={session}
          userId={user?.uid ?? userDoc?.email ?? 'reviewer'}
          publicSummaryUrl={publicSummaryUrl}
        />
        <AiSummaryPanel aiSummary={session.aiSummary} />
        <TranscriptPanel chunks={chunks} />
        <AudioDownloadButton
          audioStoragePath={session.audioStoragePath}
          sessionLabel={session.friendlyName || session.title}
        />
        <ContentHealthPanel session={session} chunks={chunks} />
        <SessionPdfExport
          showName={show.name}
          session={session}
          chunks={chunks}
          scheduledLabel={
            startMs > 0 ? formatSessionDateTime(startMs, tz) : null
          }
          primaryColor={show.branding?.primaryColor}
        />
      </div>
    </div>
  )
}
