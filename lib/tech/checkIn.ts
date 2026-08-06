/**
 * Tech Panel room check-in (browser session only).
 * Mirrors Operator: sticky for the shift, not across days / restarts.
 * URL (`/tech/output?roomId=&showId=`) remains the canonical in-room address;
 * sessionStorage lets `/tech` redirect back mid-shift and powers sidebar chrome.
 */

export const TECH_CHECKIN_STORAGE_KEY = 'onda.tech.checkedInRoom'
export const TECH_CHECKIN_EVENT = 'onda-tech-checkin'

export interface TechCheckIn {
  showId: string
  roomId: string
  roomName: string
  showName?: string
}

function notifyCheckInChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(TECH_CHECKIN_EVENT))
}

export function readTechCheckIn(): TechCheckIn | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(TECH_CHECKIN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TechCheckIn>
    if (
      typeof parsed.showId !== 'string' ||
      !parsed.showId ||
      typeof parsed.roomId !== 'string' ||
      !parsed.roomId ||
      typeof parsed.roomName !== 'string' ||
      !parsed.roomName
    ) {
      return null
    }
    return {
      showId: parsed.showId,
      roomId: parsed.roomId,
      roomName: parsed.roomName,
      showName: typeof parsed.showName === 'string' ? parsed.showName : undefined,
    }
  } catch {
    return null
  }
}

export function writeTechCheckIn(checkIn: TechCheckIn): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(TECH_CHECKIN_STORAGE_KEY, JSON.stringify(checkIn))
  notifyCheckInChanged()
}

export function clearTechCheckIn(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(TECH_CHECKIN_STORAGE_KEY)
  notifyCheckInChanged()
}

export function techOutputHref(showId: string, roomId: string): string {
  const params = new URLSearchParams()
  params.set('showId', showId)
  params.set('roomId', roomId)
  return `/tech/output?${params.toString()}`
}

export function techCheckInHref(showId?: string | null): string {
  if (!showId) return '/tech'
  return `/tech?showId=${encodeURIComponent(showId)}`
}
