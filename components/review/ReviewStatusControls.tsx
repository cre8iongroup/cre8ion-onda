'use client'

import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { Timestamp } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import {
  REVIEW_STATUSES,
  applyReviewStatus,
  canPublishGivenConsent,
  reviewStatusActionCopy,
  reviewStatusLabel,
} from '@/lib/review/reviewState'
import { normalizeReviewState } from '@/lib/review/sessionReview'
import { userFacingError } from '@/lib/review/userFacingError'
import type { ReviewStatus, SessionDoc } from '@/types'
import ReviewStatusBadge from './ReviewStatusBadge'

type Props = {
  showId: string
  sessionId: string
  session: SessionDoc
  userId: string
  publicSummaryUrl: string | null
  onUpdated?: () => void
}

export default function ReviewStatusControls({
  showId,
  sessionId,
  session,
  userId,
  publicSummaryUrl,
  onUpdated,
}: Props) {
  const [busy, setBusy] = useState<ReviewStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const reviewState = normalizeReviewState(session, userId)
  const consentOk = canPublishGivenConsent(session.aiNotesConsent)
  const isPublished = reviewState.status === 'published'
  const statusCopy = reviewStatusActionCopy(reviewState.status)

  async function setStatus(next: ReviewStatus) {
    if (next === reviewState.status) return
    if (next === 'published' && !consentOk) return
    setError(null)
    setBusy(next)
    try {
      const nextState = applyReviewStatus(reviewState, next, userId, Timestamp.now())
      const fs = getClientFirestore()
      await updateDoc(doc(fs, 'shows', showId, 'sessions', sessionId), {
        reviewState: nextState,
      })
      onUpdated?.()
    } catch (err: unknown) {
      setError(
        userFacingError(
          err,
          'There was a problem updating this session\'s status. Please try again.',
        ),
      )
    } finally {
      setBusy(null)
    }
  }

  async function copyPublicUrl() {
    if (!publicSummaryUrl) return
    try {
      await navigator.clipboard.writeText(publicSummaryUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy URL to clipboard.')
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <div
        className="flex items-center justify-between gap-4"
        style={{ flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}
      >
        <div>
          <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>
            Review status
          </h3>
          <ReviewStatusBadge status={reviewState.status} />
        </div>
        {isPublished && publicSummaryUrl ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <a
              href={publicSummaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
            >
              Open public page
            </a>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copyPublicUrl()}
            >
              {copied ? 'Copied!' : 'Copy public URL'}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      ) : null}

      {!consentOk ? (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          AI notes consent not given for this session — publishing is blocked until consent is
          restored in Firestore.
        </div>
      ) : null}

      <div className="field" style={{ marginBottom: 'var(--space-2)' }}>
        <label className="label" htmlFor="review-status-select">
          Change status
        </label>
        <select
          id="review-status-select"
          className="input"
          value={reviewState.status}
          disabled={busy !== null}
          onChange={(e) => void setStatus(e.target.value as ReviewStatus)}
          style={{ maxWidth: '20rem' }}
        >
          {REVIEW_STATUSES.map((status) => {
            const publishBlocked = status === 'published' && !consentOk
            return (
              <option key={status} value={status} disabled={publishBlocked}>
                {reviewStatusLabel(status)}
              </option>
            )
          })}
        </select>
      </div>

      <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: 0 }}>
        {statusCopy.explanation}
      </p>
      {reviewState.status === 'published' && !consentOk ? (
        <p className="text-sm field-error" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
          AI notes consent not given for this session
        </p>
      ) : null}
      {busy ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
          Saving…
        </p>
      ) : null}
    </div>
  )
}
