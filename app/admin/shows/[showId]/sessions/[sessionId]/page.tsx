import SessionEditClient from './SessionEditClient'

export default async function SessionEditPage({
  params,
}: {
  params: Promise<{ showId: string; sessionId: string }>
}) {
  const { showId, sessionId } = await params
  return <SessionEditClient showId={showId} sessionId={sessionId} />
}
