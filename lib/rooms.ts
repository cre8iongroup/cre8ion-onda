/**
 * Show-scoped rooms helpers (Admin + unlock resolution).
 * Rooms live as an array on ShowDoc — not a subcollection.
 */

import type { ShowRoom } from '@/types'

/** Stable client-generated id for a new room entry. */
export function newRoomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeRoomName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export function roomNameKey(name: string): string {
  return normalizeRoomName(name).toLowerCase()
}

/** Case-insensitive uniqueness within a show. */
export function findRoomNameConflict(
  rooms: ShowRoom[] | null | undefined,
  name: string,
  exceptRoomId?: string,
): ShowRoom | null {
  const key = roomNameKey(name)
  if (!key) return null
  for (const room of rooms ?? []) {
    if (exceptRoomId && room.id === exceptRoomId) continue
    if (roomNameKey(room.name) === key) return room
  }
  return null
}

export function resolveRoomName(
  rooms: ShowRoom[] | null | undefined,
  roomId: string | null | undefined,
): string {
  if (!roomId) return ''
  const hit = (rooms ?? []).find((r) => r.id === roomId)
  return hit?.name ?? 'Unknown room'
}

export function sortRoomsByName(rooms: ShowRoom[] | null | undefined): ShowRoom[] {
  return [...(rooms ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}
