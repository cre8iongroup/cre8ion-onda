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
  archivedAt?: Timestamp
  createdAt: Timestamp
  createdBy: string
}

// ─────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────

export type LifecycleStatus =
  | 'preproduction'
  | 'ready'
  | 'live'
  | 'ended'
  | 'underReview'
  | 'approved'
  | 'published'

export type FeedState = 'standby' | 'live' | 'paused' | 'ended'

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
  location: string          // physical room e.g. "W206"
  friendlyName: string      // branded e.g. "Main Stage"
  scheduledStart: Timestamp
  scheduledEnd: Timestamp
  languages: string[]
  glossaryOverride?: GlossaryEntry[]
  lifecycleStatus: LifecycleStatus
  feedState: FeedState
  approvalState: ApprovalState
  aiSummary?: string        // Markdown from Claude
  aiSummaryGeneratedAt?: Timestamp
  aiSummaryTriggeredBy?: string
  publishedAt?: Timestamp
  outputLayoutTemplateId?: string
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

export interface RecallWebhookPayload {
  sessionId: string
  text: string
  speaker?: string
  timestamp: number           // Unix ms
  isFinal: boolean
  sequenceNumber?: number
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
