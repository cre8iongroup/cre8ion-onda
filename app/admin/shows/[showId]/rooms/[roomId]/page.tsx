import RoomEditClient from './RoomEditClient'

export default async function RoomEditPage({
  params,
}: {
  params: Promise<{ showId: string; roomId: string }>
}) {
  const { showId, roomId } = await params
  return <RoomEditClient showId={showId} roomId={roomId} />
}
