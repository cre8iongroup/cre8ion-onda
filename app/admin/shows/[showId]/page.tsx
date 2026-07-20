import ShowDetail from './ShowDetail'

export default async function ShowDetailPage({
  params,
}: {
  params: Promise<{ showId: string }>
}) {
  const { showId } = await params
  return <ShowDetail showId={showId} />
}
