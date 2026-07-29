/**
 * Collapse RTDB transcript chunks into caption display lines.
 *
 * Recall writes many transcript.partial_data nodes (isFinalized: false) for the
 * same in-progress utterance, then one transcript.data (isFinalized: true).
 * The panel must show completed sentences plus at most one live line — not one
 * row per partial.
 *
 * Walks chunks in timestamp order:
 *   - finalized → append permanent line, clear in-progress
 *   - partial   → replace the single current in-progress line
 */

export function isChunkFinalized(chunk) {
  if (!chunk) return false
  return chunk.isFinalized === true || chunk.isFinal === true
}

/**
 * @param {Array<{ id?: string, text?: string, speakerLabel?: string|null, timestamp?: number, sequenceNumber?: number, isFinalized?: boolean, isFinal?: boolean }>} chunks
 * @returns {Array<{ id: string, text: string, speakerLabel: string|null, finalized: boolean, timestamp: number }>}
 */
export function buildCaptionDisplayLines(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return []

  const sorted = [...chunks].sort((a, b) => {
    const dt = (a.timestamp || 0) - (b.timestamp || 0)
    if (dt !== 0) return dt
    return (a.sequenceNumber || 0) - (b.sequenceNumber || 0)
  })

  const finals = []
  let inProgress = null

  for (const chunk of sorted) {
    const text = typeof chunk.text === 'string' ? chunk.text.trim() : ''
    if (!text) continue

    const row = {
      id: chunk.id || `seq-${chunk.sequenceNumber ?? finals.length}`,
      text,
      speakerLabel: chunk.speakerLabel ?? null,
      timestamp: chunk.timestamp || 0,
      sequenceNumber: chunk.sequenceNumber ?? 0,
    }

    if (isChunkFinalized(chunk)) {
      finals.push({ ...row, finalized: true })
      inProgress = null
    } else {
      // Stable key so React updates text in place across partial RTDB push-ids.
      inProgress = {
        ...row,
        id: 'caption-in-progress',
        finalized: false,
      }
    }
  }

  return inProgress ? [...finals, inProgress] : finals
}
