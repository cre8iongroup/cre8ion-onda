/**
 * Server-side session lifecycle helpers for the Electron Tech Operator flow.
 *
 * Electron never writes Firestore/RTDB directly — it calls API routes that use
 * these helpers (Admin SDK). Authoritative `ended` is applied when Recall's
 * upload-complete signal lands on the webhook, which sets RTDB feedState →
 * `ended` and lets onSessionEnd migrate transcripts + set Firestore status.
 */

import { FieldPath, FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import {
  getAdminAccessToken,
  getAdminFirestore,
  setRtdbJson,
  updateRtdbJson,
} from '@/lib/firebase/admin'
import type { LifecycleStatus, SessionDoc, ShowDoc } from '@/types'

export type SessionSummary = {
  id: string
  title: string
  friendlyName: string
  location: string
  lifecycleStatus: LifecycleStatus
  feedState: SessionDoc['feedState']
  scheduledStart: string | null
  scheduledEnd: string | null
}

export type UnlockedShow = {
  id: string
  name: string
  clientName: string
  portalURL: string | null
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

function sessionSummaryFromDoc(
  id: string,
  data: Record<string, any>,
): SessionSummary {
  const scheduledStart = data.scheduledStart?.toDate?.() as Date | undefined
  const scheduledEnd = data.scheduledEnd?.toDate?.() as Date | undefined
  return {
    id,
    title: typeof data.title === 'string' ? data.title : id,
    friendlyName:
      typeof data.friendlyName === 'string'
        ? data.friendlyName
        : typeof data.title === 'string'
          ? data.title
          : id,
    location: typeof data.location === 'string' ? data.location : '',
    lifecycleStatus: (data.lifecycleStatus as LifecycleStatus) ?? 'preproduction',
    feedState: data.feedState ?? 'standby',
    scheduledStart: scheduledStart ? scheduledStart.toISOString() : null,
    scheduledEnd: scheduledEnd ? scheduledEnd.toISOString() : null,
  }
}

/** Find exactly one show whose techCredential matches (Admin SDK). */
export async function unlockShowByCredential(
  credential: string,
): Promise<{ show: UnlockedShow; sessions: SessionSummary[] }> {
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
  const sessionsSnap = await showDoc.ref.collection('sessions').get()
  const sessions = sessionsSnap.docs
    .map((d) => sessionSummaryFromDoc(d.id, d.data()))
    .sort((a, b) => {
      const aT = a.scheduledStart ?? ''
      const bT = b.scheduledStart ?? ''
      return aT.localeCompare(bT)
    })

  return {
    show: {
      id: showDoc.id,
      name: showData.name,
      clientName: showData.clientName,
      portalURL: showData.branding?.portalURL ?? null,
    },
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
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) {
    throw new TechLifecycleError(404, 'session_not_found', 'Session not found')
  }
  const data = sessionSnap.data() as SessionDoc
  return {
    ref: sessionRef,
    data,
    summary: sessionSummaryFromDoc(sessionId, data as unknown as Record<string, any>),
  }
}

/**
 * Mark session live (Firestore + RTDB). Rejects if already live/stopping.
 * Electron must call this successfully before starting the Recall SDK.
 */
export async function startSession(opts: {
  showId: string
  sessionId: string
  credential: string
}): Promise<{ session: SessionSummary; webhookPath: string }> {
  const showRef = await requireShowCredential(opts.showId, opts.credential)
  const { ref: sessionRef, data, summary } = await loadSession(showRef, opts.sessionId)

  if (data.lifecycleStatus === 'live' || data.feedState === 'live') {
    throw new TechLifecycleError(
      409,
      'already_live',
      `Session is already live (lifecycle=${data.lifecycleStatus}, feed=${data.feedState}). ` +
        'Another operator may have this session active.',
    )
  }
  if (data.lifecycleStatus === 'stopping') {
    throw new TechLifecycleError(
      409,
      'stopping_in_progress',
      'Session is still stopping — wait for Recall upload to finish (ended) before restarting.',
    )
  }
  if (['underReview', 'approved', 'published'].includes(data.lifecycleStatus)) {
    throw new TechLifecycleError(
      409,
      'not_startable',
      `Session lifecycleStatus="${data.lifecycleStatus}" cannot go live from Electron.`,
    )
  }

  await sessionRef.update({
    lifecycleStatus: 'live',
    feedState: 'live',
  })

  await setRtdbJson(`liveSessions/${opts.sessionId}`, {
    feedState: 'live',
    showId: opts.showId,
    startedAt: Date.now(),
  })

  await getAdminFirestore().collection('auditLog').add({
    action: 'SESSION_FEED_GO_LIVE',
    performedBy: 'electron-tech',
    performedAt: FieldValue.serverTimestamp(),
    showId: opts.showId,
    sessionId: opts.sessionId,
    metadata: { source: 'startSession' },
  })

  return {
    session: { ...summary, lifecycleStatus: 'live', feedState: 'live' },
    webhookPath: `/api/webhook/${opts.sessionId}`,
  }
}

/**
 * Operator pressed Stop. Sets intermediate `stopping` + feed `paused`.
 * Does NOT set `ended` — that waits for Recall upload-complete webhook.
 */
export async function stopSession(opts: {
  showId: string
  sessionId: string
  credential: string
}): Promise<{ session: SessionSummary }> {
  const showRef = await requireShowCredential(opts.showId, opts.credential)
  const { ref: sessionRef, summary } = await loadSession(showRef, opts.sessionId)

  await sessionRef.update({
    lifecycleStatus: 'stopping',
    feedState: 'paused',
  })

  await updateRtdbJson(`liveSessions/${opts.sessionId}`, {
    feedState: 'paused',
    stoppingAt: Date.now(),
  })

  return {
    session: { ...summary, lifecycleStatus: 'stopping', feedState: 'paused' },
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

  await updateRtdbJson(`liveSessions/${opts.sessionId}`, {
    recordingId: opts.recordingId,
    uploadId: opts.uploadId ?? null,
    showId: opts.showId,
  })

  await setRtdbJson(`recordingIndex/${opts.recordingId}`, {
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
  const data = (await rtdbGetJson(`recordingIndex/${recordingId}`)) as {
    sessionId?: string
    showId?: string
  } | null
  if (!data?.sessionId || !data?.showId) return null
  return { sessionId: data.sessionId, showId: data.showId }
}

/**
 * Mark session ended via RTDB feedState. Triggers onSessionEnd CF which
 * migrates chunks and sets Firestore lifecycleStatus=ended.
 *
 * Also writes Firestore directly so local spike (CF not deployed) still flips
 * lifecycle to ended for operator verification.
 */
export async function markSessionEndedFromRecall(opts: {
  sessionId: string
  showId?: string | null
  recordingId?: string | null
  reason: string
}): Promise<{ ok: true; sessionId: string; showId: string | null }> {
  const sessionId = opts.sessionId
  if (!sessionId) {
    throw new TechLifecycleError(400, 'missing_session_id', 'sessionId is required to end')
  }

  let showId = opts.showId ?? null
  if (!showId) {
    const liveMeta = (await rtdbGetJson(`liveSessions/${sessionId}`)) as {
      showId?: string
    } | null
    showId = liveMeta?.showId ?? null
  }

  await updateRtdbJson(`liveSessions/${sessionId}`, {
    feedState: 'ended',
    endedAt: Date.now(),
    endedReason: opts.reason,
    ...(opts.recordingId ? { recordingId: opts.recordingId } : {}),
  })

  const firestore = getAdminFirestore()

  if (showId) {
    await firestore.doc(`shows/${showId}/sessions/${sessionId}`).update({
      lifecycleStatus: 'ended',
      feedState: 'ended',
    })
  } else {
    // Fallback: collectionGroup by document id (last path segment)
    const sessionsQuery = await firestore
      .collectionGroup('sessions')
      .where(FieldPath.documentId(), '==', sessionId)
      .limit(1)
      .get()

    if (!sessionsQuery.empty) {
      showId = sessionsQuery.docs[0].ref.parent.parent?.id ?? null
      await sessionsQuery.docs[0].ref.update({
        lifecycleStatus: 'ended',
        feedState: 'ended',
      })
    } else {
      console.warn(
        '[sessionLifecycle] markSessionEnded: could not resolve showId; RTDB feedState=ended set',
        { sessionId },
      )
    }
  }

  return { ok: true, sessionId, showId }
}
