'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import type { ShowRoom, WithId } from '@/types'
import {
  createRoomDualWrite,
  deleteRoomDualWrite,
  findRoomNameConflict,
  normalizeRoomName,
  renameRoomDualWrite,
  sortRoomsByName,
} from '@/lib/rooms'

export default function RoomsPanel({
  showId,
  rooms,
  sessionRoomIds,
  canEdit,
  onFlash,
}: {
  showId: string
  rooms: ShowRoom[]
  /** roomIds currently referenced by any session — used to block delete. */
  sessionRoomIds: Set<string>
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const { user } = useAuthContext()
  const canOpenRoom = canEdit
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const sorted = sortRoomsByName(rooms)

  async function addRoom() {
    if (!canEdit || busy) return
    const trimmed = normalizeRoomName(name)
    if (!trimmed) {
      setError('Room name is required.')
      return
    }
    if (findRoomNameConflict(rooms, trimmed)) {
      setError('A room with that name already exists.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createRoomDualWrite(
        getClientFirestore(),
        showId,
        rooms,
        trimmed,
        user?.uid || 'admin',
      )
      onFlash(`Room “${trimmed}” added.`)
      setName('')
    } catch (err: any) {
      console.error('RoomsPanel:', err)
      setError(err?.message || 'Failed to update rooms.')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(roomId: string) {
    if (!canEdit || busy) return
    const trimmed = normalizeRoomName(editName)
    if (!trimmed) {
      setError('Room name is required.')
      return
    }
    if (findRoomNameConflict(rooms, trimmed, roomId)) {
      setError('A room with that name already exists.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await renameRoomDualWrite(getClientFirestore(), showId, rooms, roomId, trimmed)
      onFlash(`Room renamed to “${trimmed}”.`)
      setEditingId(null)
      setEditName('')
    } catch (err: any) {
      console.error('RoomsPanel:', err)
      setError(err?.message || 'Failed to update rooms.')
    } finally {
      setBusy(false)
    }
  }

  async function removeRoom(room: ShowRoom) {
    if (!canEdit || busy) return
    if (sessionRoomIds.has(room.id)) {
      setError(
        `“${room.name}” is used by one or more sessions. Reassign or delete those sessions before removing the room.`,
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteRoomDualWrite(getClientFirestore(), showId, rooms, room.id)
      onFlash(`Room “${room.name}” removed.`)
    } catch (err: any) {
      console.error('RoomsPanel:', err)
      setError(err?.message || 'Failed to update rooms.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
        Rooms are physical spaces for Operator unlock and attendee QR targets. Canonical docs live
        under the show; the name list on the show stays dual-written for Operator.
      </p>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
          No rooms yet. Add at least one before creating sessions.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: `0 0 var(--space-4)`, display: 'grid', gap: 'var(--space-2)' }}>
          {sorted.map((room) => (
            <li
              key={room.id}
              id={`room-${room.id}`}
              className="flex items-center justify-between gap-4"
              style={{
                padding: 'var(--space-3)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                flexWrap: 'wrap',
              }}
            >
              {editingId === room.id ? (
                <>
                  <input
                    className="input"
                    value={editName}
                    disabled={busy}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label="Edit room name"
                    style={{ flex: 1, minWidth: 160 }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => saveEdit(room.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(null)
                        setEditName('')
                        setError(null)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 600 }}>{room.name}</span>
                  <div className="flex gap-2">
                    {canOpenRoom ? (
                      <Link
                        href={`/admin/shows/${showId}/rooms/${room.id}`}
                        className="btn btn-secondary btn-sm"
                      >
                        Edit
                      </Link>
                    ) : null}
                    {canEdit ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(room.id)
                            setEditName(room.name)
                            setError(null)
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          title={
                            sessionRoomIds.has(room.id)
                              ? 'Room is used by sessions'
                              : 'Remove room'
                          }
                          onClick={() => removeRoom(room)}
                        >
                          Remove
                        </button>
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="field-row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="room-name-new" className="label">
              New room name
            </label>
            <input
              id="room-name-new"
              className="input"
              placeholder="Room 207"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void addRoom()
                }
              }}
            />
          </div>
          <button
            type="button"
            id="btn-add-room"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void addRoom()}
          >
            {busy ? 'Saving…' : '+ Add room'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Helper for callers that only have session docs. */
export function collectSessionRoomIds(sessions: Array<WithId<{ roomId?: string }>>): Set<string> {
  const ids = new Set<string>()
  for (const s of sessions) {
    if (typeof s.roomId === 'string' && s.roomId) ids.add(s.roomId)
  }
  return ids
}
