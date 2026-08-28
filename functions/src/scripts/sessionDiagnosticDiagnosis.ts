import { MIN_TRANSCRIPT_CHARS } from './backfillFilters'
import type {
  AuditEntry,
  DiagnosisCode,
  SessionDiagnosticRow,
  SessionEvalInput,
} from './sessionDiagnosticTypes'

const DIAGNOSIS_MESSAGES: Record<DiagnosisCode, string> = {
  NEVER_STARTED:
    'Session was created but sound check never ran. No recording was attempted.',
  DRAFT_ONLY: 'Session remained a draft and was never taken through the live pipeline.',
  RECORDING_NEVER_BOUND:
    'Sound check started but no recordingId was bound and no transcript chunks were captured.',
  NO_TRANSCRIPT_INGRESS:
    'Session went live but no transcript chunks were captured. Webhook forwarding or Recall transcript delivery likely failed.',
  STUCK_STOPPING:
    'Operator ended the session but Recall sdk_upload.complete was never processed. Chunks may still be in RTDB.',
  AUDIO_RETRIEVE_FAILED:
    'Recall completed but server-side audio retrieve/store failed; session was intentionally not marked ended.',
  BIND_INDEX_MISS:
    'Recall sdk_upload.complete could not resolve session — bind-recording likely failed or never ran.',
  MIGRATION_EMPTY:
    'Session ended but RTDB had no chunks at migration time, so no Firestore transcripts were written.',
  MIGRATION_ABORTED:
    'Session ended but onSessionEnd migration did not complete; RTDB orphan may still hold chunks.',
  ADMIN_RESET_WIPED:
    'Admin reset deleted in-flight RTDB data before migration; transcripts may have been lost.',
  LEGACY_FORCE_END:
    'Session was forced to ended without a normal sound-check → live → stop trail (possible legacy Go Live control).',
  INSUFFICIENT_CONTENT:
    'Transcript exists but is below the 200-character summarization threshold.',
  SUMMARIZE_FAILED:
    'Enough transcript content exists but Claude summarization failed or was never recorded in auditLog.',
  SUMMARIZE_NEVER_ATTEMPTED:
    'Session ended with sufficient transcript content but auto-summarize does not appear to have run.',
  RECOVERABLE_FROM_RECALL:
    'No Firestore transcript, but Recall exposes a transcript download URL that could be imported manually.',
  HEALTHY_NEEDS_SUMMARY:
    'Session ended with sufficient transcript content and no detected errors — eligible for summary backfill.',
  COMPLETE: 'Session has a valid AI summary.',
  UNKNOWN: 'Automated sources did not match a known failure pattern.',
}

function auditByAction(audit: AuditEntry[], action: string): AuditEntry | undefined {
  return audit.find((e) => e.action === action)
}

function latestAudit(audit: AuditEntry[], action: string): AuditEntry | undefined {
  const matches = audit.filter((e) => e.action === action)
  if (matches.length === 0) return undefined
  return matches.sort((a, b) => (b.performedAt?.getTime() ?? 0) - (a.performedAt?.getTime() ?? 0))[0]
}

function formatDate(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

function hasSoundCheck(audit: AuditEntry[]): boolean {
  return audit.some((e) => e.action === 'SESSION_SOUND_CHECK_STARTED')
}

function hasGoLive(audit: AuditEntry[]): boolean {
  return audit.some((e) => e.action === 'SESSION_FEED_GO_LIVE')
}

function stoppedEntry(audit: AuditEntry[]): AuditEntry | undefined {
  return latestAudit(audit, 'SESSION_FEED_STOPPED')
}

function resetEntry(audit: AuditEntry[]): AuditEntry | undefined {
  return latestAudit(audit, 'SESSION_FEED_RESET')
}

function summaryEntry(audit: AuditEntry[]): AuditEntry | undefined {
  return latestAudit(audit, 'SUMMARY_TRIGGERED')
}

function migratedChunkCount(audit: AuditEntry[]): number | null {
  const stop = stoppedEntry(audit)
  if (!stop) return null
  const raw = stop.metadata?.chunkCount
  return typeof raw === 'number' ? raw : null
}

function cfErrorSummary(logs: SessionEvalInput['logs']): string {
  const parts: string[] = []
  if (logs.onSessionEndNoShowId) parts.push('onSessionEnd:no_showId')
  if (logs.onSessionEndMigrationFailed) parts.push('onSessionEnd:migration_failed')
  if (logs.onSessionEndNoChunks) parts.push('onSessionEnd:no_chunks')
  if (logs.autoSummarizeFailed) parts.push('auto_summarize_failed')
  if (logs.recordingIndexMiss) parts.push('recording_index_miss')
  if (logs.audioRetrieveFailed) parts.push('audio_retrieve_failed')
  if (logs.summarizeFailed) parts.push('summarize_failed')
  return parts.join('; ')
}

export function applyDiagnosis(input: SessionEvalInput): {
  code: DiagnosisCode
  needsManualCheck: boolean
  manualCheckNotes: string
} {
  const {
    isDraft,
    feedState,
    recordingId,
    audioStoragePath,
    aiSummaryValid,
    audit,
    transcripts,
    rtdb,
    recall,
    logs,
  } = input

  const soundCheck = hasSoundCheck(audit)
  const goLive = hasGoLive(audit)
  const stop = stoppedEntry(audit)
  const reset = resetEntry(audit)
  const summary = summaryEntry(audit)
  const migratedCount = migratedChunkCount(audit)

  const manualNotes: string[] = []
  let needsManualCheck = false

  // 1. DRAFT_ONLY (before NEVER_STARTED — draft is more specific than idle standby)
  if (isDraft) {
    return finish('DRAFT_ONLY', false, '')
  }

  // 2. NEVER_STARTED
  if (!soundCheck && feedState === 'standby') {
    return finish('NEVER_STARTED', false, '')
  }

  // 3. RECORDING_NEVER_BOUND
  if (
    soundCheck &&
    !recordingId &&
    transcripts.count === 0 &&
    rtdb.chunkCount === 0
  ) {
    return finish('RECORDING_NEVER_BOUND', true, 'Confirm bind-recording ran after sdk_upload in Operator logs.')
  }

  // 4. NO_TRANSCRIPT_INGRESS
  if (
    goLive &&
    transcripts.count === 0 &&
    (migratedCount === 0 || migratedCount === null) &&
    logs.webhookChunkWrites === 0 &&
    !rtdb.exists
  ) {
    return finish(
      'NO_TRANSCRIPT_INGRESS',
      true,
      'Check Electron Operator diagnostics for webhook forward failures and RECALL_WEBHOOK_SECRET configuration.',
    )
  }

  // 5. STUCK_STOPPING
  if (feedState === 'stopping' && (rtdb.chunkCount > 0 || rtdb.exists)) {
    manualNotes.push(
      `Check Svix dashboard Message Attempts for sdk_upload.complete on recordingId ${recordingId || '(unknown)'}.`,
    )
    manualNotes.push('Check App Hosting logs for [recall/webhook] LOUD FAILURE entries.')
    return finish('STUCK_STOPPING', true, manualNotes.join(' '))
  }

  // 6. AUDIO_RETRIEVE_FAILED
  if (
    (feedState === 'stopping' || logs.audioRetrieveFailed) &&
    (rtdb.chunkCount > 0 || transcripts.count > 0) &&
    !audioStoragePath &&
    logs.audioRetrieveFailed
  ) {
    manualNotes.push(
      'Check Svix Message Attempts and App Hosting logs for recall_audio_* / LOUD FAILURE: audio retrieve/store.',
    )
    return finish('AUDIO_RETRIEVE_FAILED', true, manualNotes.join(' '))
  }

  // 7. BIND_INDEX_MISS
  if (logs.recordingIndexMiss) {
    manualNotes.push(
      'Confirm POST /api/tech/sessions/bind-recording succeeded for this session in Operator logs.',
    )
    return finish('BIND_INDEX_MISS', true, manualNotes.join(' '))
  }

  // 8. MIGRATION_EMPTY
  if (feedState === 'ended' && stop && migratedCount === 0) {
    return finish('MIGRATION_EMPTY', false, '')
  }

  // 9. MIGRATION_ABORTED
  if (
    rtdb.exists &&
    (rtdb.feedState === 'ended' || feedState === 'ended') &&
    !stop
  ) {
    manualNotes.push('Review Cloud Functions logs for onSessionEnd errors (no showId, migration failed).')
    return finish('MIGRATION_ABORTED', true, manualNotes.join(' '))
  }
  if (logs.onSessionEndNoShowId || logs.onSessionEndMigrationFailed) {
    manualNotes.push('Review Cloud Functions onSessionEnd logs for this sessionId.')
    return finish('MIGRATION_ABORTED', true, manualNotes.join(' '))
  }

  // 10. ADMIN_RESET_WIPED
  if (reset && transcripts.count === 0 && !stop) {
    return finish('ADMIN_RESET_WIPED', false, '')
  }

  // 11. LEGACY_FORCE_END
  if (
    feedState === 'ended' &&
    (migratedCount === 0 || migratedCount === null) &&
    !goLive &&
    !soundCheck
  ) {
    manualNotes.push('Check whether legacy GoLiveControl End feed was used (deprecated tech UI).')
    return finish('LEGACY_FORCE_END', true, manualNotes.join(' '))
  }

  // 12. INSUFFICIENT_CONTENT
  if (
    transcripts.count > 0 &&
    transcripts.charSum < MIN_TRANSCRIPT_CHARS &&
    !aiSummaryValid
  ) {
    return finish('INSUFFICIENT_CONTENT', false, '')
  }

  // 13. SUMMARIZE_FAILED
  if (
    transcripts.charSum >= MIN_TRANSCRIPT_CHARS &&
    !aiSummaryValid &&
    !summary &&
    (logs.autoSummarizeFailed || logs.summarizeFailed)
  ) {
    return finish('SUMMARIZE_FAILED', false, '')
  }

  // 14. SUMMARIZE_NEVER_ATTEMPTED
  if (
    feedState === 'ended' &&
    transcripts.charSum >= MIN_TRANSCRIPT_CHARS &&
    !aiSummaryValid &&
    !summary &&
    !logs.autoSummarizeInsufficient
  ) {
    return finish('SUMMARIZE_NEVER_ATTEMPTED', false, '')
  }

  // 15. RECOVERABLE_FROM_RECALL
  if (transcripts.count === 0 && recall.transcriptUrlAvailable) {
    manualNotes.push(
      'Recall transcript URL is available — manual import is possible via GET /api/recall/recordings/{recordingId}.',
    )
    return finish('RECOVERABLE_FROM_RECALL', true, manualNotes.join(' '))
  }

  // 16. HEALTHY_NEEDS_SUMMARY
  if (
    feedState === 'ended' &&
    transcripts.charSum >= MIN_TRANSCRIPT_CHARS &&
    !aiSummaryValid
  ) {
    return finish('HEALTHY_NEEDS_SUMMARY', false, '')
  }

  // 17. COMPLETE
  if (aiSummaryValid) {
    return finish('COMPLETE', false, '')
  }

  needsManualCheck = true
  manualNotes.push('No taxonomy rule matched — review raw columns and platform logs manually.')
  return finish('UNKNOWN', needsManualCheck, manualNotes.join(' '))

  function finish(
    code: DiagnosisCode,
    manual: boolean,
    notes: string,
  ): { code: DiagnosisCode; needsManualCheck: boolean; manualCheckNotes: string } {
    return { code, needsManualCheck: manual, manualCheckNotes: notes }
  }
}

export function buildDiagnosticRow(
  input: SessionEvalInput,
  diagnosis: ReturnType<typeof applyDiagnosis>,
): SessionDiagnosticRow {
  const stop = stoppedEntry(input.audit)
  const reset = resetEntry(input.audit)
  const sound = auditByAction(input.audit, 'SESSION_SOUND_CHECK_STARTED')
  const live = auditByAction(input.audit, 'SESSION_FEED_GO_LIVE')
  const summary = summaryEntry(input.audit)
  const migratedCount = migratedChunkCount(input.audit)

  const recallStop = reset?.metadata?.recallStop as Record<string, unknown> | undefined

  return {
    showId: input.showId,
    sessionId: input.sessionId,
    title: input.title,
    isAvTest: false,
    isDraft: input.isDraft,
    feedState: input.feedState,
    reviewStatus: input.reviewStatus,
    scheduledStart: formatDate(input.scheduledStart),
    soundCheckAt: formatDate(sound?.performedAt),
    wentLiveAt: formatDate(live?.performedAt),
    stoppedAt: formatDate(stop?.performedAt),
    migratedChunkCount: migratedCount === null ? '' : String(migratedCount),
    wasReset: Boolean(reset),
    resetPreviousState:
      typeof reset?.metadata?.previousFeedState === 'string'
        ? reset.metadata.previousFeedState
        : '',
    resetRecallProbe: recallStop ? JSON.stringify(recallStop) : '',
    firestoreTranscriptCount: input.transcripts.count,
    firestoreTranscriptChars: input.transcripts.charSum,
    sequenceGaps:
      input.transcripts.sequenceGaps.length > 0
        ? input.transcripts.sequenceGaps.slice(0, 20).join(',')
        : '',
    rtdbNodeExists: input.rtdb.exists,
    rtdbFeedState: input.rtdb.feedState ?? '',
    rtdbChunkCount: input.rtdb.chunkCount,
    recordingId: input.recordingId ?? '',
    audioStoragePath: input.audioStoragePath ?? '',
    audioExists:
      input.audioExists === null
        ? ''
        : input.audioExists
          ? 'yes'
          : 'no',
    recallRecordingStatus: input.recall.status ?? '',
    recallTranscriptUrlAvailable: input.recall.transcriptUrlAvailable,
    hasAiSummary: input.aiSummaryValid,
    aiSummaryTriggeredBy: input.aiSummaryTriggeredBy ?? '',
    summaryTriggeredAt: formatDate(summary?.performedAt),
    summarySource:
      typeof summary?.metadata?.source === 'string' ? summary.metadata.source : '',
    cfMigrationErrors: cfErrorSummary(input.logs),
    webhookChunkWrites: input.logs.webhookChunkWrites,
    deeplFailures: input.logs.deeplTranslationFailures,
    svixCompleteDelivered: '',
    diagnosisCode: diagnosis.code,
    diagnosis: DIAGNOSIS_MESSAGES[diagnosis.code],
    needsManualCheck: diagnosis.needsManualCheck,
    manualCheckNotes: diagnosis.manualCheckNotes,
  }
}

export function csvEscape(value: string | number | boolean): string {
  const s = String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export const CSV_HEADERS: (keyof SessionDiagnosticRow)[] = [
  'showId',
  'sessionId',
  'title',
  'isAvTest',
  'isDraft',
  'feedState',
  'reviewStatus',
  'scheduledStart',
  'soundCheckAt',
  'wentLiveAt',
  'stoppedAt',
  'migratedChunkCount',
  'wasReset',
  'resetPreviousState',
  'resetRecallProbe',
  'firestoreTranscriptCount',
  'firestoreTranscriptChars',
  'sequenceGaps',
  'rtdbNodeExists',
  'rtdbFeedState',
  'rtdbChunkCount',
  'recordingId',
  'audioStoragePath',
  'audioExists',
  'recallRecordingStatus',
  'recallTranscriptUrlAvailable',
  'hasAiSummary',
  'aiSummaryTriggeredBy',
  'summaryTriggeredAt',
  'summarySource',
  'cfMigrationErrors',
  'webhookChunkWrites',
  'deeplFailures',
  'svixCompleteDelivered',
  'diagnosisCode',
  'diagnosis',
  'needsManualCheck',
  'manualCheckNotes',
]
