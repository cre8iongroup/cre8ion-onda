/**
 * Canonical Realtime Database paths for live session data and output config.
 * All writers/readers must use these — never hand-roll `{sessionId}/chunks` at root.
 *
 * `outputLive/{roomId}` is intentionally a separate root from `liveSessions/{sessionId}`.
 * onSessionEnd deletes only the liveSessions node — it must never touch outputLive.
 */

export function rtdbLiveSessionPath(sessionId: string): string {
  const id = String(sessionId || '').replace(/^\/+|\/+$/g, '')
  if (!id || id.includes('/')) {
    throw new Error(`[rtdbPaths] invalid sessionId: ${JSON.stringify(sessionId)}`)
  }
  return `liveSessions/${id}`
}

export function rtdbLiveSessionChunksPath(sessionId: string): string {
  return `${rtdbLiveSessionPath(sessionId)}/chunks`
}

export function rtdbRecordingIndexPath(recordingId: string): string {
  const id = String(recordingId || '').replace(/^\/+|\/+$/g, '')
  if (!id || id.includes('/')) {
    throw new Error(`[rtdbPaths] invalid recordingId: ${JSON.stringify(recordingId)}`)
  }
  return `recordingIndex/${id}`
}

/**
 * Ephemeral live mirror of a room's outputConfig (Builder → Output Windows).
 * Shape: { windows: OutputWindowConfig[] }
 */
export function rtdbOutputLivePath(roomId: string): string {
  const id = String(roomId || '').replace(/^\/+|\/+$/g, '')
  if (!id || id.includes('/')) {
    throw new Error(`[rtdbPaths] invalid roomId: ${JSON.stringify(roomId)}`)
  }
  return `outputLive/${id}`
}

export function rtdbOutputLiveWindowsPath(roomId: string): string {
  return `${rtdbOutputLivePath(roomId)}/windows`
}

/** True when path is exactly liveSessions/{sessionId}/chunks (no extra segments). */
export function isLiveSessionChunksPath(path: string): boolean {
  return /^liveSessions\/[^/]+\/chunks$/.test(path.replace(/^\/+|\/+$/g, ''))
}
