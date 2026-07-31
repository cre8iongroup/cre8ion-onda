/**
 * Show-scoped rooms helpers (Admin + unlock resolution).
 *
 * Canonical room docs: shows/{showId}/rooms/{roomId}
 * Denormalized catalog: ShowDoc.rooms[] {id,name} — kept in sync for Operator unlock.
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  type Firestore,
  Timestamp,
} from 'firebase/firestore'
import type { RoomDoc, ShowRoom } from '@/types'
import { defaultRoomDocFields } from '@/lib/branding'

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

export function roomDocPath(showId: string, roomId: string): string {
  return `shows/${showId}/rooms/${roomId}`
}

export function denormalizedRoomsFromList(rooms: ShowRoom[]): ShowRoom[] {
  return rooms.map((r) => ({ id: r.id, name: r.name }))
}

/**
 * Dual-write: create room subcollection doc + update ShowDoc.rooms[].
 */
export async function createRoomDualWrite(
  fs: Firestore,
  showId: string,
  rooms: ShowRoom[],
  name: string,
  createdBy: string,
  roomId?: string,
): Promise<ShowRoom> {
  const id = roomId || newRoomId()
  const trimmed = normalizeRoomName(name)
  const entry: ShowRoom = { id, name: trimmed }
  const next = [...rooms, entry]

  const payload: RoomDoc = defaultRoomDocFields(trimmed, createdBy, Timestamp.now())
  await setDoc(doc(fs, 'shows', showId, 'rooms', id), payload)
  await updateDoc(doc(fs, 'shows', showId), { rooms: next })
  return entry
}

/**
 * Dual-write: rename room subcollection doc + update ShowDoc.rooms[].
 */
export async function renameRoomDualWrite(
  fs: Firestore,
  showId: string,
  rooms: ShowRoom[],
  roomId: string,
  name: string,
): Promise<ShowRoom[]> {
  const trimmed = normalizeRoomName(name)
  const next = rooms.map((r) => (r.id === roomId ? { ...r, name: trimmed } : r))
  await updateDoc(doc(fs, 'shows', showId, 'rooms', roomId), { name: trimmed })
  await updateDoc(doc(fs, 'shows', showId), { rooms: next })
  return next
}

/**
 * Dual-write: delete room subcollection doc + update ShowDoc.rooms[].
 */
export async function deleteRoomDualWrite(
  fs: Firestore,
  showId: string,
  rooms: ShowRoom[],
  roomId: string,
): Promise<ShowRoom[]> {
  const next = rooms.filter((r) => r.id !== roomId)
  await deleteDoc(doc(fs, 'shows', showId, 'rooms', roomId))
  await updateDoc(doc(fs, 'shows', showId), { rooms: next })
  return next
}

export function roomsCollection(fs: Firestore, showId: string) {
  return collection(fs, 'shows', showId, 'rooms')
}
