'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Timestamp } from 'firebase/firestore'
import type { SessionDoc, ShowRoom, WithId } from '@/types'
import {
  canHideSession,
  sessionStatusBadgeClass,
  sessionStatusLabel,
} from '@/lib/sessionStatus'
import { resolveRoomName, sortRoomsByName } from '@/lib/rooms'

function formatDateTime(ts?: Timestamp): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function dateKey(ts?: Timestamp): string | null {
  if (!ts) return null
  const d = ts.toDate()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDateLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Coarse time-of-day buckets for quick filtering. */
type TimeBucket = 'morning' | 'afternoon' | 'evening'

function timeBucket(ts?: Timestamp): TimeBucket | null {
  if (!ts) return null
  const hour = ts.toDate().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  morning: 'Morning (before 12)',
  afternoon: 'Afternoon (12–5)',
  evening: 'Evening (5+)',
}

type TimeSort = 'asc' | 'desc'

export default function SessionsPanel({
  showId,
  rooms,
  sessions,
  loading,
  canEdit,
  draftBusyId,
  resetBusyId,
  onToggleDraft,
  onResetSession,
}: {
  showId: string
  rooms: ShowRoom[]
  sessions: WithId<SessionDoc>[]
  loading: boolean
  canEdit: boolean
  draftBusyId: string | null
  resetBusyId: string | null
  onToggleDraft: (session: WithId<SessionDoc>) => void
  onResetSession: (session: WithId<SessionDoc>) => void
}) {
  const [search, setSearch] = useState('')
  const [roomFilter, setRoomFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [timeFilter, setTimeFilter] = useState<'' | TimeBucket>('')
  const [timeSort, setTimeSort] = useState<TimeSort>('asc')

  const sortedRooms = useMemo(() => sortRoomsByName(rooms), [rooms])

  const dateOptions = useMemo(() => {
    const keys = new Set<string>()
    for (const s of sessions) {
      const k = dateKey(s.scheduledStart)
      if (k) keys.add(k)
    }
    return [...keys].sort()
  }, [sessions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sessions.filter((s) => {
      if (roomFilter && s.roomId !== roomFilter) return false
      if (dateFilter) {
        const k = dateKey(s.scheduledStart)
        if (k !== dateFilter) return false
      }
      if (timeFilter) {
        if (timeBucket(s.scheduledStart) !== timeFilter) return false
      }
      if (q) {
        const title = (s.title || '').toLowerCase()
        const friendly = (s.friendlyName || '').toLowerCase()
        if (!title.includes(q) && !friendly.includes(q)) return false
      }
      return true
    })
  }, [sessions, search, roomFilter, dateFilter, timeFilter])

  const grouped = useMemo(() => {
    const byRoom = new Map<string, WithId<SessionDoc>[]>()
    for (const s of filtered) {
      const id = s.roomId || '__unknown__'
      const list = byRoom.get(id)
      if (list) list.push(s)
      else byRoom.set(id, [s])
    }
    for (const list of byRoom.values()) {
      list.sort((a, b) => {
        const aMs = a.scheduledStart?.toMillis?.() ?? 0
        const bMs = b.scheduledStart?.toMillis?.() ?? 0
        return timeSort === 'asc' ? aMs - bMs : bMs - aMs
      })
    }

    const roomOrder = sortedRooms.map((r) => r.id)
    const orderedIds: string[] = []
    for (const id of roomOrder) {
      if (byRoom.has(id)) orderedIds.push(id)
    }
    for (const id of byRoom.keys()) {
      if (!orderedIds.includes(id)) orderedIds.push(id)
    }

    return orderedIds.map((roomId) => ({
      roomId,
      roomName:
        roomId === '__unknown__'
          ? 'Unknown room'
          : resolveRoomName(rooms, roomId) || 'Unknown room',
      sessions: byRoom.get(roomId) ?? [],
    }))
  }, [filtered, sortedRooms, rooms, timeSort])

  const hasRooms = rooms.length > 0
  const filtersActive = Boolean(search.trim() || roomFilter || dateFilter || timeFilter)

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 'var(--space-12)' }}>
        <span className="spinner" aria-label="Loading sessions" />
      </div>
    )
  }

  if (!hasRooms && sessions.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
        <h3 style={{ fontSize: 'var(--text-md)' }}>Add a room before creating sessions</h3>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
        <h3 style={{ fontSize: 'var(--text-md)' }}>No sessions yet</h3>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div
        className="card"
        style={{
          padding: 'var(--space-3)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
          alignItems: 'flex-end',
        }}
      >
        <div className="field" style={{ margin: 0, flex: '1 1 12rem', minWidth: 0 }}>
          <label className="label" htmlFor="sessions-search">
            Search
          </label>
          <input
            id="sessions-search"
            className="input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Session name…"
          />
        </div>
        <div className="field" style={{ margin: 0, flex: '1 1 10rem', minWidth: 0 }}>
          <label className="label" htmlFor="sessions-room-filter">
            Room
          </label>
          <select
            id="sessions-room-filter"
            className="input"
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
          >
            <option value="">All rooms</option>
            {sortedRooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0, flex: '1 1 10rem', minWidth: 0 }}>
          <label className="label" htmlFor="sessions-date-filter">
            Date
          </label>
          <select
            id="sessions-date-filter"
            className="input"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          >
            <option value="">All dates</option>
            {dateOptions.map((k) => (
              <option key={k} value={k}>
                {formatDateLabel(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0, flex: '1 1 10rem', minWidth: 0 }}>
          <label className="label" htmlFor="sessions-time-filter">
            Time
          </label>
          <select
            id="sessions-time-filter"
            className="input"
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as '' | TimeBucket)}
          >
            <option value="">All times</option>
            {(Object.keys(TIME_BUCKET_LABELS) as TimeBucket[]).map((b) => (
              <option key={b} value={b}>
                {TIME_BUCKET_LABELS[b]}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0, flex: '0 1 9rem', minWidth: 0 }}>
          <label className="label" htmlFor="sessions-time-sort">
            Sort within room
          </label>
          <select
            id="sessions-time-sort"
            className="input"
            value={timeSort}
            onChange={(e) => setTimeSort(e.target.value as TimeSort)}
          >
            <option value="asc">Earliest first</option>
            <option value="desc">Latest first</option>
          </select>
        </div>
        {filtersActive ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSearch('')
              setRoomFilter('')
              setDateFilter('')
              setTimeFilter('')
            }}
            style={{ alignSelf: 'flex-end' }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: 0 }}>
            No sessions match the current filters.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
          {grouped.map((group) => (
            <section key={group.roomId} aria-labelledby={`room-group-${group.roomId}`}>
              <h3
                id={`room-group-${group.roomId}`}
                style={{
                  fontSize: 'var(--text-md)',
                  marginBottom: 'var(--space-3)',
                  color: 'var(--color-text-primary)',
                  borderBottom: '1px solid var(--color-border)',
                  paddingBottom: 'var(--space-2)',
                }}
              >
                {group.roomName}
                <span
                  className="text-sm"
                  style={{
                    color: 'var(--color-text-muted)',
                    fontWeight: 400,
                    marginLeft: 'var(--space-2)',
                  }}
                >
                  ({group.sessions.length})
                </span>
              </h3>
              <div className="show-list">
                {group.sessions.map((session) => (
                  <article
                    key={session.id}
                    id={`session-${session.id}`}
                    className="card show-list-item"
                  >
                    <div
                      className="flex items-center justify-between gap-4"
                      style={{ flexWrap: 'wrap' }}
                    >
                      <div>
                        <h4
                          style={{
                            fontSize: 'var(--text-md)',
                            marginBottom: 'var(--space-1)',
                            fontWeight: 600,
                          }}
                        >
                          <Link href={`/admin/shows/${showId}/sessions/${session.id}`}>
                            {session.title}
                          </Link>
                        </h4>
                        {session.friendlyName ? (
                          <p
                            className="text-sm"
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            {session.friendlyName}
                          </p>
                        ) : null}
                        <p
                          className="text-sm"
                          style={{
                            color: 'var(--color-text-muted)',
                            marginTop: 'var(--space-2)',
                          }}
                        >
                          {formatDateTime(session.scheduledStart)} –{' '}
                          {formatDateTime(session.scheduledEnd)}
                        </p>
                      </div>
                      <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <span
                          className={`badge ${sessionStatusBadgeClass({
                            isDraft: session.isDraft,
                            feedState: session.feedState,
                          })}`}
                        >
                          {sessionStatusLabel(
                            { isDraft: session.isDraft, feedState: session.feedState },
                            'admin',
                          )}
                        </span>
                        <Link
                          href={`/admin/shows/${showId}/sessions/${session.id}`}
                          className="btn btn-secondary btn-sm"
                        >
                          Edit
                        </Link>
                        {canEdit ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={
                                draftBusyId === session.id || resetBusyId === session.id
                              }
                              onClick={() => onToggleDraft(session)}
                              title={
                                !session.isDraft && !canHideSession(session.feedState)
                                  ? 'End the session before hiding it'
                                  : undefined
                              }
                            >
                              {session.isDraft ? 'Make visible' : 'Hide'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={
                                draftBusyId === session.id || resetBusyId === session.id
                              }
                              onClick={() => onResetSession(session)}
                            >
                              {resetBusyId === session.id ? 'Resetting…' : 'Reset session'}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
