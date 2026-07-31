import { NextResponse } from 'next/server'
import { loadPublicRoomById } from '@/lib/attendee/load'

export const runtime = 'nodejs'

/** GET /api/public/rooms/[roomId] — safe public room + schedule (no secrets). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params
  const room = await loadPublicRoomById(roomId)
  if (!room) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(room)
}
