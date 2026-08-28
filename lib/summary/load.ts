/**
 * Server-only public summary loaders (Admin SDK).
 *
 * Independent of show portalPublished — a published session summary is
 * reachable even when the live attendee portal is off.
 *
 * Never include techCredential, reviewState, aiNotesConsent, transcripts,
 * audio paths, or other non-public fields in returned payloads.
 */

import 'server-only'

import { getAdminFirestore } from '@/lib/firebase/admin'
import { mapShowBranding } from '@/lib/branding'
import { parseAiSummary } from '@/lib/review/parseAiSummary'
import { normalizeReviewState } from '@/lib/review/sessionReview'
import type { ClaudeSummary, EffectiveBranding, SessionDoc, ShowDoc } from '@/types'

export type PublicSummaryPage = {
  showId: string
  sessionId: string
  showName: string
  clientName: string
  showTimezone: string
  sessionTitle: string
  sessionFriendlyName: string
  scheduledStartMs: number
  scheduledEndMs: number
  branding: EffectiveBranding
  legalNotice?: string
  summary: ClaudeSummary
}

function timestampToMs(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    return (value as { toMillis: () => number }).toMillis()
  }
  if (typeof value === 'object' && value !== null && '_seconds' in value) {
    return Number((value as { _seconds: number })._seconds) * 1000
  }
  return 0
}

function sessionIsPubliclyPublished(data: SessionDoc): boolean {
  const reviewState = normalizeReviewState(data, 'system')
  if (reviewState.status !== 'published') return false
  if (data.aiNotesConsent === false) return false
  return true
}

/** Lightweight boolean for live session ended CTA — no summary body. */
export async function hasPublishedSummary(
  showId: string,
  sessionId: string,
): Promise<boolean> {
  const fs = getAdminFirestore()
  const snap = await fs.doc(`shows/${showId}/sessions/${sessionId}`).get()
  if (!snap.exists) return false
  return sessionIsPubliclyPublished(snap.data() as SessionDoc)
}

export async function loadPublishedSummary(
  showId: string,
  sessionId: string,
): Promise<PublicSummaryPage | null> {
  const fs = getAdminFirestore()
  const sessionSnap = await fs.doc(`shows/${showId}/sessions/${sessionId}`).get()
  if (!sessionSnap.exists) return null

  const sessionData = sessionSnap.data() as SessionDoc
  if (!sessionIsPubliclyPublished(sessionData)) return null

  const parsed = parseAiSummary(sessionData.aiSummary)
  if (!parsed.ok) return null

  const showSnap = await fs.doc(`shows/${showId}`).get()
  if (!showSnap.exists) return null
  const showData = showSnap.data() as ShowDoc

  return {
    showId,
    sessionId,
    showName: showData.name,
    clientName: showData.clientName,
    showTimezone: showData.showTimezone || 'America/New_York',
    sessionTitle: sessionData.title,
    sessionFriendlyName: sessionData.friendlyName || sessionData.title,
    scheduledStartMs: timestampToMs(sessionData.scheduledStart),
    scheduledEndMs: timestampToMs(sessionData.scheduledEnd),
    branding: mapShowBranding(showData.branding),
    legalNotice: showData.branding?.legalNotice,
    summary: parsed.summary,
  }
}
