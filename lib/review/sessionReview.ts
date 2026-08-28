import type { ReviewState, SessionDoc } from '@/types'
import { defaultReviewState } from '@/lib/review/reviewState'

/** Coerce legacy Session docs that predate reviewState. */
export function normalizeReviewState(
  data: Pick<SessionDoc, 'reviewState'> | null | undefined,
  fallbackChangedBy = 'system',
): ReviewState {
  const raw = data?.reviewState
  if (raw && typeof raw.status === 'string' && raw.statusChangedBy) {
    return {
      ...raw,
      history: Array.isArray(raw.history) ? raw.history : [],
    }
  }
  return defaultReviewState(fallbackChangedBy)
}

export function reviewStatusBadgeClass(status: ReviewState['status']): string {
  switch (status) {
    case 'published':
      return 'badge-success'
    case 'approved':
      return 'badge-info'
    case 'in_review':
      return 'badge-live'
    case 'needs_review':
    default:
      return 'badge-muted'
  }
}
