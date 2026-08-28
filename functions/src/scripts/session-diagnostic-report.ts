/**
 * Session diagnostic report — READ-ONLY, always.
 *
 * Produces a CSV for every non-AV-test session with lifecycle/transcript/summary
 * diagnosis. Never writes to Firestore, RTDB, Storage, or external systems
 * (except read-only GETs to Recall and Cloud Logging).
 *
 * Usage (from repo root):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/cre8ion-onda-sa.json \
 *   FIREBASE_PROJECT_ID=cre8ion-onda \
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://cre8ion-onda-default-rtdb.firebaseio.com \
 *   FIREBASE_STORAGE_BUCKET=cre8ion-onda.firebasestorage.app \
 *   RECALL_API_KEY=... \
 *   npx tsx functions/src/scripts/session-diagnostic-report.ts
 *
 * Optional:
 *   --output=reports/session-diagnostic.csv   (default: reports/session-diagnostic-<timestamp>.csv)
 *   --skip-logging                            (skip Cloud Logging API — faster, less complete)
 *   --skip-recall                             (skip Recall GET lookups)
 *   --log-since-days=90                       (logging window, default 90)
 *   --show-id=<showId>                        (limit to one show)
 */

import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Firestore, Timestamp } from 'firebase-admin/firestore'
import { getScriptDatabase, getScriptFirestore, getScriptProjectId, getScriptStorage } from './adminInit'
import { isAvTestSession, parseAiSummary } from './backfillFilters'
import {
  CSV_HEADERS,
  applyDiagnosis,
  buildDiagnosticRow,
  csvEscape,
} from './sessionDiagnosticDiagnosis'
import { fetchLogsBySessionId } from './sessionDiagnosticLogging'
import { lookupRecallRecording } from './sessionDiagnosticRecall'
import type {
  AuditEntry,
  SessionDiagnosticRow,
  SessionEvalInput,
  TranscriptStats,
} from './sessionDiagnosticTypes'

type SessionDocLike = {
  title?: string
  friendlyName?: string
  feedState?: string
  isDraft?: boolean
  recordingId?: string
  audioStoragePath?: string
  aiSummary?: string
  aiSummaryTriggeredBy?: string
  reviewState?: { status?: string }
  scheduledStart?: Timestamp
}

function parseArgs(argv: string[]) {
  let outputPath: string | null = null
  let skipLogging = false
  let skipRecall = false
  let logSinceDays = 90
  let onlyShowId: string | null = null

  for (const arg of argv) {
    const outputMatch = arg.match(/^--output=(.+)$/)
    if (outputMatch) outputPath = outputMatch[1]

    if (arg === '--skip-logging') skipLogging = true
    if (arg === '--skip-recall') skipRecall = true

    const daysMatch = arg.match(/^--log-since-days=(\d+)$/)
    if (daysMatch) logSinceDays = Math.max(1, Number(daysMatch[1]))

    const showMatch = arg.match(/^--show-id=(.+)$/)
    if (showMatch) onlyShowId = showMatch[1]
  }

  if (!outputPath) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    outputPath = join('reports', `session-diagnostic-${stamp}.csv`)
  }

  return { outputPath, skipLogging, skipRecall, logSinceDays, onlyShowId }
}

function sessionTitle(data: SessionDocLike): string {
  return (data.friendlyName || data.title || '(untitled)').trim()
}

function timestampToDate(value: unknown): Date | null {
  if (!value) return null
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as Timestamp).toDate()
  }
  return null
}

async function loadAuditForSession(
  firestore: Firestore,
  sessionId: string,
): Promise<AuditEntry[]> {
  const snap = await firestore
    .collection('auditLog')
    .where('sessionId', '==', sessionId)
    .orderBy('performedAt', 'desc')
    .get()

  return snap.docs.map((doc) => {
    const data = doc.data()
    return {
      action: typeof data.action === 'string' ? data.action : 'unknown',
      performedAt: timestampToDate(data.performedAt),
      performedBy: typeof data.performedBy === 'string' ? data.performedBy : '',
      metadata: (data.metadata as Record<string, unknown>) ?? {},
    }
  })
}

async function loadTranscriptStats(
  firestore: Firestore,
  showId: string,
  sessionId: string,
): Promise<TranscriptStats> {
  const snap = await firestore
    .collection(`shows/${showId}/sessions/${sessionId}/transcripts`)
    .get()

  let charSum = 0
  const seqs: number[] = []

  for (const doc of snap.docs) {
    const data = doc.data()
    const text = typeof data.text === 'string' ? data.text.trim() : ''
    charSum += text.length
    seqs.push(typeof data.sequenceNumber === 'number' ? data.sequenceNumber : 0)
  }

  seqs.sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < seqs.length; i++) {
    const prev = seqs[i - 1]
    const cur = seqs[i]
    if (cur > prev + 1) {
      for (let missing = prev + 1; missing < cur; missing++) gaps.push(missing)
    }
  }

  return { count: snap.size, charSum, sequenceGaps: gaps }
}

async function loadRtdbState(sessionId: string): Promise<SessionEvalInput['rtdb']> {
  const db = getScriptDatabase()
  if (!db) {
    return { exists: false, feedState: null, chunkCount: 0 }
  }

  const liveSnap = await db.ref(`liveSessions/${sessionId}`).get()
  if (!liveSnap.exists()) {
    return { exists: false, feedState: null, chunkCount: 0 }
  }

  const val = liveSnap.val() as { feedState?: string } | null
  const chunksSnap = await db.ref(`liveSessions/${sessionId}/chunks`).get()
  const chunksVal = chunksSnap.val() as Record<string, unknown> | null
  const chunkCount = chunksVal ? Object.keys(chunksVal).length : 0

  return {
    exists: true,
    feedState: typeof val?.feedState === 'string' ? val.feedState : null,
    chunkCount,
  }
}

async function checkAudioExists(storagePath: string | null): Promise<boolean | null> {
  if (!storagePath) return null
  try {
    const bucket = getScriptStorage().bucket()
    const [exists] = await bucket.file(storagePath).exists()
    return exists
  } catch {
    return null
  }
}

type SessionRef = { showId: string; sessionId: string; data: SessionDocLike }

async function loadAllSessions(
  firestore: Firestore,
  onlyShowId: string | null,
): Promise<SessionRef[]> {
  const sessions: SessionRef[] = []
  let showDocs

  if (onlyShowId) {
    const one = await firestore.doc(`shows/${onlyShowId}`).get()
    showDocs = one.exists ? [one] : []
  } else {
    showDocs = (await firestore.collection('shows').get()).docs
  }

  for (const showDoc of showDocs) {
    const showId = showDoc.id
    const sessionsSnap = await firestore.collection(`shows/${showId}/sessions`).get()
    for (const sessionDoc of sessionsSnap.docs) {
      const data = sessionDoc.data() as SessionDocLike
      if (isAvTestSession({ title: data.title ?? '', friendlyName: data.friendlyName })) {
        continue
      }
      sessions.push({ showId, sessionId: sessionDoc.id, data })
    }
  }

  sessions.sort(
    (a, b) =>
      a.showId.localeCompare(b.showId) || a.sessionId.localeCompare(b.sessionId),
  )
  return sessions
}

function rowsToCsv(rows: SessionDiagnosticRow[]): string {
  const header = CSV_HEADERS.join(',')
  const lines = rows.map((row) =>
    CSV_HEADERS.map((key) => csvEscape(row[key] as string | number | boolean)).join(','),
  )
  return [header, ...lines].join('\n') + '\n'
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const firestore = getScriptFirestore()
  const projectId = getScriptProjectId()

  console.log('=== Session diagnostic report ===')
  console.log('Mode: READ-ONLY (always — no writes, no execute flag)')
  console.log(`Project: ${projectId}`)
  console.log(`Output: ${args.outputPath}`)
  console.log(`Cloud Logging: ${args.skipLogging ? 'SKIPPED' : `enabled (${args.logSinceDays}d window, bulk scan)`}`)
  console.log(`Recall API: ${args.skipRecall ? 'SKIPPED' : 'enabled (150ms delay between lookups)'}`)
  console.log('')

  const sessionRefs = await loadAllSessions(firestore, args.onlyShowId)
  console.log(`Sessions to analyze (non-AV-test): ${sessionRefs.length}`)

  if (sessionRefs.length === 0) {
    console.log('Nothing to report.')
    return
  }

  const sessionIdSet = new Set(sessionRefs.map((s) => s.sessionId))
  const logsBySession = await fetchLogsBySessionId({
    projectId,
    sessionIds: sessionIdSet,
    sinceDays: args.logSinceDays,
    skip: args.skipLogging,
  })

  const rows: SessionDiagnosticRow[] = []
  let processed = 0

  for (const ref of sessionRefs) {
    processed += 1
    if (processed % 10 === 0 || processed === sessionRefs.length) {
      console.log(`  Processing ${processed}/${sessionRefs.length}…`)
    }

    const { showId, sessionId, data } = ref
    const audit = await loadAuditForSession(firestore, sessionId)
    const transcripts = await loadTranscriptStats(firestore, showId, sessionId)
    const rtdb = await loadRtdbState(sessionId)
    const audioStoragePath =
      typeof data.audioStoragePath === 'string' ? data.audioStoragePath : null
    const audioExists = await checkAudioExists(audioStoragePath)
    const recordingId = typeof data.recordingId === 'string' ? data.recordingId : null

    const recall = recordingId
      ? await lookupRecallRecording(recordingId, { skip: args.skipRecall })
      : {
          attempted: false,
          skippedReason: 'no recordingId',
          status: null,
          transcriptUrlAvailable: false,
          error: null,
        }

    const logs = logsBySession.get(sessionId) ?? {
      fetched: false,
      skipReason: 'not indexed',
      onSessionEndNoShowId: false,
      onSessionEndMigrationFailed: false,
      onSessionEndNoChunks: false,
      autoSummarizeFailed: false,
      autoSummarizeInsufficient: false,
      webhookChunkWrites: 0,
      recallWebhookFailures: 0,
      recordingIndexMiss: false,
      audioRetrieveFailed: false,
      summarizeFailed: false,
      deeplTranslationFailures: 0,
      sampleMessages: [],
    }

    const evalInput: SessionEvalInput = {
      showId,
      sessionId,
      title: sessionTitle(data),
      isDraft: data.isDraft === true,
      feedState: typeof data.feedState === 'string' ? data.feedState : 'standby',
      reviewStatus:
        typeof data.reviewState?.status === 'string' ? data.reviewState.status : '',
      scheduledStart: timestampToDate(data.scheduledStart),
      recordingId,
      audioStoragePath,
      audioExists,
      aiSummaryValid: parseAiSummary(data.aiSummary).ok,
      aiSummaryTriggeredBy:
        typeof data.aiSummaryTriggeredBy === 'string' ? data.aiSummaryTriggeredBy : null,
      audit,
      transcripts,
      rtdb,
      recall,
      logs,
    }

    const diagnosis = applyDiagnosis(evalInput)
    rows.push(buildDiagnosticRow(evalInput, diagnosis))
  }

  mkdirSync(dirname(args.outputPath), { recursive: true })
  writeFileSync(args.outputPath, rowsToCsv(rows), 'utf8')

  const byCode = new Map<string, number>()
  for (const row of rows) {
    byCode.set(row.diagnosisCode, (byCode.get(row.diagnosisCode) ?? 0) + 1)
  }

  console.log('')
  console.log('=== Report complete ===')
  console.log(`Wrote ${rows.length} rows → ${args.outputPath}`)
  console.log('')
  console.log('Diagnosis summary:')
  for (const [code, count] of [...byCode.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code}: ${count}`)
  }
  const manualCount = rows.filter((r) => r.needsManualCheck).length
  console.log('')
  console.log(`Sessions needing manual check: ${manualCount}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
