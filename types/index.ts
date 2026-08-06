import { Timestamp } from 'firebase/firestore'

// ─────────────────────────────────────────────
// Permissions & Roles
// ─────────────────────────────────────────────

export type BaseRole = 'admin' | 'editor' | 'contributor' | 'tech' | 'reviewer'

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
  /** Download Room/Session QR codes for assigned shows (Contributor primary cap). */
  canDownloadQr: boolean
  /**
   * Manage Tech access credential + Operator settings on a show.
   * Independent of canEditShows — Editors may lack this unless force-allowed.
   */
  canManageTech: boolean
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
  /**
   * Optional mis-transcription variants Deepgram may emit for this term
   * (e.g. term "ALPFA" → alsoHeardAs ["Alpha", "Alpha Familia"]).
   * Used for English caption text corrections before RTDB write.
   * Not sent to DeepL; not used as Deepgram keyterm prompts.
   */
  alsoHeardAs?: string[]
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

/**
 * Show-level branding.
 *
 * Accent model (Phase 5):
 * - `primaryColor` / `secondaryColor` remain the persisted accent pair for
 *   backward compatibility with existing shows and Operator defaults.
 * - `accentColors` (1–2 entries) is the attendee-facing accent list. When
 *   absent/empty, effective accents are `[primaryColor, secondaryColor]`.
 * - Branding editor keeps them in sync: accentColors[0/1] ↔ primary/secondary.
 * - `backgroundColor` / `textColor` are distinct from accents (not aliases).
 */
export interface ShowBranding {
  primaryColor: string        // hex — accent 1 (legacy + sync source)
  secondaryColor: string      // hex — accent 2 (legacy + sync source)
  /** Attendee accents (1–2). Prefer over primary/secondary when present. */
  accentColors?: string[]
  backgroundColor?: string    // hex — page/surface background
  textColor?: string          // hex — primary body/headline text
  logoURL: string             // Firebase Storage URL
  endSessionBehavior: EndSessionBehavior
  endSessionMessage?: string
  redirectURL?: string        // required if endSessionBehavior === 'redirect'
  /** Public slug for /show/[slug] (legacy /portal/[slug] redirects here). */
  portalURL: string
  /**
   * Optional per-show legal / attribution markdown (e.g. "powered by" + client terms link).
   * Rendered on attendee footers with a restricted markdown subset:
   * paragraphs, bold, italic, links, and line breaks only.
   */
  legalNotice?: string
}

/** Ordered CMS link on the show home page. */
export interface ShowLink {
  title: string
  url: string
  order: number
}

/** Room-level branding override (when inherit is false). */
export interface RoomBranding {
  inherit: boolean
  logoUrl?: string
  backgroundColor?: string
  textColor?: string
  accentColors?: string[]
}

/**
 * Per-window caption output config (Builder + Output Windows).
 * `textColor` omitted → inherit show branding text color at render time.
 * Never persist `undefined` — omit optional fields instead.
 */
export interface OutputWindowConfig {
  language: string | null
  fontSize: number // px
  backgroundColor: string // hex or named (e.g. chroma-key green)
  textColor?: string
}

/** Persisted on the room doc; live mirror lives at RTDB `outputLive/{roomId}`. */
export interface RoomOutputConfig {
  windows: OutputWindowConfig[]
  updatedAt?: Timestamp
  updatedBy?: string
}

/**
 * Full room document at shows/{showId}/rooms/{roomId}.
 * ShowDoc.rooms[] remains a denormalized {id,name}[] for Operator unlock dual-write.
 */
export interface RoomDoc {
  name: string
  branding: RoomBranding
  qrCodeUrl?: string
  /**
   * Live caption output configuration for this room (Output Builder).
   * Independent of outputLayouts presets once applied.
   */
  outputConfig?: RoomOutputConfig
  createdAt: Timestamp
  createdBy: string
}

/** Resolved palette for attendee CSS variables (never includes secrets). */
export interface EffectiveBranding {
  logoUrl: string
  backgroundColor: string
  textColor: string
  accentColors: string[]
}

// ─────────────────────────────────────────────
// Shows
// ─────────────────────────────────────────────

/** Admin-selected Deepgram caption formatting for Onda Operator recording. */
export type TranscriptionStyle = 'standard' | 'lightweight'

/** Backend-only DeepL glossary sync state (Firestore console / CF logs — no admin UI). */
export type GlossarySyncStatus = 'idle' | 'syncing' | 'error'

export interface ShowDoc {
  name: string
  clientName: string
  startDate: Timestamp
  endDate: Timestamp
  glossary: GlossaryEntry[]
  // Registered DeepL glossary IDs per language pair key (e.g. 'en-es', 'en-pt')
  deepLGlossaryIds?: Record<string, string>
  /** Backend troubleshooting only — set by syncDeepLGlossary callable. */
  glossarySyncStatus?: GlossarySyncStatus
  glossarySyncError?: string | null
  glossarySyncedAt?: Timestamp | null
  branding: ShowBranding
  defaultLanguages: string[]  // e.g. ['en', 'es', 'pt', 'fr']
  portalPublished: boolean
  /**
   * IANA timezone for attendee schedule day headers (e.g. "America/New_York").
   * Required on new shows; older docs may lack it until Admin saves once
   * (attendee loaders fall back to "America/New_York").
   */
  showTimezone: string
  /** Admin-editable ordered links on the public show home. */
  links?: ShowLink[]
  /**
   * Denormalized room catalog ({id,name}) for Onda Operator unlock dual-write.
   * Canonical room docs live at shows/{showId}/rooms/{roomId}.
   * Empty/missing until an admin adds rooms; session create is blocked when empty.
   */
  rooms?: ShowRoom[]
  /**
   * Shared Onda Operator / Electron unlock password for this show (v1).
   * Auth email is derived as tech+{portalSlug}@onda.tech — see lib/tech/credentials.ts.
   * Prefer setting via Admin UI so the matching Auth user is provisioned.
   * Validated server-side via Admin SDK — never returned to attendee Route Handlers.
   */
  techCredential?: string
  /**
   * Deepgram streaming style for live captions (Operator recording-start).
   * Maps to presets in lib/recall/deepgramStreamingPresets — see
   * TRANSCRIPTION_STYLE_TO_PRESET. Required on new shows; older docs may
   * lack it until Admin saves once (unlock falls back to 'standard').
   */
  transcriptionStyle: TranscriptionStyle
  /**
   * Optional denormalized Deepgram keyterm list. Prefer deriving at Operator
   * unlock from glossary[].term (see deepgramKeytermsFromGlossary). Kept for
   * backward compatibility; Admin no longer edits this field directly.
   */
  deepgramKeyterms?: string[]
  /**
   * Admin-authored markdown shown read-only in Onda Operator under Input/Network.
   * Empty/missing → Operator hides the block.
   */
  operatorInstructions?: string
  archivedAt?: Timestamp
  createdAt: Timestamp
  createdBy: string
}

/** Denormalized room entry on ShowDoc.rooms[] (Operator unlock compatibility). */
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
  /** References shows/{showId}/rooms/{roomId} (and denormalized ShowDoc.rooms[].id). */
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
  /** Public download URL for the session QR (PNG preferred when both exist). */
  qrCodeUrl?: string
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
// Output Presets (Firestore outputLayouts collection)
// ─────────────────────────────────────────────

/**
 * Starting-point preset for a room's outputConfig.windows.
 * Applied once in the Output Builder — never a live room→preset reference.
 * Legacy docs (pre-windows[] schema) may still exist; UI should filter them.
 */
export interface OutputLayoutDoc {
  name: string
  windows: OutputWindowConfig[]
  createdBy: string
  createdAt: Timestamp
}

/** Ephemeral RTDB mirror at outputLive/{roomId} (Builder → Output Windows). */
export interface RTDBOutputLive {
  windows: OutputWindowConfig[]
}

// ─────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────

export type AuditAction =
  | 'SESSION_SOUND_CHECK_STARTED'
  | 'SESSION_FEED_GO_LIVE'
  | 'SESSION_FEED_PAUSED'
  | 'SESSION_FEED_STOPPED'
  | 'SESSION_FEED_RESET'
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
