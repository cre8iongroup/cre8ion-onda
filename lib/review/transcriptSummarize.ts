import { parseAiSummary } from '@/lib/review/parseAiSummary'
import type { SessionDoc, TranscriptChunk, WithId } from '@/types'

/** Keep in sync with functions/src/lib/runSummarizeForSession.ts */
export const MIN_TRANSCRIPT_CHARS = 200

export type SummarizeEligibility =
  | { state: 'insufficient_content'; chunkCount: number; charCount: number }
  | { state: 'ready'; chunkCount: number; charCount: number }
  | { state: 'has_summary'; chunkCount: number; charCount: number }

export function computeClientTranscriptCharCount(chunks: Array<Pick<TranscriptChunk, 'text'>>): number {
  return chunks.reduce((sum, chunk) => {
    const text = typeof chunk.text === 'string' ? chunk.text.trim() : ''
    return sum + text.length
  }, 0)
}

export function getSummarizeEligibility(
  chunks: WithId<TranscriptChunk>[],
  aiSummary: string | undefined,
): SummarizeEligibility {
  const chunkCount = chunks.length
  const charCount = computeClientTranscriptCharCount(chunks)

  if (chunkCount === 0 || charCount < MIN_TRANSCRIPT_CHARS) {
    return { state: 'insufficient_content', chunkCount, charCount }
  }

  if (parseAiSummary(aiSummary).ok) {
    return { state: 'has_summary', chunkCount, charCount }
  }

  return { state: 'ready', chunkCount, charCount }
}
