'use client'

import { useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import type { RoomDoc, SessionDoc, ShowRoom, WithId } from '@/types'
import { resolveRoomName, sortRoomsByName } from '@/lib/rooms'
import QrCodeCard from '@/app/admin/components/QrCodeCard'

/**
 * QR codes hub — rooms with nested sessions. Shared generate/download via QrCodeCard.
 */
export default function QrCodesTab({
  showId,
  rooms,
  sessions,
  canGenerate,
  canDownload,
}: {
  showId: string
  rooms: ShowRoom[]
  sessions: WithId<SessionDoc>[]
  canGenerate: boolean
  canDownload: boolean
}) {
  const [roomDocs, setRoomDocs] = useState<WithId<RoomDoc>[]>([])

  useEffect(() => {
    const fs = getClientFirestore()
    const unsub = onSnapshot(collection(fs, 'shows', showId, 'rooms'), (snap) => {
      setRoomDocs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoomDoc) })))
    })
    return () => unsub()
  }, [showId])

  const sortedRooms = sortRoomsByName(rooms)
  const qrByRoomId = new Map(roomDocs.map((r) => [r.id, r.qrCodeUrl]))

  if (sortedRooms.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Add rooms (and sessions) first — QR codes are generated per room and session.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-8)' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Codes encode production URLs via <code>NEXT_PUBLIC_APP_URL</code>. Generate once; Regenerate
        overwrites. Contributors can download existing codes only.
      </p>

      {sortedRooms.map((room) => {
        const roomSessions = sessions.filter((s) => s.roomId === room.id)
        return (
          <section key={room.id}>
            <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>
              {room.name}
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 'var(--space-4)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <QrCodeCard
                type="room"
                showId={showId}
                id={room.id}
                label={`Room · ${room.name}`}
                deepLinkPath={`/room/${room.id}`}
                canGenerate={canGenerate}
                canDownload={canDownload}
                existingUrl={qrByRoomId.get(room.id)}
              />
            </div>

            {roomSessions.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: 'var(--space-3)',
                  paddingLeft: 'var(--space-2)',
                  borderLeft: '2px solid var(--color-border)',
                }}
              >
                {roomSessions.map((session) => (
                  <QrCodeCard
                    key={session.id}
                    type="session"
                    showId={showId}
                    id={session.id}
                    label={session.friendlyName || session.title}
                    deepLinkPath={`/session/${session.id}`}
                    canGenerate={canGenerate}
                    canDownload={canDownload}
                    existingUrl={session.qrCodeUrl}
                    compact
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                No sessions in this room yet.
              </p>
            )}
          </section>
        )
      })}

      {/* Orphan sessions (roomId missing from catalog) */}
      {sessions.some((s) => !rooms.find((r) => r.id === s.roomId)) ? (
        <section>
          <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>
            Other sessions
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 'var(--space-3)',
            }}
          >
            {sessions
              .filter((s) => !rooms.find((r) => r.id === s.roomId))
              .map((session) => (
                <QrCodeCard
                  key={session.id}
                  type="session"
                  showId={showId}
                  id={session.id}
                  label={`${session.friendlyName || session.title} · ${resolveRoomName(rooms, session.roomId)}`}
                  deepLinkPath={`/session/${session.id}`}
                  canGenerate={canGenerate}
                  canDownload={canDownload}
                  existingUrl={session.qrCodeUrl}
                  compact
                />
              ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
