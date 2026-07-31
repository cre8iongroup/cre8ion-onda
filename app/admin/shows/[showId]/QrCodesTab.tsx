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
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)
  /** Immediate URL overrides after bulk regen (before / in addition to Firestore snapshots). */
  const [qrUrlOverrides, setQrUrlOverrides] = useState<Record<string, string>>({})
  const [listEpoch, setListEpoch] = useState(0)

  useEffect(() => {
    const fs = getClientFirestore()
    const unsub = onSnapshot(collection(fs, 'shows', showId, 'rooms'), (snap) => {
      setRoomDocs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoomDoc) })))
    })
    return () => unsub()
  }, [showId])

  function qrKey(type: 'room' | 'session', id: string) {
    return `${type}:${id}`
  }

  function resolveQrUrl(type: 'room' | 'session', id: string, fallback?: string) {
    return qrUrlOverrides[qrKey(type, id)] || fallback || undefined
  }

  async function regenerateAllExisting() {
    if (!canGenerate || bulkBusy) return
    const ok = window.confirm(
      'Regenerate every existing room and session QR for this show? This overwrites stored images so encoded URLs pick up the current public origin.',
    )
    if (!ok) return
    setBulkBusy(true)
    setBulkError(null)
    setBulkMessage(null)
    try {
      const { getClientAuth } = await import('@/lib/firebase/client')
      const user = getClientAuth().currentUser
      if (!user) throw new Error('Sign in required')
      const token = await user.getIdToken()
      const res = await fetch('/api/admin/qr/regenerate-show', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ showId, onlyExisting: true }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        publicAppOrigin?: string
        regenerated?: Array<{
          type: 'room' | 'session'
          id: string
          name: string
          targetUrl: string
          pngUrl: string
        }>
        failed?: Array<{ type: string; id: string; error: string }>
      }
      if (!res.ok) throw new Error(json.error || `Regenerate failed (${res.status})`)
      const n = json.regenerated?.length ?? 0
      const fail = json.failed?.length ?? 0

      // Apply new cache-busted URLs immediately so thumbnails reload without a page refresh.
      if (json.regenerated && json.regenerated.length > 0) {
        setQrUrlOverrides((prev) => {
          const next = { ...prev }
          for (const row of json.regenerated!) {
            if (row.pngUrl) next[qrKey(row.type, row.id)] = row.pngUrl
          }
          return next
        })
        setListEpoch((e) => e + 1)
      }

      setBulkMessage(
        `Regenerated ${n} code(s) against ${json.publicAppOrigin}.${fail ? ` ${fail} failed.` : ''}`,
      )
    } catch (err: unknown) {
      setBulkError(err instanceof Error ? err.message : 'Bulk regenerate failed')
    } finally {
      setBulkBusy(false)
    }
  }

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
      <div
        className="flex items-start justify-between gap-4"
        style={{ flexWrap: 'wrap', alignItems: 'center' }}
      >
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)', margin: 0, flex: 1 }}>
          Codes encode the public origin (<code>ONDA_PUBLIC_APP_URL</code> /{' '}
          <code>NEXT_PUBLIC_APP_URL</code>). Generate once; Regenerate overwrites. Contributors can
          download existing codes only.
        </p>
        {canGenerate ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={bulkBusy}
            onClick={() => void regenerateAllExisting()}
          >
            {bulkBusy ? 'Regenerating…' : 'Regenerate all existing'}
          </button>
        ) : null}
      </div>

      {bulkMessage ? (
        <div className="alert alert-success" role="status">
          {bulkMessage}
        </div>
      ) : null}
      {bulkError ? (
        <div className="alert alert-error" role="alert">
          {bulkError}
        </div>
      ) : null}

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
                key={`room-${room.id}-${listEpoch}`}
                type="room"
                showId={showId}
                id={room.id}
                label={`Room · ${room.name}`}
                deepLinkPath={`/room/${room.id}`}
                canGenerate={canGenerate}
                canDownload={canDownload}
                existingUrl={resolveQrUrl('room', room.id, qrByRoomId.get(room.id))}
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
                        key={`session-${session.id}-${listEpoch}`}
                        type="session"
                        showId={showId}
                        id={session.id}
                        label={session.friendlyName || session.title}
                        deepLinkPath={`/session/${session.id}`}
                        canGenerate={canGenerate}
                        canDownload={canDownload}
                        existingUrl={resolveQrUrl('session', session.id, session.qrCodeUrl)}
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
                key={`orphan-${session.id}-${listEpoch}`}
                type="session"
                showId={showId}
                id={session.id}
                label={`${session.friendlyName || session.title} · ${resolveRoomName(rooms, session.roomId)}`}
                deepLinkPath={`/session/${session.id}`}
                canGenerate={canGenerate}
                canDownload={canDownload}
                existingUrl={resolveQrUrl('session', session.id, session.qrCodeUrl)}
                variant="row"
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
