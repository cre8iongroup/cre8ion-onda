'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import {
  clearTechCheckIn,
  readTechCheckIn,
  techOutputHref,
  writeTechCheckIn,
} from '@/lib/tech/checkIn'
import type { RoomDoc, SessionDoc, ShowDoc, ShowRoom, WithId } from '@/types'

export default function RoomCheckInClient() {
  const { userDoc } = useAuthContext()
  const router = useRouter()
  const searchParams = useSearchParams()

  const assignedShows = useMemo(
    () => (Array.isArray(userDoc?.assignedShows) ? userDoc!.assignedShows : []),
    [userDoc],
  )
  const isAdmin = userDoc?.baseRole === 'admin'
  const needsShowPicker = isAdmin || assignedShows.length !== 1

  const deepShowId = searchParams.get('showId')

  const [showId, setShowId] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState<Array<{ id: string; name: string }>>([])
  const [show, setShow] = useState<WithId<ShowDoc> | null>(null)
  const [rooms, setRooms] = useState<WithId<RoomDoc>[]>([])
  const [sessions, setSessions] = useState<WithId<SessionDoc>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(true)

  // Mid-shift sticky: already checked in → Output Builder
  useEffect(() => {
    const existing = readTechCheckIn()
    if (existing) {
      router.replace(techOutputHref(existing.showId, existing.roomId))
      return
    }
    setRedirecting(false)
  }, [router])

  // Resolve showId: ?showId= → single assigned → leave unset for picker
  useEffect(() => {
    if (deepShowId && (isAdmin || assignedShows.length === 0 || assignedShows.includes(deepShowId))) {
      setShowId(deepShowId)
      return
    }
    if (!needsShowPicker && assignedShows[0]) {
      setShowId(assignedShows[0])
    }
  }, [assignedShows, deepShowId, isAdmin, needsShowPicker])

  // Show catalog for admin / multi-assigned
  useEffect(() => {
    if (!needsShowPicker) {
      setShowOptions(
        assignedShows.map((id) => ({
          id,
          name: id === show?.id ? show.name : id,
        })),
      )
      return
    }
    const fs = getClientFirestore()
    return onSnapshot(
      query(collection(fs, 'shows'), orderBy('name', 'asc')),
      (snap) => {
        const opts = snap.docs.map((d) => ({
          id: d.id,
          name: (d.data() as ShowDoc).name || d.id,
        }))
        setShowOptions(opts)
        setLoading(false)
      },
      (err) => {
        setError(err.message || 'Failed to load shows.')
        setLoading(false)
      },
    )
  }, [needsShowPicker, assignedShows, show?.id, show?.name])

  // Load show + rooms + sessions for session counts
  useEffect(() => {
    if (!showId) {
      if (!needsShowPicker) {
        setLoading(false)
        setError('This tech account is not assigned to a show.')
      } else {
        setLoading(false)
      }
      setShow(null)
      setRooms([])
      setSessions([])
      return
    }

    setLoading(true)
    const fs = getClientFirestore()
    const unsubShow = onSnapshot(
      doc(fs, 'shows', showId),
      (snap) => {
        if (!snap.exists()) {
          setError('Show not found.')
          setShow(null)
        } else {
          setShow({ id: snap.id, ...(snap.data() as ShowDoc) })
          setError(null)
        }
      },
      (err) => {
        console.error('TechCheckIn: show load failed', err)
        setError(err.message || 'Failed to load show.')
      },
    )

    const unsubRooms = onSnapshot(
      collection(fs, 'shows', showId, 'rooms'),
      (snap) => {
        setRooms(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoomDoc) })),
        )
      },
      (err) => console.warn('TechCheckIn: rooms load failed', err),
    )

    const unsubSessions = onSnapshot(
      query(
        collection(fs, 'shows', showId, 'sessions'),
        orderBy('scheduledStart', 'asc'),
      ),
      (snap) => {
        setSessions(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) })),
        )
        setLoading(false)
      },
      (err) => {
        console.error('TechCheckIn: sessions load failed', err)
        setError(err.message || 'Failed to load rooms.')
        setLoading(false)
      },
    )

    return () => {
      unsubShow()
      unsubRooms()
      unsubSessions()
    }
  }, [showId, needsShowPicker])

  const roomList: ShowRoom[] = useMemo(() => {
    if (rooms.length > 0) {
      return rooms
        .map((r) => ({ id: r.id, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    return Array.isArray(show?.rooms)
      ? [...show!.rooms!].sort((a, b) => a.name.localeCompare(b.name))
      : []
  }, [rooms, show])

  function selectShow(nextShowId: string) {
    setShowId(nextShowId || null)
    clearTechCheckIn()
    const params = new URLSearchParams()
    if (nextShowId) params.set('showId', nextShowId)
    router.replace(params.toString() ? `/tech?${params}` : '/tech')
  }

  function checkIntoRoom(room: ShowRoom) {
    if (!showId) return
    writeTechCheckIn({
      showId,
      roomId: room.id,
      roomName: room.name,
      showName: show?.name,
    })
    router.push(techOutputHref(showId, room.id))
  }

  if (redirecting) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
        <span className="spinner" aria-label="Loading" />
      </div>
    )
  }

  if (!showId) {
    return (
      <div className="panel-content">
        <div style={{ marginBottom: 'var(--space-8)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
            Tech Panel
          </p>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>
            Select a show
          </h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {isAdmin || assignedShows.length === 0
              ? 'Pick a show, then check into the room you are working.'
              : 'This tech account is not assigned to a show. Ask an admin to provision tech login.'}
          </p>
        </div>
        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
            {error}
          </div>
        )}
        {needsShowPicker && showOptions.length > 0 ? (
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="tech-checkin-show" className="label">Show</label>
            <select
              id="tech-checkin-show"
              className="input"
              value=""
              onChange={(e) => {
                if (e.target.value) selectShow(e.target.value)
              }}
            >
              <option value="">Select a show…</option>
              {showOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
          {show
            ? `${show.name}${show.clientName ? ` · ${show.clientName}` : ''}`
            : 'Show'}
        </p>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>
          Select a room
        </h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Rooms are managed in Admin. Pick the room you are working — Output Builder opens for that room.
        </p>
      </div>

      {needsShowPicker && showOptions.length > 0 ? (
        <div className="field" style={{ maxWidth: 360, marginBottom: 'var(--space-6)' }}>
          <label htmlFor="tech-checkin-show-switch" className="label">Show</label>
          <select
            id="tech-checkin-show-switch"
            className="input"
            value={showId}
            onChange={(e) => selectShow(e.target.value)}
          >
            {showOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading rooms" />
        </div>
      ) : roomList.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>
            No rooms configured
          </h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Ask an admin to add rooms for this show before operating.
          </p>
        </div>
      ) : (
        <div className="tech-room-list" role="list">
          {roomList.map((room) => {
            const count = sessions.filter(
              (s) => s.roomId === room.id && s.isDraft !== true,
            ).length
            return (
              <button
                key={room.id}
                type="button"
                role="listitem"
                id={`btn-tech-room-${room.id}`}
                className="card card-interactive tech-room-card"
                onClick={() => checkIntoRoom(room)}
              >
                <span className="tech-room-card-name">{room.name}</span>
                <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {count === 1 ? '1 session' : `${count} sessions`}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
