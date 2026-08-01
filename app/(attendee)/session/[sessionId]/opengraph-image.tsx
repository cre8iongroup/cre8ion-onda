import { loadPublicSessionById } from '@/lib/attendee/load'
import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderAttendeeOgImage,
  renderDefaultOndaOgImage,
} from '@/lib/attendee/ogImage'

export const alt = 'Session share preview'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const dynamic = 'force-dynamic'

export default async function Image({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  try {
    const { sessionId } = await params
    const result = await loadPublicSessionById(sessionId)
    if (!result) return renderDefaultOndaOgImage()

    const title = result.session.friendlyName || result.session.title
    // Show branding for the card — not room-effective palette.
    return renderAttendeeOgImage({
      title,
      eyebrow: result.show.name,
      branding: result.show.branding,
    })
  } catch {
    return renderDefaultOndaOgImage()
  }
}
