import ReviewSessionClient from './ReviewSessionClient'

export default async function ReviewSessionPage({
  params,
}: {
  params: Promise<{ showId: string; sessionId: string }>
}) {
  const { showId, sessionId } = await params
  return <ReviewSessionClient showId={showId} sessionId={sessionId} />
}
