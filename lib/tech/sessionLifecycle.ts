/**
 * Server-side session helpers for Onda Operator (Electron).
 *
 * Electron never writes Firestore/RTDB directly — it calls API routes that use
 * these helpers (Admin SDK). Authoritative `ended` is applied when Recall's
 * upload-complete signal lands on the webhook, which sets RTDB feedState →
 * `ended` and lets onSessionEnd migrate transcripts.
 *
 * Live machine: standby → testing → live → stopping → ended (isDraft separate).
 */

import { FieldPath, FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import {
  getAdminAccessToken,
  getAdminFirestore,
  deleteRtdbJson,
  setRtdbJson,
  updateRtdbJson,
} from '@/lib/firebase/admin'
import { rtdbLiveSessionPath, rtdbRecordingIndexPath } from '@/lib/rtdbPaths'
import type { FeedState, SessionDoc, ShowDoc, ShowRoom, TranscriptionStyle } from '@/types'
import { resolveRoomName } from '@/lib/rooms'

export type SessionSummary = {
  id: string
  title: string
  friendlyName: string
  roomId: string
  /** Resolved from show.rooms at unlock/read time (may be "Unknown room"). */
  roomName: string
  isDraft: boolean
  feedState: FeedState
  scheduledStart: string | null
  scheduledEnd: string | null
}

export type UnlockedShow = {
  id: string
  name: string
  clientName: string
  portalURL: string | null
  /** Deepgram style for recording-start; defaults to standard if missing on older docs. */
  transcriptionStyle: TranscriptionStyle
  /** Markdown source for Operator UI; null when empty/missing. */
  operatorInstructions: string | null
}

export type UnlockedRoom = {
  id: string
  name: string
}

export class TechLifecycleError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function asFeedState(value: unknown): FeedState {
  const allowed: FeedState[] = ['standby', 'testing', 'live', 'stopping', 'ended']
  if (typeof value === 'string' && (allowed as string[]).includes(value)) {
    return value as FeedState
  }
  // Legacy `paused` (pre–Slice 2B) maps to stopping
  if (value === 'paused') return 'stopping'
  return 'standby'
}

function sessionSummaryFromDoc(
  id: string,
  data: Record<string, any>,
  rooms?: ShowRoom[] | null,
): SessionSummary {
  const scheduledStart = data.scheduledStart?.toDate?.() as Date | undefined
  const scheduledEnd = data.scheduledEnd?.toDate?.() as Date | undefined
  const roomId = typeof data.roomId === 'string' ? data.roomId : ''
  return {
    id,
    title: typeof data.title === 'string' ? data.title : id,
    friendlyName:
      typeof data.friendlyName === 'string'
        ? data.friendlyName
        : typeof data.title === 'string'
          ? data.title
          : id,
    roomId,
    roomName: resolveRoomName(rooms, roomId),
    isDraft: data.isDraft === true,
    feedState: asFeedState(data.feedState),
    scheduledStart: scheduledStart ? scheduledStart.toISOString() : null,
    scheduledEnd: scheduledEnd ? scheduledEnd.toISOString() : null,
  }
}

/** Find exactly one show whose techCredential matches (Admin SDK). */
export async function unlockShowByCredential(
  credential: string,
): Promise<{ show: UnlockedShow; rooms: UnlockedRoom[]; sessions: SessionSummary[] }> {
  const trimmed = credential.trim()
  if (!trimmed) {
    throw new TechLifecycleError(400, 'missing_credential', 'Credential is required')
  }

  const firestore = getAdminFirestore()
  const snap = await firestore
    .collection('shows')
    .where('techCredential', '==', trimmed)
    .limit(2)
    .get()

  if (snap.empty) {
    throw new TechLifecycleError(401, 'invalid_credential', 'Invalid tech credential')
  }
  if (snap.size > 1) {
    throw new TechLifecycleError(
      409,
      'ambiguous_credential',
      'Multiple shows share this credential — fix in Admin before continuing',
    )
  }

  const showDoc = snap.docs[0]
  const showData = showDoc.data() as ShowDoc
  const rooms: UnlockedRoom[] = Array.isArray(showData.rooms)
    ? showData.rooms
        .filter((r): r is ShowRoom => Boolean(r?.id && typeof r.name === 'string'))
        .map((r) => ({ id: r.id, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    : []

  const sessionsSnap = await showDoc.ref.collection('sessions').get()
  const sessions = sessionsSnap.docs
    .map((d) => sessionSummaryFromDoc(d.id, d.data(), rooms))
    // Onda Operator never sees drafts
    .filter((s) => !s.isDraft)
    .sort((a, b) => {
      const aT = a.scheduledStart ?? ''
      const bT = b.scheduledStart ?? ''
      return aT.localeCompare(bT)
    })

  const instructions =
    typeof showData.operatorInstructions === 'string'
      ? showData.operatorInstructions.trim()
      : ''

  return {
    show: {
      id: showDoc.id,
      name: showData.name,
      clientName: showData.clientName,
      portalURL: showData.branding?.portalURL ?? null,
      transcriptionStyle:
        showData.transcriptionStyle === 'lightweight' ? 'lightweight' : 'standard',
      operatorInstructions: instructions.length > 0 ? instructions : null,
    },
    rooms,
    sessions,
  }
}

async function requireShowCredential(
  showId: string,
  credential: string,
): Promise<DocumentReference> {
  const trimmed = credential.trim()
  if (!trimmed) {
    throw new TechLifecycleError(400, 'missing_credential', 'Credential is required')
  }
  const firestore = getAdminFirestore()
  const showRef = firestore.doc(`shows/${showId}`)
  const showSnap = await showRef.get()
  if (!showSnap.exists) {
    throw new TechLifecycleError(404, 'show_not_found', 'Show not found')
  }
  const data = showSnap.data() as ShowDoc
  if (!data.techCredential || data.techCredential !== trimmed) {
    throw new TechLifecycleError(401, 'invalid_credential', 'Invalid tech credential')
  }
  return showRef
}

async function loadSession(
  showRef: DocumentReference,
  sessionId: string,
): Promise<{ ref: DocumentReference; data: SessionDoc; summary: SessionSummary }> {
  const sessionRef = showRef.collection('sessions').doc(sessionId)
  const [sessionSnap, showSnap] = await Promise.all([sessionRef.get(), showRef.get()])
  if (!sessionSnap.exists) {
    throw new TechLifecycleError(404, 'session_not_found', 'Session not found')
  }
  const data = sessionSnap.data() as SessionDoc
  const rooms = (showSnap.data() as ShowDoc | undefined)?.rooms ?? []
  return {
    ref: sessionRef,
    data,
    summary: sessionSummaryFromDoc(sessionId, data as unknown as Record<string, any>, rooms),
  }
}

/**
 * Start sound check: feedState → testing + operator starts Recall after this succeeds.
 */
export async function startSession(opts: {
  showId: string
  sessionId: string
  credential: string
}): Promise<{ session: SessionSummary; webhookPath: string }> {
  const showRef = await requireShowCredential(opts.showId, opts.credential)
  const { ref: sessionRef, data, summary } = await loadSession(showRef, opts.sessionId)
  const feedState = asFeedState(data.feedState)

  if (data.isDraft === true) {
    throw new TechLifecycleError(
      409,
      'session_draft',
      'Session is still a draft — make it visible in Admin before sound check.',
    )
  }
  if (feedState !== 'standby') {
    throw new TechLifecycleError(
      409,
      'not_standby',
      `Sound check requires feedState=standby (got ${feedState}).`,
    )
  }

  await sessionRef.update({ feedState: 'testing' })

  await setRtdbJson(rtdbLiveSessionPath(opts.sessionId), {
    feedState: 'testing',
    showId: opts.showId,
    startedAt: Date.now(),
  })

  await getAdminFirestore().collection('auditLog').add({
    action: 'SESSION_SOUND_CHECK_STARTED',
    performedBy: 'onda-operator',
    performedAt: FieldValue.serverTimestamp(),
    showId: opts.showId,
    sessionId: opts.sessionId,
    metadata: { source: 'startSession' },
  })

  return {
    session: { ...summary, isDraft: false, feedState: 'testing' },
    webhookPath: `/api/webhook/${opts.sessionId}`,
  }
}

/**
 * Go Live: feedState testing → live only. Does not touch Recall recording.
 */
export async function goLiveSession(opts: {
  showId: string
  sessionId: string
  credential: string
}): Promise<{ session: SessionSummary }> {
  const showRef = await requireShowCredential(opts.showId, opts.credential)
  const { ref: sessionRef, data, summary } = await loadSession(showRef, opts.sessionId)
  const feedState = asFeedState(data.feedState)

  if (data.isDraft === true) {
    throw new TechLifecycleError(409, 'session_draft', 'Session is a draft')
  }
  if (feedState !== 'testing') {
    throw new TechLifecycleError(
      409,
      'not_testing',
      `Go Live requires feedState=testing (got ${feedState}). Run sound check first.`,
    )
  }

  await sessionRef.update({ feedState: 'live' })
  await updateRtdbJson(rtdbLiveSessionPath(opts.sessionId), {
    feedState: 'live',
    wentLiveAt: Date.now(),
  })

  await getAdminFirestore().collection('auditLog').add({
    action: 'SESSION_FEED_GO_LIVE',
    performedBy: 'onda-operator',
    performedAt: FieldValue.serverTimestamp(),
    showId: opts.showId,
    sessionId: opts.sessionId,
    metadata: { source: 'goLiveSession' },
  })

  return {
    session: { ...summary, isDraft: false, feedState: 'live' },
  }
}

/**
 * Operator pressed End. Sets feedState → stopping immediately (not ended).
 * Ended waits for Recall upload-complete webhook.
 */
export async function stopSession(opts: {
  showId: string
  sessionId: string
  credential: string
}): Promise<{ session: SessionSummary }> {
  const showRef = await requireShowCredential(opts.showId, opts.credential)
  const { ref: sessionRef, data, summary } = await loadSession(showRef, opts.sessionId)
  const feedState = asFeedState(data.feedState)

  if (feedState !== 'live' && feedState !== 'testing') {
    throw new TechLifecycleError(
      409,
      'not_stoppable',
      `End session requires feedState=live or testing (got ${feedState}).`,
    )
  }

  await sessionRef.update({ feedState: 'stopping' })

  await updateRtdbJson(rtdbLiveSessionPath(opts.sessionId), {
    feedState: 'stopping',
    stoppingAt: Date.now(),
  })

  return {
    session: { ...summary, feedState: 'stopping' },
  }
}

/**
 * Bind Recall recording/upload IDs so workspace-level Svix lifecycle webhooks
 * can resolve back to a session when metadata is empty (docs show `{}`).
 */
export async function bindRecording(opts: {
  showId: string
  sessionId: string
  credential: string
  recordingId: string
  uploadId?: string | null
}): Promise<void> {
  const showRef = await requireShowCredential(opts.showId, opts.credential)
  await loadSession(showRef, opts.sessionId)

  if (!opts.recordingId) {
    throw new TechLifecycleError(400, 'missing_recording_id', 'recordingId is required')
  }

  await updateRtdbJson(rtdbLiveSessionPath(opts.sessionId), {
    recordingId: opts.recordingId,
    uploadId: opts.uploadId ?? null,
    showId: opts.showId,
  })

  await setRtdbJson(rtdbRecordingIndexPath(opts.recordingId), {
    sessionId: opts.sessionId,
    showId: opts.showId,
    uploadId: opts.uploadId ?? null,
    boundAt: Date.now(),
  })
}

async function rtdbGetJson(path: string): Promise<unknown> {
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim()
  if (!databaseURL) return null

  const usingEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST?.trim())
  const base = usingEmulator
    ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}/${new URL(databaseURL).host.split('.')[0]}`
    : databaseURL.replace(/\/$/, '')

  const normalizedPath = path.replace(/^\/+|\/+$/g, '')
  const url = new URL(`${base}/${normalizedPath}.json`)
  const headers: Record<string, string> = {}
  if (!usingEmulator) {
    const token = await getAdminAccessToken()
    url.searchParams.set('access_token', token)
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(url, { headers })
  if (!res.ok) return null
  return res.json()
}

export async function resolveSessionIdFromRecordingId(
  recordingId: string,
): Promise<{ sessionId: string; showId: string } | null> {
  if (!recordingId) return null
  const data = (await rtdbGetJson(rtdbRecordingIndexPath(recordingId))) as {
    sessionId?: string
    showId?: string
  } | null
  if (!data?.sessionId || !data?.showId) return null
  return { sessionId: data.sessionId, showId: data.showId }
}

/**
 * Mark session ended via RTDB feedState. Triggers onSessionEnd CF which
 * migrates chunks. Also writes Firestore feedState=ended for local spike.
 *
 * No-ops when Firestore feedState is already `standby` so a late
 * sdk_upload.complete cannot undo an Admin reset.
 */
export async function markSessionEndedFromRecall(opts: {
  sessionId: string
  showId?: string | null
  recordingId?: string | null
  audioStoragePath?: string | null
  reason: string
}): Promise<{
  ok: true
  sessionId: string
  showId: string | null
  skipped?: 'already_standby'
}> {
  const sessionId = opts.sessionId
  if (!sessionId) {
    throw new TechLifecycleError(400, 'missing_session_id', 'sessionId is required to end')
  }

  let showId = opts.showId ?? null
  if (!showId) {
    const liveMeta = (await rtdbGetJson(rtdbLiveSessionPath(sessionId))) as {
      showId?: string
    } | null
    showId = liveMeta?.showId ?? null
  }

  const firestore = getAdminFirestore()
  let sessionRef: DocumentReference | null = null

  if (showId) {
    sessionRef = firestore.doc(`shows/${showId}/sessions/${sessionId}`)
  } else {
    const sessionsQuery = await firestore
      .collectionGroup('sessions')
      .where(FieldPath.documentId(), '==', sessionId)
      .limit(1)
      .get()
    if (!sessionsQuery.empty) {
      sessionRef = sessionsQuery.docs[0].ref
      showId = sessionRef.parent.parent?.id ?? null
    }
  }

  if (sessionRef) {
    const snap = await sessionRef.get()
    if (snap.exists) {
      const current = asFeedState((snap.data() as SessionDoc | undefined)?.feedState)
      if (current === 'standby') {
        console.info('[sessionLifecycle] markSessionEnded: skip — session already standby', {
          sessionId,
          showId,
          reason: opts.reason,
        })
        return { ok: true, sessionId, showId, skipped: 'already_standby' }
      }
    }
  }

  await updateRtdbJson(rtdbLiveSessionPath(sessionId), {
    feedState: 'ended',
    endedAt: Date.now(),
    endedReason: opts.reason,
    ...(opts.recordingId ? { recordingId: opts.recordingId } : {}),
    ...(opts.audioStoragePath ? { audioStoragePath: opts.audioStoragePath } : {}),
  })

  const sessionPatch: Record<string, unknown> = {
    feedState: 'ended',
  }
  if (opts.recordingId) sessionPatch.recordingId = opts.recordingId
  if (opts.audioStoragePath) {
    sessionPatch.audioStoragePath = opts.audioStoragePath
    sessionPatch.audioStoredAt = FieldValue.serverTimestamp()
  }

  if (sessionRef) {
    await sessionRef.update(sessionPatch)
  } else {
    console.warn(
      '[sessionLifecycle] markSessionEnded: could not resolve showId; RTDB feedState=ended set',
      { sessionId },
    )
  }

  return { ok: true, sessionId, showId }
}

export type RecallStopProbeOutcome = {
  outcome: 'skipped' | 'probed' | 'failed'
  reason: string
  recordingId: string | null
  recordingStatus?: unknown
  detail?: string
}

/**
 * Admin override: force any feedState back to standby so the session is
 * immediately re-testable. Bypasses normal transition guards.
 *
 * Clears live binding (Firestore recording fields + RTDB live node +
 * recordingIndex). Does not wipe archived transcripts / aiSummary.
 *
 * Recall Desktop capture can only be stopped from the Mac SDK — v1 probes
 * Retrieve Recording when an id is known and logs skipped/desktop_sdk_stop_only.
 */
export async function resetSessionToStandby(opts: {
  showId: string
  sessionId: string
  performedBy: string
}): Promise<{
  session: SessionSummary
  previousFeedState: FeedState
  recallStop: RecallStopProbeOutcome
}> {
  const firestore = getAdminFirestore()
  const showRef = firestore.doc(`shows/${opts.showId}`)
  const showSnap = await showRef.get()
  if (!showSnap.exists) {
    throw new TechLifecycleError(404, 'show_not_found', 'Show not found')
  }

  const { ref: sessionRef, data, summary } = await loadSession(showRef, opts.sessionId)
  const previousFeedState = asFeedState(data.feedState)

  const liveMeta = (await rtdbGetJson(rtdbLiveSessionPath(opts.sessionId))) as {
    recordingId?: string
  } | null
  const recordingId =
    (typeof data.recordingId === 'string' && data.recordingId) ||
    (typeof liveMeta?.recordingId === 'string' && liveMeta.recordingId) ||
    null

  const recallStop = await probeRecallRecordingForReset(recordingId)

  await sessionRef.update({
    feedState: 'standby',
    recordingId: FieldValue.delete(),
    audioStoragePath: FieldValue.delete(),
    audioStoredAt: FieldValue.delete(),
  })

  // Best-effort RTDB cleanup — failures should not leave Firestore mid-reset.
  try {
    await deleteRtdbJson(rtdbLiveSessionPath(opts.sessionId))
  } catch (err) {
    console.warn('[sessionLifecycle] resetSessionToStandby: liveSessions delete failed', {
      sessionId: opts.sessionId,
      message: err instanceof Error ? err.message : String(err),
    })
  }

  if (recordingId) {
    try {
      await deleteRtdbJson(rtdbRecordingIndexPath(recordingId))
    } catch (err) {
      console.warn('[sessionLifecycle] resetSessionToStandby: recordingIndex delete failed', {
        recordingId,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  await firestore.collection('auditLog').add({
    action: 'SESSION_FEED_RESET',
    performedBy: opts.performedBy,
    performedAt: FieldValue.serverTimestamp(),
    showId: opts.showId,
    sessionId: opts.sessionId,
    metadata: {
      source: 'admin_reset',
      previousFeedState,
      recordingId,
      recallStop,
    },
  })

  console.info('[sessionLifecycle] resetSessionToStandby', {
    showId: opts.showId,
    sessionId: opts.sessionId,
    previousFeedState,
    recallStop,
    performedBy: opts.performedBy,
  })

  return {
    session: { ...summary, feedState: 'standby' },
    previousFeedState,
    recallStop,
  }
}

async function probeRecallRecordingForReset(
  recordingId: string | null,
): Promise<RecallStopProbeOutcome> {
  if (!recordingId) {
    return {
      outcome: 'skipped',
      reason: 'no_recording_bound',
      recordingId: null,
    }
  }

  const apiKey = process.env.RECALL_API_KEY?.trim()
  const region = process.env.RECALL_REGION?.trim() || 'us-west-2'
  if (!apiKey) {
    return {
      outcome: 'skipped',
      reason: 'desktop_sdk_stop_only',
      recordingId,
      detail: 'RECALL_API_KEY not configured; cannot probe Retrieve Recording',
    }
  }

  try {
    const res = await fetch(`https://${region}.recall.ai/api/v1/recording/${recordingId}/`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Token ${apiKey}`,
      },
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        outcome: 'failed',
        reason: 'retrieve_recording_failed',
        recordingId,
        detail: `HTTP ${res.status}`,
        recordingStatus: json.status ?? null,
      }
    }
    // Desktop SDK stop is client-only — probe succeeded but we did not stop.
    return {
      outcome: 'skipped',
      reason: 'desktop_sdk_stop_only',
      recordingId,
      recordingStatus: json.status ?? null,
    }
  } catch (err) {
    return {
      outcome: 'failed',
      reason: 'retrieve_recording_threw',
      recordingId,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
