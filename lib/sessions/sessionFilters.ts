import type { Timestamp } from 'firebase/firestore'
import type { ReviewStatus, SessionDoc, WithId } from '@/types'

export type TimeBucket = 'morning' | 'afternoon' | 'evening'

export type TimeSort = 'asc' | 'desc'

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  morning: 'Morning (before 12)',
  afternoon: 'Afternoon (12–5)',
  evening: 'Evening (5+)',
}

export function sessionDateKey(ts?: Timestamp): string | null {
  if (!ts) return null
  const d = ts.toDate()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatSessionDateLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function sessionTimeBucket(ts?: Timestamp): TimeBucket | null {
  if (!ts) return null
  const hour = ts.toDate().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

export function getSessionDateOptions(
  sessions: Array<Pick<SessionDoc, 'scheduledStart'>>,
): string[] {
  const keys = new Set<string>()
  for (const s of sessions) {
    const k = sessionDateKey(s.scheduledStart)
    if (k) keys.add(k)
  }
  return [...keys].sort()
}

export type SessionListFilters = {
  search: string
  roomId: string
  dateKey: string
  timeBucket: '' | TimeBucket
  reviewStatus?: '' | ReviewStatus
}

export function filterSessions<T extends WithId<SessionDoc>>(
  sessions: T[],
  filters: SessionListFilters,
  getReviewStatus?: (session: T) => ReviewStatus,
): T[] {
  const q = filters.search.trim().toLowerCase()

  return sessions.filter((s) => {
    if (filters.roomId && s.roomId !== filters.roomId) return false

    if (filters.dateKey) {
      const k = sessionDateKey(s.scheduledStart)
      if (k !== filters.dateKey) return false
    }

    if (filters.timeBucket) {
      if (sessionTimeBucket(s.scheduledStart) !== filters.timeBucket) return false
    }

    if (filters.reviewStatus && getReviewStatus) {
      if (getReviewStatus(s) !== filters.reviewStatus) return false
    }

    if (q) {
      const title = (s.title || '').toLowerCase()
      const friendly = (s.friendlyName || '').toLowerCase()
      if (!title.includes(q) && !friendly.includes(q)) return false
    }

    return true
  })
}

export function sessionFiltersActive(filters: SessionListFilters): boolean {
  return Boolean(
    filters.search.trim() ||
      filters.roomId ||
      filters.dateKey ||
      filters.timeBucket ||
      filters.reviewStatus,
  )
}

export function sortSessionsByScheduledStart<T extends SessionDoc>(
  sessions: T[],
  direction: TimeSort,
): T[] {
  return [...sessions].sort((a, b) => {
    const aMs = a.scheduledStart?.toMillis?.() ?? 0
    const bMs = b.scheduledStart?.toMillis?.() ?? 0
    return direction === 'asc' ? aMs - bMs : bMs - aMs
  })
}
