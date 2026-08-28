export type TranscriptChunkInput = {
  text?: string
  speakerLabel?: string | null
}

export function computeTranscriptStats(chunks: TranscriptChunkInput[]): {
  chunkCount: number
  charCount: number
  lines: string[]
} {
  const lines: string[] = []
  let charCount = 0

  for (const chunk of chunks) {
    const text = typeof chunk.text === 'string' ? chunk.text.trim() : ''
    charCount += text.length
    const speakerPrefix = chunk.speakerLabel ? `${chunk.speakerLabel}: ` : ''
    lines.push(`${speakerPrefix}${chunk.text ?? ''}`)
  }

  return {
    chunkCount: chunks.length,
    charCount,
    lines,
  }
}
