/**
 * Client writes for room outputConfig (Firestore) + outputLive (RTDB).
 * Never persist undefined fields — omit optionals instead.
 */

import { doc, Timestamp, updateDoc } from 'firebase/firestore'
import { ref, set } from 'firebase/database'
import { getClientDatabase, getClientFirestore } from '@/lib/firebase/client'
import { sanitizeOutputWindows } from '@/lib/output/defaults'
import { rtdbOutputLivePath } from '@/lib/rtdbPaths'
import type { OutputWindowConfig, RoomOutputConfig } from '@/types'

export async function writeOutputLive(roomId: string, windows: OutputWindowConfig[]): Promise<void> {
  const db = getClientDatabase()
  const sanitized = sanitizeOutputWindows(windows)
  await set(ref(db, rtdbOutputLivePath(roomId)), { windows: sanitized })
}

export async function writeRoomOutputConfig(
  showId: string,
  roomId: string,
  windows: OutputWindowConfig[],
  updatedBy: string,
): Promise<void> {
  const fs = getClientFirestore()
  const sanitized = sanitizeOutputWindows(windows)
  const outputConfig: RoomOutputConfig = {
    windows: sanitized,
    updatedAt: Timestamp.now(),
    updatedBy,
  }
  await updateDoc(doc(fs, 'shows', showId, 'rooms', roomId), { outputConfig })
}
