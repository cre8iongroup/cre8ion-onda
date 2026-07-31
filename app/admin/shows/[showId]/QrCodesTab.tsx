'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import type { RoomDoc, SessionDoc, ShowRoom, WithId } from '@/types'
import { resolveRoomName, sortRoomsByName } from '@/lib/rooms'
import QrCodeCard from '@/app/admin/components/QrCodeCard'

/**
 * QR codes hub — collapsible rooms, dense session rows, thumbnail → modal.
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
  const orphanSessions = sessions.filter((s) => !rooms.find((r) => r.id === s.roomId))

  if (sortedRooms.length === 0 && orphanSessions.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Add rooms (and sessions) first — QR codes are generated per room and session.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Codes encode production URLs via <code>NEXT_PUBLIC_APP_URL</code>. Generate once; Regenerate
        overwrites. Contributors can download existing codes only. Open a room section, then View a
        thumbnail for full-size download / regenerate.
      </p>

      {sortedRooms.map((room) => {
        const roomSessions = sessions.filter((s) => s.roomId === room.id)
        return (
          <details
            key={room.id}
            className="card"
            style={{ padding: 0, overflow: 'hidden' }}
          >
            <summary
              style={{
                cursor: 'pointer',
                padding: 'var(--space-4)',
                fontWeight: 600,
                fontSize: 'var(--text-lg)',
                userSelect: 'none',
              }}
            >
              {room.name}
              <span
                className="text-sm"
                style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '0.75rem' }}
              >
                ({roomSessions.length} session{roomSessions.length === 1 ? '' : 's'})
              </span>
            </summary>

            <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
              <p
                className="text-sm"
                style={{
                  color: 'var(--color-text-muted)',
                  marginBottom: 'var(--space-2)',
                  fontWeight: 600,
                }}
              >
                Room QR
              </p>
              <QrCodeCard
                type="room"
                showId={showId}
                id={room.id}
                label={`Room · ${room.name}`}
                deepLinkPath={`/room/${room.id}`}
                canGenerate={canGenerate}
                canDownload={canDownload}
                existingUrl={qrByRoomId.get(room.id)}
                variant="row"
              />

              {roomSessions.length > 0 ? (
                <>
                  <p
                    className="text-sm"
                    style={{
                      color: 'var(--color-text-muted)',
                      margin: 'var(--space-4) 0 var(--space-2)',
                      fontWeight: 600,
                    }}
                  >
                    Sessions
                  </p>
                  <div>
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
                        variant="row"
                      />
                    ))}
                  </div>
                </>
              ) : (
                <p
                  className="text-sm"
                  style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-3)' }}
                >
                  No sessions in this room yet.
                </p>
              )}
            </div>
          </details>
        )
      })}

      {orphanSessions.length > 0 ? (
        <details className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <summary
            style={{
              cursor: 'pointer',
              padding: 'var(--space-4)',
              fontWeight: 600,
              fontSize: 'var(--text-lg)',
              userSelect: 'none',
            }}
          >
            Other sessions
          </summary>
          <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
            {orphanSessions.map((session) => (
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
                variant="row"
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
