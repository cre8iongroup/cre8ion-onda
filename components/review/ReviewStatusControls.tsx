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
import type { ReviewState, ReviewStatus, SessionDoc } from '@/types'
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
      console.error('ReviewStatusControls: update failed', err)
      setError(err instanceof Error ? err.message : 'Failed to update status.')
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

      <div className="form-group" style={{ gap: 'var(--space-4)' }}>
        {REVIEW_STATUSES.map((status) => {
          const { buttonLabel, explanation } = reviewStatusActionCopy(status)
          const isCurrent = reviewState.status === status
          const publishBlocked = status === 'published' && !consentOk
          const disabled = busy !== null || isCurrent || publishBlocked

          return (
            <div
              key={status}
              className="card"
              style={{
                padding: 'var(--space-4)',
                borderColor: isCurrent ? 'var(--color-accent)' : undefined,
              }}
            >
              <div
                className="flex items-center justify-between gap-4"
                style={{ flexWrap: 'wrap' }}
              >
                <div>
                  <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>{buttonLabel}</p>
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    {explanation}
                  </p>
                  {publishBlocked ? (
                    <p className="text-sm field-error" style={{ marginTop: 'var(--space-2)' }}>
                      AI notes consent not given for this session
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={`btn ${isCurrent ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  disabled={disabled}
                  onClick={() => void setStatus(status)}
                >
                  {busy === status
                    ? 'Saving…'
                    : isCurrent
                      ? `Current (${reviewStatusLabel(status)})`
                      : `Set ${buttonLabel}`}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
