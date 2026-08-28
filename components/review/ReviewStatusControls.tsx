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

      <div
        role="group"
        aria-label="Change review status"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--space-3)',
        }}
      >
        {REVIEW_STATUSES.map((status) => {
          const { buttonLabel, explanation } = reviewStatusActionCopy(status)
          const isCurrent = reviewState.status === status
          const publishBlocked = status === 'published' && !consentOk
          const isSaving = busy === status
          const disabled = busy !== null || publishBlocked

          return (
            <button
              key={status}
              type="button"
              aria-pressed={isCurrent}
              aria-disabled={isCurrent || disabled}
              disabled={!isCurrent && disabled}
              className={`btn ${isCurrent ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => void setStatus(status)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 'var(--space-1)',
                height: 'auto',
                minHeight: '4.5rem',
                padding: 'var(--space-3)',
                textAlign: 'left',
                whiteSpace: 'normal',
                lineHeight: 1.4,
                ...(isCurrent
                  ? { cursor: 'default', pointerEvents: 'none' }
                  : undefined),
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{buttonLabel}</span>
              <span
                className="text-sm"
                style={{
                  fontWeight: 400,
                  color: isCurrent ? 'rgba(255, 255, 255, 0.92)' : 'var(--color-text-muted)',
                }}
              >
                {explanation}
              </span>
              {publishBlocked ? (
                <span className="text-sm field-error" style={{ marginTop: 'var(--space-1)' }}>
                  Consent required
                </span>
              ) : null}
              {isSaving ? (
                <span
                  className="text-sm"
                  style={{
                    marginTop: 'var(--space-1)',
                    color: isCurrent ? 'rgba(255, 255, 255, 0.9)' : 'var(--color-text-muted)',
                  }}
                >
                  Saving…
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
