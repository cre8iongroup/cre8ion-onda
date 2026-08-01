import { resolveShowBySlug } from '@/lib/attendee/load'
import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderAttendeeOgImage,
  renderDefaultOndaOgImage,
} from '@/lib/attendee/ogImage'

export const alt = 'Sessions share preview'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const dynamic = 'force-dynamic'

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  try {
    const { slug } = await params
    const show = await resolveShowBySlug(slug)
    if (!show) return renderDefaultOndaOgImage()

    return renderAttendeeOgImage({
      title: 'Sessions',
      eyebrow: show.name,
      branding: show.branding,
    })
  } catch {
    return renderDefaultOndaOgImage()
  }
}
