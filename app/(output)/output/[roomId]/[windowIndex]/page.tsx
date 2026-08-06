import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadOutputWindowContext } from '@/lib/output/load'
import OutputWindowClient from './OutputWindowClient'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string; windowIndex: string }>
}): Promise<Metadata> {
  const { roomId, windowIndex } = await params
  const idx = Number.parseInt(windowIndex, 10)
  const ctx = Number.isFinite(idx) ? await loadOutputWindowContext(roomId, idx) : null
  if (!ctx) return { title: 'Output' }
  return {
    title: `${ctx.room.name} · Window ${idx + 1}`,
    robots: { index: false, follow: false },
  }
}

export default async function OutputWindowPage({
  params,
}: {
  params: Promise<{ roomId: string; windowIndex: string }>
}) {
  const { roomId, windowIndex: windowIndexRaw } = await params
  const windowIndex = Number.parseInt(windowIndexRaw, 10)
  if (!Number.isFinite(windowIndex) || windowIndex < 0) notFound()

  const ctx = await loadOutputWindowContext(roomId, windowIndex)
  if (!ctx) notFound()

  // Invalid index (no window at this slot) — still render idle shell so OBS gets a page
  return (
    <OutputWindowClient
      roomId={ctx.room.id}
      windowIndex={windowIndex}
      brandTextColor={ctx.brandTextColor}
      initialWindowConfig={ctx.windowConfig}
      initialLiveSessionId={ctx.liveSession?.id ?? null}
    />
  )
}
