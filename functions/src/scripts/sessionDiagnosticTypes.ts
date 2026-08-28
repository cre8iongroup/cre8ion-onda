/** Audit action types referenced by the diagnostic report. */
export type AuditActionType =
  | 'SESSION_SOUND_CHECK_STARTED'
  | 'SESSION_FEED_GO_LIVE'
  | 'SESSION_FEED_STOPPED'
  | 'SESSION_FEED_RESET'
  | 'SUMMARY_TRIGGERED'
  | string

export type AuditEntry = {
  action: AuditActionType
  performedAt: Date | null
  performedBy: string
  metadata: Record<string, unknown>
}

export type TranscriptStats = {
  count: number
  charSum: number
  sequenceGaps: number[]
}

export type RtdbLiveState = {
  exists: boolean
  feedState: string | null
  chunkCount: number
}

export type RecallLookup = {
  attempted: boolean
  skippedReason: string | null
  status: string | null
  transcriptUrlAvailable: boolean
  error: string | null
}

export type LogFlags = {
  fetched: boolean
  skipReason: string | null
  onSessionEndNoShowId: boolean
  onSessionEndMigrationFailed: boolean
  onSessionEndNoChunks: boolean
  autoSummarizeFailed: boolean
  autoSummarizeInsufficient: boolean
  webhookChunkWrites: number
  recallWebhookFailures: number
  recordingIndexMiss: boolean
  audioRetrieveFailed: boolean
  summarizeFailed: boolean
  deeplTranslationFailures: number
  sampleMessages: string[]
}

export type DiagnosisCode =
  | 'NEVER_STARTED'
  | 'DRAFT_ONLY'
  | 'RECORDING_NEVER_BOUND'
  | 'NO_TRANSCRIPT_INGRESS'
  | 'STUCK_STOPPING'
  | 'AUDIO_RETRIEVE_FAILED'
  | 'BIND_INDEX_MISS'
  | 'MIGRATION_EMPTY'
  | 'MIGRATION_ABORTED'
  | 'ADMIN_RESET_WIPED'
  | 'LEGACY_FORCE_END'
  | 'INSUFFICIENT_CONTENT'
  | 'SUMMARIZE_FAILED'
  | 'SUMMARIZE_NEVER_ATTEMPTED'
  | 'RECOVERABLE_FROM_RECALL'
  | 'HEALTHY_NEEDS_SUMMARY'
  | 'COMPLETE'
  | 'UNKNOWN'

export type SessionDiagnosticRow = {
  showId: string
  sessionId: string
  title: string
  isAvTest: false
  isDraft: boolean
  feedState: string
  reviewStatus: string
  scheduledStart: string
  soundCheckAt: string
  wentLiveAt: string
  stoppedAt: string
  migratedChunkCount: string
  wasReset: boolean
  resetPreviousState: string
  resetRecallProbe: string
  firestoreTranscriptCount: number
  firestoreTranscriptChars: number
  sequenceGaps: string
  rtdbNodeExists: boolean
  rtdbFeedState: string
  rtdbChunkCount: number
  recordingId: string
  audioStoragePath: string
  audioExists: string
  recallRecordingStatus: string
  recallTranscriptUrlAvailable: boolean
  hasAiSummary: boolean
  aiSummaryTriggeredBy: string
  summaryTriggeredAt: string
  summarySource: string
  cfMigrationErrors: string
  webhookChunkWrites: number
  deeplFailures: number
  svixCompleteDelivered: string
  diagnosisCode: DiagnosisCode
  diagnosis: string
  needsManualCheck: boolean
  manualCheckNotes: string
}

export type SessionEvalInput = {
  showId: string
  sessionId: string
  title: string
  isDraft: boolean
  feedState: string
  reviewStatus: string
  scheduledStart: Date | null
  recordingId: string | null
  audioStoragePath: string | null
  audioExists: boolean | null
  aiSummaryValid: boolean
  aiSummaryTriggeredBy: string | null
  audit: AuditEntry[]
  transcripts: TranscriptStats
  rtdb: RtdbLiveState
  recall: RecallLookup
  logs: LogFlags
}
