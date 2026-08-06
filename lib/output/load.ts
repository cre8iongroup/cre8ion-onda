/**
 * Server-only loaders for public Output Windows.
 * Reuses attendee room resolution; adds window index resolution for SSR seed.
 *
 * Future: optional room-scoped test/preview session — out of scope for this pass.
 */

import 'server-only'

import { loadPublicRoomById, type PublicRoom, type PublicSession } from '@/lib/attendee/load'
import { DEFAULT_TEXT_COLOR } from '@/lib/branding'
import type { OutputWindowConfig, RoomOutputConfig } from '@/types'

export type OutputWindowContext = {
  room: PublicRoom
  windowIndex: number
  windowConfig: OutputWindowConfig | null
  outputConfig: RoomOutputConfig | null
  brandTextColor: string
  liveSession: PublicSession | null
}

/**
 * Load room + window config for `/output/[roomId]/[windowIndex]`.
 * Returns null if room not found (unpublished / missing).
 */
export async function loadOutputWindowContext(
  roomId: string,
  windowIndex: number,
): Promise<OutputWindowContext | null> {
  const room = await loadPublicRoomById(roomId)
  if (!room) return null

  const outputConfig =
    room.outputConfig && Array.isArray(room.outputConfig.windows) ? room.outputConfig : null

  const idx = Number.isFinite(windowIndex) ? Math.floor(windowIndex) : -1
  const windowConfig =
    outputConfig && idx >= 0 && idx < outputConfig.windows.length
      ? outputConfig.windows[idx]
      : null

  return {
    room,
    windowIndex: idx,
    windowConfig,
    outputConfig,
    brandTextColor: room.branding.textColor || DEFAULT_TEXT_COLOR,
    liveSession: room.liveSession,
  }
}

export { resolveOutputTextColor } from '@/lib/output/resolveTextColor'
