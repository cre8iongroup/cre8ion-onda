/**
 * One-time AI summary backfill for ended sessions missing a valid summary.
 *
 * DEFAULT: dry run (no Claude calls, no writes).
 *
 * Usage (from repo root):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/cre8ion-onda-sa.json \
 *   ANTHROPIC_API_KEY=sk-... \
 *   npx tsx functions/src/scripts/backfill-summaries.ts
 *
 * Real run (explicit flag required):
 *   ... npx tsx functions/src/scripts/backfill-summaries.ts --execute
 *
 * Optional:
 *   --concurrency=2   (default 2, max 5)
 */

import * as admin from 'firebase-admin'
import { parseAiSummary } from '../../../lib/review/parseAiSummary'
import { isAvTestSession } from '../../../lib/sessions/sessionFilters'
import {
  MIN_TRANSCRIPT_CHARS,
  runSummarizeForSession,
  type RunSummarizeFailureReason,
} from '../shared/runSummarizeForSession'
import { computeTranscriptStats } from '../shared/transcriptStats'

/** claude-opus-4-5 list pricing (USD per million tokens) — update if model/pricing changes */
const INPUT_USD_PER_M = 5
const OUTPUT_USD_PER_M = 25

type SessionRow = {
  showId: string
  sessionId: string
  title: string
  chunkCount: number
  charCount: number
}

type SessionDocLike = {
  title?: string
  friendlyName?: string
  feedState?: string
  isDraft?: boolean
  aiSummary?: string
}

function parseArgs(argv: string[]) {
  const execute = argv.includes('--execute')
  let concurrency = 2
  for (const arg of argv) {
    const m = arg.match(/^--concurrency=(\d+)$/)
    if (m) concurrency = Math.min(5, Math.max(1, Number(m[1])))
  }
  return { execute, concurrency }
}

function sessionTitle(data: SessionDocLike): string {
  return (data.friendlyName || data.title || '(untitled)').trim()
}

function passesSessionFilters(data: SessionDocLike): boolean {
  if (data.feedState !== 'ended') return false
  if (data.isDraft === true) return false
  if (isAvTestSession({ title: data.title ?? '', friendlyName: data.friendlyName })) return false
  if (parseAiSummary(data.aiSummary).ok) return false
  return true
}

async function loadEligibleSessions(firestore: admin.firestore.Firestore): Promise<SessionRow[]> {
  const eligible: SessionRow[] = []
  const showsSnap = await firestore.collection('shows').get()

  for (const showDoc of showsSnap.docs) {
    const showId = showDoc.id
    const sessionsSnap = await firestore.collection(`shows/${showId}/sessions`).get()

    for (const sessionDoc of sessionsSnap.docs) {
      const data = sessionDoc.data() as SessionDocLike
      if (!passesSessionFilters(data)) continue

      const transcriptsSnap = await firestore
        .collection(`shows/${showId}/sessions/${sessionDoc.id}/transcripts`)
        .get()

      const chunks = transcriptsSnap.docs.map((d) => d.data())
      const { chunkCount, charCount } = computeTranscriptStats(chunks)

      if (chunkCount === 0 || charCount < MIN_TRANSCRIPT_CHARS) continue

      eligible.push({
        showId,
        sessionId: sessionDoc.id,
        title: sessionTitle(data),
        chunkCount,
        charCount,
      })
    }
  }

  eligible.sort((a, b) => a.showId.localeCompare(b.showId) || a.sessionId.localeCompare(b.sessionId))
  return eligible
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_USD_PER_M + (outputTokens / 1_000_000) * OUTPUT_USD_PER_M
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item !== undefined) await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
}

function failureLabel(reason: RunSummarizeFailureReason): string {
  switch (reason) {
    case 'insufficient_content':
      return 'skipped-insufficient'
    case 'no_transcripts':
      return 'skipped-no-transcripts'
    default:
      return `failed-${reason}`
  }
}

async function main() {
  const { execute, concurrency } = parseArgs(process.argv.slice(2))

  if (!admin.apps.length) {
    admin.initializeApp()
  }
  const firestore = admin.firestore()

  console.log('=== Summary backfill ===')
  console.log(`Mode: ${execute ? 'EXECUTE (Claude calls + Firestore writes)' : 'DRY RUN (read-only)'}`)
  if (execute && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required for --execute mode')
  }

  const eligible = await loadEligibleSessions(firestore)
  const totalChars = eligible.reduce((sum, row) => sum + row.charCount, 0)
  const estimatedInputTokens = Math.round(totalChars / 4)

  console.log('')
  console.log(`Eligible sessions: ${eligible.length}`)
  console.log(`Total transcript chars (eligible): ${totalChars.toLocaleString()}`)
  console.log(`Rough input token proxy (chars / 4): ~${estimatedInputTokens.toLocaleString()}`)
  console.log('')

  if (eligible.length === 0) {
    console.log('Nothing to do.')
    return
  }

  console.log('Per session:')
  console.log('showId\tsessionId\tchunks\tchars\ttitle')
  for (const row of eligible) {
    console.log(
      `${row.showId}\t${row.sessionId}\t${row.chunkCount}\t${row.charCount}\t${row.title}`,
    )
  }

  if (!execute) {
    console.log('')
    console.log('Dry run complete — no Claude calls, no writes.')
    console.log('To run for real: npx tsx functions/src/scripts/backfill-summaries.ts --execute')
    return
  }

  console.log('')
  console.log(`Starting execute with concurrency=${concurrency} …`)
  console.log('')

  let succeeded = 0
  let failed = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0

  await runWithConcurrency(eligible, concurrency, async (row) => {
    const result = await runSummarizeForSession(row.showId, row.sessionId, {
      triggeredBy: 'system:backfill',
      source: 'backfill',
    })

    if (result.ok) {
      succeeded += 1
      const inTok = result.usage?.inputTokens ?? 0
      const outTok = result.usage?.outputTokens ?? 0
      totalInputTokens += inTok
      totalOutputTokens += outTok
      console.log(
        `[success] ${row.showId}/${row.sessionId}  ${row.title}  (in: ${inTok} out: ${outTok} tokens)`,
      )
    } else {
      failed += 1
      console.log(
        `[${failureLabel(result.reason)}] ${row.showId}/${row.sessionId}  ${row.title}  (${result.reason})`,
      )
    }
  })

  const actualCost = estimateCost(totalInputTokens, totalOutputTokens)

  console.log('')
  console.log('=== Execute complete ===')
  console.log(`Succeeded: ${succeeded}`)
  console.log(`Failed/skipped: ${failed}`)
  console.log(`Total input tokens: ${totalInputTokens.toLocaleString()}`)
  console.log(`Total output tokens: ${totalOutputTokens.toLocaleString()}`)
  console.log(
    `Actual API cost (claude-opus-4-5 @ $${INPUT_USD_PER_M}/M in, $${OUTPUT_USD_PER_M}/M out): ${formatUsd(actualCost)}`,
  )
  console.log('')
  console.log(
    'Resume-safe: re-running skips sessions that now have a valid aiSummary (eligibility filter).',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
