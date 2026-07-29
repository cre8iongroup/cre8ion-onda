import { Timestamp } from 'firebase/firestore'

// ─────────────────────────────────────────────
// Permissions & Roles
// ─────────────────────────────────────────────

export type BaseRole = 'admin' | 'editor' | 'tech' | 'reviewer'

export interface Capabilities {
  canCreateShows: boolean
  canEditShows: boolean
  canManageUsers: boolean
  canAccessTechPanel: boolean
  canControlLiveFeed: boolean
  canViewPrivatePreview: boolean
  canApproveTranscripts: boolean
  canPublishSessions: boolean
  canExportTranscripts: boolean
  canManageBranding: boolean
  canManageOutputLayouts: boolean
}

export type CustomPermissions = Partial<Capabilities>

// ─────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────

export interface UserDoc {
  email: string
  displayName: string
  baseRole: BaseRole
  customPermissions: CustomPermissions
  assignedShows: string[]   // showIds — empty = all shows (admin only)
  lastLoginAt?: Timestamp
  createdAt: Timestamp
  createdBy: string         // userId
}

// ─────────────────────────────────────────────
// Glossary
// ─────────────────────────────────────────────

export interface GlossaryEntry {
  term: string
  translations: {
    es?: string
    pt?: string
    fr?: string
  }
  deepLGlossaryId?: string  // populated after DeepL sync
}

// ─────────────────────────────────────────────
// Branding
// ─────────────────────────────────────────────

export type EndSessionBehavior = 'message' | 'showTranscript' | 'redirect' | 'brandedEndCard'

export interface ShowBranding {
  primaryColor: string        // hex
  secondaryColor: string      // hex
  logoURL: string             // Firebase Storage URL
  endSessionBehavior: EndSessionBehavior
  endSessionMessage?: string
  redirectURL?: string        // required if endSessionBehavior === 'redirect'
  portalURL: string           // slug for /portal/[slug] and v2 domain routing
}

// ─────────────────────────────────────────────
// Shows
// ─────────────────────────────────────────────

export interface ShowDoc {
  name: string
  clientName: string
  startDate: Timestamp
  endDate: Timestamp
  glossary: GlossaryEntry[]
  // Registered DeepL glossary IDs per language pair key (e.g. 'en-es', 'en-pt')
  deepLGlossaryIds?: Record<string, string>
  branding: ShowBranding
  defaultLanguages: string[]  // e.g. ['en', 'es', 'pt', 'fr']
  portalPublished: boolean
  /**
   * Per-show room catalog for session placement + Onda Operator room select.
   * Empty/missing until an admin adds rooms; session create is blocked when empty.
   */
  rooms?: ShowRoom[]
  /**
   * Shared Onda Operator / Electron unlock password for this show (v1).
   * Auth email is derived as tech+{portalSlug}@onda.tech — see lib/tech/credentials.ts.
   * Prefer setting via Admin UI so the matching Auth user is provisioned.
   * Validated server-side via Admin SDK — never returned to clients after unlock.
   */
  techCredential?: string
  archivedAt?: Timestamp
  createdAt: Timestamp
  createdBy: string
}

/** Show-scoped physical room (Admin-managed; Operator read-only). */
export interface ShowRoom {
  id: string
  name: string
}

// ─────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────

/**
 * Live-session machine for Onda Operator / Attendee / Admin labels.
 * One-way: standby → testing → live → stopping → ended.
 * UI may label `testing` as "Sound check" in Operator — enum value stays `testing`.
 */
export type FeedState = 'standby' | 'testing' | 'live' | 'stopping' | 'ended'

export interface ApprovalState {
  reviewedBy?: string
  reviewedAt?: Timestamp
  approvedBy?: string
  approvedAt?: Timestamp
  notes?: string
  flagged?: boolean
}

export interface SessionDoc {
  title: string
  /** References ShowDoc.rooms[].id — required; free-text location removed. */
  roomId: string
  friendlyName: string      // branded e.g. "Main Stage"
  scheduledStart: Timestamp
  scheduledEnd: Timestamp
  languages: string[]
  glossaryOverride?: GlossaryEntry[]
  /**
   * Admin visibility gate. true = hidden from Onda Operator + Attendee PWA.
   * Defaults true on create. Hide blocked while feedState is testing/live/stopping.
   */
  isDraft: boolean
  feedState: FeedState
  approvalState: ApprovalState
  aiSummary?: string        // Markdown from Claude
  aiSummaryGeneratedAt?: Timestamp
  aiSummaryTriggeredBy?: string
  publishedAt?: Timestamp
  outputLayoutTemplateId?: string
  /**
   * Recall recording id bound at start / written again on sdk_upload.complete.
   * Used with recordingIndex and server-side audio retrieve.
   */
  recordingId?: string
  /**
   * Firebase Storage object path for the mixed session audio uploaded by the
   * workspace Svix webhook after verified `sdk_upload.complete`.
   * Canonical form: `shows/{showId}/sessions/{sessionId}/audio/{recordingId}.mp3`
   * Review panel should read this field to locate the file — do not invent paths.
   */
  audioStoragePath?: string
  /** Server timestamp when `audioStoragePath` was written. */
  audioStoredAt?: Timestamp
  createdAt: Timestamp
  createdBy: string
}

// ─────────────────────────────────────────────
// Transcript Chunks (Firestore — permanent)
// ─────────────────────────────────────────────

export interface TranscriptChunk {
  text: string
  speakerLabel?: string       // from Recall.AI diarization — never shown to attendees
  timestamp: Timestamp
  sequenceNumber: number
  translations: {
    es?: string
    pt?: string
    fr?: string
  }
  isFinalized: boolean
  deepLRequestId?: string
}

// ─────────────────────────────────────────────
// Live Feed (Realtime Database — ephemeral)
// ─────────────────────────────────────────────

export interface RTDBChunk {
  text: string
  sequenceNumber: number
  timestamp: number           // Unix ms
  speakerLabel?: string | null
  translations: {
    es?: string
    pt?: string
    fr?: string
  }
  isFinalized: boolean
}

export interface RTDBSession {
  feedState: FeedState
  chunks?: Record<string, RTDBChunk>
}

// ─────────────────────────────────────────────
// Output Layout Templates
// ─────────────────────────────────────────────

export type FontSize = 'small' | 'medium' | 'large' | 'xlarge'
export type BackgroundType = 'black' | 'white' | 'chromaKey' | 'custom'
export type CaptionLayout = 'stacked' | 'sideBySide'

export interface OutputLayoutDoc {
  name: string
  primaryLanguage: string
  secondaryLanguage?: string
  fontSize: FontSize
  backgroundType: BackgroundType
  backgroundColor?: string    // hex — if custom
  layout: CaptionLayout
  textColor: string           // hex
  showSpeakerLabels: boolean
  createdBy: string
  createdAt: Timestamp
}

// ─────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────

export type AuditAction =
  | 'SESSION_SOUND_CHECK_STARTED'
  | 'SESSION_FEED_GO_LIVE'
  | 'SESSION_FEED_PAUSED'
  | 'SESSION_FEED_STOPPED'
  | 'SESSION_APPROVED'
  | 'SESSION_FLAGGED'
  | 'SESSION_PUBLISHED'
  | 'SUMMARY_TRIGGERED'
  | 'GLOSSARY_SYNCED'
  | 'USER_CREATED'
  | 'USER_ROLE_CHANGED'

export interface AuditLogEntry {
  action: AuditAction
  performedBy: string
  performedAt: Timestamp
  showId: string
  sessionId?: string
  metadata: Record<string, unknown>
}

// ─────────────────────────────────────────────
// Recall.AI Webhook Payload
// ─────────────────────────────────────────────

/** Onda-normalized payload (Electron forwarder / Tech bridge). */
export interface RecallWebhookPayload {
  sessionId: string
  text: string
  speaker?: string
  timestamp: number           // Unix ms
  isFinal: boolean
  sequenceNumber?: number
}

/**
 * Native Recall Desktop SDK realtime transcript envelope (transcript.data).
 * When POSTed directly to our webhook, pass sessionId as ?sessionId=.
 */
export interface RecallNativeTranscriptEvent {
  event: 'transcript.data' | 'transcript.partial_data' | string
  data?: {
    data?: {
      words?: Array<{ text?: string; word?: string }>
      participant?: { id?: number | string; name?: string | null }
    }
  }
}

// ─────────────────────────────────────────────
// Claude Summary Output
// ─────────────────────────────────────────────

export interface ClaudeSummary {
  executiveSummary: string
  keyTopics: string[]
  actionItems: string[]
  quotes: Array<{ speaker?: string; text: string }>
}

// ─────────────────────────────────────────────
// Helper — with ID (for list views)
// ─────────────────────────────────────────────

export type WithId<T> = T & { id: string }
