/**
 * Reviewer panel — reviewState transitions.
 *
 * Status values are a vocabulary, not a required sequence: any status may
 * move to any other. The only hard gate is publish + aiNotesConsent (enforced
 * in Firestore rules and in canPublishGivenConsent below).
 *
 * NOTE: Admin-side UI that mutates SessionDoc.reviewState should eventually
 * route through these helpers (especially applyReviewStatus) so history stays
 * consistent — rather than hand-patching the object. No Admin UI work in Phase 6.
 */

import { Timestamp } from 'firebase/firestore'
import type { ReviewHistoryEntry, ReviewState, ReviewStatus } from '@/types'

export const REVIEW_STATUSES: ReviewStatus[] = [
  'needs_review',
  'in_review',
  'approved',
  'published',
]

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return (
    value === 'needs_review' ||
    value === 'in_review' ||
    value === 'approved' ||
    value === 'published'
  )
}

export function isSessionPublished(reviewState: ReviewState | null | undefined): boolean {
  return reviewState?.status === 'published'
}

/** Missing aiNotesConsent is treated as true (matches create default). */
export function canPublishGivenConsent(aiNotesConsent: boolean | null | undefined): boolean {
  return aiNotesConsent !== false
}

export function defaultReviewState(changedBy: string, at: Timestamp = Timestamp.now()): ReviewState {
  return {
    status: 'needs_review',
    statusChangedBy: changedBy,
    statusChangedAt: at,
    history: [],
  }
}

/**
 * Apply a new status, appending history. Does not enforce consent — callers
 * must check canPublishGivenConsent before choosing 'published'.
 */
export function applyReviewStatus(
  current: ReviewState | null | undefined,
  nextStatus: ReviewStatus,
  changedBy: string,
  at: Timestamp = Timestamp.now(),
  notes?: string,
): ReviewState {
  const prev: ReviewState = current ?? defaultReviewState(changedBy, at)
  const entry: ReviewHistoryEntry = {
    status: nextStatus,
    changedBy,
    changedAt: at,
  }
  return {
    status: nextStatus,
    statusChangedBy: changedBy,
    statusChangedAt: at,
    notes: notes !== undefined ? notes : prev.notes,
    history: [...(prev.history ?? []), entry],
  }
}

/**
 * When a summary is regenerated after approval/publish, reset to needs_review.
 * Exported for future regenerate wiring — not called in Phase 6.
 */
export function onSummaryRegenerated(
  current: ReviewState | null | undefined,
  changedBy: string,
  at: Timestamp = Timestamp.now(),
): ReviewState {
  if (current?.status !== 'approved' && current?.status !== 'published') {
    return current ?? defaultReviewState(changedBy, at)
  }
  return applyReviewStatus(current, 'needs_review', changedBy, at)
}

export function reviewStatusLabel(status: ReviewStatus): string {
  switch (status) {
    case 'needs_review':
      return 'Needs review'
    case 'in_review':
      return 'In review'
    case 'approved':
      return 'Approved'
    case 'published':
      return 'Published'
    default:
      return status
  }
}

/** Brief inline copy for Reviewer status controls. */
export function reviewStatusActionCopy(status: ReviewStatus): {
  buttonLabel: string
  explanation: string
} {
  switch (status) {
    case 'needs_review':
      return {
        buttonLabel: 'Needs review',
        explanation: 'Reset to the review queue. Does not change the public summary page.',
      }
    case 'in_review':
      return {
        buttonLabel: 'In review',
        explanation: 'Mark that someone is actively reviewing this session.',
      }
    case 'approved':
      return {
        buttonLabel: 'Approved',
        explanation: 'Reviewed and ready to go — does not publish a public URL.',
      }
    case 'published':
      return {
        buttonLabel: 'Published',
        explanation: 'Creates a live URL at /summary/… accessible on the web.',
      }
  }
}
