import { redirect } from 'next/navigation'

/** Legacy printed URLs: /portal/{slug} → /show/{slug} */
export default async function PortalRedirectPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/show/${slug}`)
}
