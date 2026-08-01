import { loadPublicRoomById } from '@/lib/attendee/load'
import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderAttendeeOgImage,
  renderDefaultOndaOgImage,
} from '@/lib/attendee/ogImage'

export const alt = 'Room share preview'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const dynamic = 'force-dynamic'

export default async function Image({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  try {
    const { roomId } = await params
    const room = await loadPublicRoomById(roomId)
    if (!room) return renderDefaultOndaOgImage()

    // Favicon/OG branding is show-level only (not room branding override).
    return renderAttendeeOgImage({
      title: room.name,
      eyebrow: room.show.name,
      branding: room.show.branding,
    })
  } catch {
    return renderDefaultOndaOgImage()
  }
}
