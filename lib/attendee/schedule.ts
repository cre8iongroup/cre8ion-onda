/**
 * Schedule grouping helpers for attendee room / browse views.
 * Day keys use the show's IANA timezone (showTimezone).
 */

import type { PublicSession } from '@/lib/attendee/load'

export function dayKeyInTimezone(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms))
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms))
  }
}

export function formatDayHeader(dayKey: string, timeZone: string): string {
  // dayKey is YYYY-MM-DD
  const [y, m, d] = dayKey.split('-').map(Number)
  if (!y || !m || !d) return dayKey
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0)
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(utcNoon))
  } catch {
    return dayKey
  }
}

export function formatSessionTime(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleTimeString()
  }
}

export type DayGroup = {
  dayKey: string
  label: string
  sessions: PublicSession[]
}

export function groupSessionsByDay(
  sessions: PublicSession[],
  timeZone: string,
): DayGroup[] {
  const map = new Map<string, PublicSession[]>()
  for (const s of sessions) {
    const key = dayKeyInTimezone(s.scheduledStartMs, timeZone)
    const list = map.get(key) ?? []
    list.push(s)
    map.set(key, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, list]) => ({
      dayKey,
      label: formatDayHeader(dayKey, timeZone),
      sessions: list,
    }))
}
