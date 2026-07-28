/**
 * Canonical Realtime Database paths for live session data.
 * All writers/readers must use these — never hand-roll `{sessionId}/chunks` at root.
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

/** True when path is exactly liveSessions/{sessionId}/chunks (no extra segments). */
export function isLiveSessionChunksPath(path: string): boolean {
  return /^liveSessions\/[^/]+\/chunks$/.test(path.replace(/^\/+|\/+$/g, ''))
}
