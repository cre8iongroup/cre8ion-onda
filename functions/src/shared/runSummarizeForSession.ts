import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions/v1'
import Anthropic from '@anthropic-ai/sdk'
import { computeTranscriptStats } from './transcriptStats'

const firestore = admin.firestore()

/** Keep in sync with lib/review/transcriptSummarize.ts */
export const MIN_TRANSCRIPT_CHARS = 200

export const SYSTEM_PROMPT = `You are a professional conference session summarizer. 
Given a raw live-event transcript, produce a structured JSON summary with these exact fields:
{
  "executiveSummary": "2-4 paragraph prose summary of the session",
  "keyTopics": ["topic 1", "topic 2", ...],
  "actionItems": ["action 1", "action 2", ...],
  "quotes": [
    { "speaker": "optional speaker name", "text": "notable quote" },
    ...
  ]
}

Rules:
- executiveSummary: narrative prose, 2-4 paragraphs, no bullet points
- keyTopics: 3-8 key themes or subjects covered
- actionItems: concrete follow-ups or calls to action mentioned (may be empty array)
- quotes: 2-5 notable quotes, verbatim or near-verbatim from the transcript
- Speaker labels may be present as "Speaker 1:", "Speaker 2:", etc. — use them if helpful
- Respond with raw JSON only: start with { and end with }. No markdown, no code fences, no \`\`\`json blocks, no preamble or commentary
`

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenceMatch ? fenceMatch[1].trim() : trimmed
}

interface ClaudeSummaryOutput {
  executiveSummary: string
  keyTopics: string[]
  actionItems: string[]
  quotes: Array<{ speaker?: string; text: string }>
}

export type RunSummarizeOptions = {
  triggeredBy: string
  customInstructions?: string
  skipIfInsufficientContent?: boolean
  source?: 'callable' | 'auto-migration' | 'backfill'
}

export type RunSummarizeFailureReason =
  | 'no_transcripts'
  | 'insufficient_content'
  | 'claude_error'
  | 'parse_error'
  | 'missing_api_key'

export type RunSummarizeUsage = {
  inputTokens: number
  outputTokens: number
}

export type RunSummarizeResult =
  | { ok: true; chunkCount: number; charCount: number; usage?: RunSummarizeUsage }
  | { ok: false; reason: RunSummarizeFailureReason }

function buildUserMessage(fullTranscript: string, customInstructions?: string): string {
  if (customInstructions?.trim()) {
    return `Please summarize this conference session transcript. Additional instructions: ${customInstructions.trim()}\n\n${fullTranscript}`
  }
  return `Please summarize this conference session transcript:\n\n${fullTranscript}`
}

export async function runSummarizeForSession(
  showId: string,
  sessionId: string,
  options: RunSummarizeOptions,
): Promise<RunSummarizeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    functions.logger.error('runSummarizeForSession: ANTHROPIC_API_KEY not configured', {
      showId,
      sessionId,
    })
    return { ok: false, reason: 'missing_api_key' }
  }

  const transcriptsSnap = await firestore
    .collection(`shows/${showId}/sessions/${sessionId}/transcripts`)
    .orderBy('sequenceNumber', 'asc')
    .get()

  if (transcriptsSnap.empty) {
    return { ok: false, reason: 'no_transcripts' }
  }

  const chunks = transcriptsSnap.docs.map((doc) => doc.data())
  const { chunkCount, charCount, lines } = computeTranscriptStats(chunks)

  if (options.skipIfInsufficientContent && charCount < MIN_TRANSCRIPT_CHARS) {
    functions.logger.info('runSummarizeForSession: skipped — insufficient content', {
      showId,
      sessionId,
      chunkCount,
      charCount,
      source: options.source ?? 'callable',
    })
    return { ok: false, reason: 'insufficient_content' }
  }

  if (charCount < MIN_TRANSCRIPT_CHARS) {
    return { ok: false, reason: 'insufficient_content' }
  }

  const fullTranscript = lines.join('\n')

  functions.logger.info('runSummarizeForSession: calling Claude', {
    showId,
    sessionId,
    chunkCount,
    charCount,
    source: options.source ?? 'callable',
  })

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserMessage(fullTranscript, options.customInstructions),
        },
      ],
    })

    const rawContent = response.content[0]
    if (rawContent.type !== 'text') {
      functions.logger.error('runSummarizeForSession: unexpected Claude response format', {
        showId,
        sessionId,
      })
      return { ok: false, reason: 'claude_error' }
    }

    let summary: ClaudeSummaryOutput
    try {
      summary = JSON.parse(stripCodeFence(rawContent.text))
    } catch {
      functions.logger.error('runSummarizeForSession: failed to parse Claude JSON', {
        showId,
        sessionId,
        raw: rawContent.text,
      })
      return { ok: false, reason: 'parse_error' }
    }

    const sessionRef = firestore.doc(`shows/${showId}/sessions/${sessionId}`)
    await sessionRef.update({
      aiSummary: JSON.stringify(summary),
      aiSummaryGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      aiSummaryTriggeredBy: options.triggeredBy,
    })

    await firestore.collection('auditLog').add({
      action: 'SUMMARY_TRIGGERED',
      performedBy: options.triggeredBy,
      performedAt: admin.firestore.FieldValue.serverTimestamp(),
      showId,
      sessionId,
      metadata: {
        chunkCount,
        charCount,
        source: options.source ?? 'callable',
      },
    })

    functions.logger.info('runSummarizeForSession: complete', {
      showId,
      sessionId,
      chunkCount,
      charCount,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    })

    return {
      ok: true,
      chunkCount,
      charCount,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : undefined,
    }
  } catch (err) {
    functions.logger.error('runSummarizeForSession: Claude call failed', {
      showId,
      sessionId,
      err,
    })
    return { ok: false, reason: 'claude_error' }
  }
}
