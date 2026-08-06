import { NextRequest, NextResponse } from 'next/server'
import {
  AdminAuthError,
  requireAdminUser,
} from '@/lib/admin/requireAdminUser'
import { getAdminFirestore } from '@/lib/firebase/admin'
import type { RoomDoc, ShowDoc } from '@/types'

export const runtime = 'nodejs'

/**
 * GET /api/tech/resolve-room?roomId=
 *
 * Authenticated (tech or admin with canAccessTechPanel). Finds which show owns
 * the room and returns names for Builder deep links.
 */
export async function GET(request: NextRequest) {
  try {
    const { userDoc, capabilities } = await requireAdminUser(request)
    if (!capabilities.canAccessTechPanel) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const roomId = (request.nextUrl.searchParams.get('roomId') || '').trim()
    if (!roomId) {
      return NextResponse.json({ error: 'roomId required' }, { status: 400 })
    }

    const fs = getAdminFirestore()
    const assigned = Array.isArray(userDoc.assignedShows) ? userDoc.assignedShows : []
    const isAdmin = userDoc.baseRole === 'admin'

    type ShowSnap = { id: string; data: () => ShowDoc; exists: boolean }
    let showCandidates: ShowSnap[]

    if (isAdmin || assigned.length === 0) {
      // Admin (empty assignedShows = all shows) — scan shows (N is small).
      const showsSnap = await fs.collection('shows').get()
      showCandidates = showsSnap.docs.map((d) => ({
        id: d.id,
        exists: true,
        data: () => d.data() as ShowDoc,
      }))
    } else {
      const docs = await Promise.all(assigned.map((id) => fs.doc(`shows/${id}`).get()))
      showCandidates = docs
        .filter((d) => d.exists)
        .map((d) => ({
          id: d.id,
          exists: true,
          data: () => d.data() as ShowDoc,
        }))
    }

    for (const showDoc of showCandidates) {
      const roomSnap = await fs.doc(`shows/${showDoc.id}/rooms/${roomId}`).get()
      if (!roomSnap.exists) continue

      if (!isAdmin && assigned.length > 0 && !assigned.includes(showDoc.id)) {
        return NextResponse.json({ error: 'Not assigned to this show' }, { status: 403 })
      }

      const showData = showDoc.data()
      const roomData = roomSnap.data() as RoomDoc
      return NextResponse.json({
        showId: showDoc.id,
        showName: showData.name,
        roomId,
        roomName: roomData.name,
      })
    }

    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[tech/resolve-room]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
