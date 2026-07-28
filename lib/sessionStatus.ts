import type { FeedState } from '@/types'

export type SessionStatusAudience = 'operator' | 'admin'

/**
 * Per-UI labels for isDraft + feedState.
 * Attendee formatting is Phase 5 — not handled here.
 */
export function sessionStatusLabel(
  opts: { isDraft?: boolean; feedState?: FeedState | string | null },
  audience: SessionStatusAudience,
): string {
  if (opts.isDraft) return audience === 'admin' ? 'Draft' : 'Hidden'

  switch (opts.feedState) {
    case 'standby':
      return audience === 'admin' ? 'Ready' : 'Standby'
    case 'testing':
      return audience === 'operator' ? 'Sound check' : 'Testing'
    case 'live':
      return 'Live'
    case 'stopping':
      return 'Stopping'
    case 'ended':
      return 'Ended'
    default:
      return opts.feedState ? String(opts.feedState) : 'Unknown'
  }
}

/** Admin badge class tokens for isDraft + feedState. */
export function sessionStatusBadgeClass(opts: {
  isDraft?: boolean
  feedState?: FeedState | string | null
}): string {
  if (opts.isDraft) return 'badge-muted'
  switch (opts.feedState) {
    case 'live':
      return 'badge-live'
    case 'testing':
      return 'badge-info'
    case 'stopping':
      return 'badge-standby'
    case 'standby':
      return 'badge-info'
    case 'ended':
      return 'badge-muted'
    default:
      return 'badge-muted'
  }
}

/** Hide (isDraft→true) only allowed at standby or ended. */
export function canHideSession(feedState: FeedState | string | null | undefined): boolean {
  return feedState === 'standby' || feedState === 'ended'
}
