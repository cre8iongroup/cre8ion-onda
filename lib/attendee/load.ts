/**
 * Server-only attendee data loaders (Admin SDK).
 *
 * Never include techCredential or other secrets in returned payloads.
 * Public routes must use these helpers — not client Firestore reads.
 */

import 'server-only'

import { getAdminFirestore } from '@/lib/firebase/admin'
import {
  DEFAULT_SHOW_TIMEZONE,
  effectiveRoomBranding,
  mapShowBranding,
} from '@/lib/branding'
import type {
  EffectiveBranding,
  FeedState,
  RoomDoc,
  SessionDoc,
  ShowBranding,
  ShowDoc,
  ShowLink,
  WithId,
} from '@/types'

export type PublicShow = {
  id: string
  name: string
  clientName: string
  slug: string
  showTimezone: string
  links: ShowLink[]
  branding: EffectiveBranding
  legalNotice?: string
  rooms: Array<{ id: string; name: string }>
}

export type PublicSession = {
  id: string
  showId: string
  roomId: string
  title: string
  friendlyName: string
  scheduledStartMs: number
  scheduledEndMs: number
  feedState: FeedState
  languages: string[]
}

export type PublicRoom = {
  id: string
  showId: string
  name: string
  branding: EffectiveBranding
  show: Pick<PublicShow, 'id' | 'name' | 'slug' | 'showTimezone' | 'branding' | 'legalNotice'>
  sessions: PublicSession[]
  liveSession: PublicSession | null
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

function safeShowLinks(raw: unknown): ShowLink[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((l): l is ShowLink => Boolean(l && typeof l.title === 'string' && typeof l.url === 'string'))
    .map((l, i) => ({
      title: l.title,
      url: l.url,
      order: typeof l.order === 'number' ? l.order : i,
    }))
    .sort((a, b) => a.order - b.order)
}

function toPublicSession(showId: string, id: string, data: SessionDoc): PublicSession | null {
  if (data.isDraft === true) return null
  return {
    id,
    showId,
    roomId: data.roomId,
    title: data.title,
    friendlyName: data.friendlyName,
    scheduledStartMs: timestampToMs(data.scheduledStart),
    scheduledEndMs: timestampToMs(data.scheduledEnd),
    feedState: data.feedState,
    languages: Array.isArray(data.languages) ? data.languages : [],
  }
}

function publicShowFromDoc(id: string, data: ShowDoc): PublicShow | null {
  if (data.portalPublished !== true) return null
  const slug = data.branding?.portalURL?.trim()
  if (!slug) return null

  // Explicit field pick — techCredential intentionally omitted
  const rooms = Array.isArray(data.rooms)
    ? data.rooms
        .filter((r) => r?.id && typeof r.name === 'string')
        .map((r) => ({ id: r.id, name: r.name }))
    : []

  return {
    id,
    name: data.name,
    clientName: data.clientName,
    slug,
    showTimezone: data.showTimezone || DEFAULT_SHOW_TIMEZONE,
    links: safeShowLinks(data.links),
    branding: mapShowBranding(data.branding),
    legalNotice: data.branding?.legalNotice,
    rooms,
  }
}

/** Resolve a published show by branding.portalURL slug. */
export async function resolveShowBySlug(slug: string): Promise<PublicShow | null> {
  const normalized = slug.trim().toLowerCase()
  if (!normalized) return null

  const fs = getAdminFirestore()
  // portalURL lives under branding — query all published shows and match
  // (show count is small; avoids requiring a composite index on nested field).
  const snap = await fs.collection('shows').where('portalPublished', '==', true).get()
  for (const doc of snap.docs) {
    const data = doc.data() as ShowDoc
    if ((data.branding?.portalURL || '').trim().toLowerCase() === normalized) {
      return publicShowFromDoc(doc.id, data)
    }
  }
  return null
}

export async function loadPublishedShowById(showId: string): Promise<PublicShow | null> {
  const fs = getAdminFirestore()
  const snap = await fs.doc(`shows/${showId}`).get()
  if (!snap.exists) return null
  return publicShowFromDoc(snap.id, snap.data() as ShowDoc)
}

export async function loadPublicSessionsForShow(showId: string): Promise<PublicSession[]> {
  const fs = getAdminFirestore()
  const snap = await fs
    .collection(`shows/${showId}/sessions`)
    .orderBy('scheduledStart', 'asc')
    .get()

  const out: PublicSession[] = []
  for (const doc of snap.docs) {
    const pub = toPublicSession(showId, doc.id, doc.data() as SessionDoc)
    if (pub) out.push(pub)
  }
  return out
}

export async function loadPublicSessionsForRoom(
  showId: string,
  roomId: string,
): Promise<PublicSession[]> {
  const all = await loadPublicSessionsForShow(showId)
  return all.filter((s) => s.roomId === roomId)
}

/**
 * Find room by id across shows (room QR targets /room/{roomId}).
 * Returns null if parent show is unpublished.
 */
export async function loadPublicRoomById(roomId: string): Promise<PublicRoom | null> {
  const fs = getAdminFirestore()
  const id = roomId.trim()
  if (!id) return null

  // Scan published shows' rooms subcollections (show count is small).
  const shows = await fs.collection('shows').where('portalPublished', '==', true).get()
  let showId: string | null = null
  let roomData: RoomDoc | null = null
  let showBranding: ShowBranding | undefined

  for (const showDoc of shows.docs) {
    const r = await fs.doc(`shows/${showDoc.id}/rooms/${id}`).get()
    if (r.exists) {
      showId = showDoc.id
      roomData = r.data() as RoomDoc
      showBranding = (showDoc.data() as ShowDoc).branding
      break
    }
  }

  if (!showId || !roomData) return null

  const show = await loadPublishedShowById(showId)
  if (!show) return null

  const sessions = await loadPublicSessionsForRoom(showId, id)
  const liveSession = sessions.find((s) => s.feedState === 'live') ?? null

  return {
    id,
    showId,
    name: roomData.name,
    branding: effectiveRoomBranding(showBranding, roomData.branding),
    show: {
      id: show.id,
      name: show.name,
      slug: show.slug,
      showTimezone: show.showTimezone,
      branding: show.branding,
      legalNotice: show.legalNotice,
    },
    sessions,
    liveSession,
  }
}

export async function loadPublicSessionById(sessionId: string): Promise<{
  session: PublicSession
  show: PublicShow
  branding: EffectiveBranding
} | null> {
  const fs = getAdminFirestore()

  // Sessions are nested under shows — collection group query by document id is unreliable;
  // scan published shows (small N).
  const shows = await fs.collection('shows').where('portalPublished', '==', true).get()
  for (const showDoc of shows.docs) {
    const sessSnap = await fs.doc(`shows/${showDoc.id}/sessions/${sessionId}`).get()
    if (!sessSnap.exists) continue

    const show = publicShowFromDoc(showDoc.id, showDoc.data() as ShowDoc)
    if (!show) continue

    const session = toPublicSession(showDoc.id, sessSnap.id, sessSnap.data() as SessionDoc)
    if (!session) continue

    let branding = show.branding
    if (session.roomId) {
      const roomSnap = await fs.doc(`shows/${showDoc.id}/rooms/${session.roomId}`).get()
      if (roomSnap.exists) {
        branding = effectiveRoomBranding(
          (showDoc.data() as ShowDoc).branding,
          (roomSnap.data() as RoomDoc).branding,
        )
      }
    }

    return { session, show, branding }
  }
  return null
}

/** Admin SDK load of raw show branding for QR host pages (server). */
export async function loadShowBrandingRaw(showId: string): Promise<ShowBranding | null> {
  const fs = getAdminFirestore()
  const snap = await fs.doc(`shows/${showId}`).get()
  if (!snap.exists) return null
  return (snap.data() as ShowDoc).branding ?? null
}

export type { WithId }
