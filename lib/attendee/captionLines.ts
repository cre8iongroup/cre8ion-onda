/**
 * Collapse RTDB transcript chunks into caption display lines.
 *
 * Recall writes many transcript.partial_data nodes (isFinalized: false) for the
 * same in-progress utterance, then one transcript.data (isFinalized: true).
 * The panel must show completed sentences plus at most one live line — not one
 * row per partial.
 *
 * Shared with Operator (`electron-spike/renderer-src/lib/captionLines.js`) so
 * attendee and Operator wrap/break the same logical lines from the same RTDB.
 */

export type CaptionChunkLike = {
  id?: string
  text?: string
  speakerLabel?: string | null
  timestamp?: number
  sequenceNumber?: number
  isFinalized?: boolean
  isFinal?: boolean
}

export type CaptionDisplayLine = {
  id: string
  text: string
  speakerLabel: string | null
  finalized: boolean
  timestamp: number
}

export function isChunkFinalized(chunk: CaptionChunkLike | null | undefined): boolean {
  if (!chunk) return false
  return chunk.isFinalized === true || chunk.isFinal === true
}

export function buildCaptionDisplayLines(
  chunks: CaptionChunkLike[] | null | undefined,
): CaptionDisplayLine[] {
  if (!Array.isArray(chunks) || chunks.length === 0) return []

  const sorted = [...chunks].sort((a, b) => {
    const dt = (a.timestamp || 0) - (b.timestamp || 0)
    if (dt !== 0) return dt
    return (a.sequenceNumber || 0) - (b.sequenceNumber || 0)
  })

  const finals: CaptionDisplayLine[] = []
  let inProgress: CaptionDisplayLine | null = null

  for (const chunk of sorted) {
    const text = typeof chunk.text === 'string' ? chunk.text.trim() : ''
    if (!text) continue

    const row = {
      id: chunk.id || `seq-${chunk.sequenceNumber ?? finals.length}`,
      text,
      speakerLabel: chunk.speakerLabel ?? null,
      timestamp: chunk.timestamp || 0,
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
