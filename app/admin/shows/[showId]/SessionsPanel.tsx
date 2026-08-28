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
import { sortSessionsByScheduledStart, type TimeSort } from '@/lib/sessions/sessionFilters'
import { useSessionFilters } from '@/hooks/useSessionFilters'
import SessionFilterBar from '@/components/sessions/SessionFilterBar'

function formatDateTime(ts?: Timestamp): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

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
  const [timeSort, setTimeSort] = useState<TimeSort>('asc')
  const {
    search,
    setSearch,
    roomId,
    setRoomId,
    dateKey,
    setDateKey,
    timeBucket,
    setTimeBucket,
    dateOptions,
    filteredSessions,
    filtersActive,
    clearFilters,
  } = useSessionFilters(sessions)

  const sortedRooms = useMemo(() => sortRoomsByName(rooms), [rooms])

  const grouped = useMemo(() => {
    const byRoom = new Map<string, WithId<SessionDoc>[]>()
    for (const s of filteredSessions) {
      const id = s.roomId || '__unknown__'
      const list = byRoom.get(id)
      if (list) list.push(s)
      else byRoom.set(id, [s])
    }
    for (const [id, list] of byRoom.entries()) {
      byRoom.set(id, sortSessionsByScheduledStart(list, timeSort))
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
  }, [filteredSessions, sortedRooms, rooms, timeSort])

  const hasRooms = rooms.length > 0

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
      <SessionFilterBar
        idPrefix="sessions"
        search={search}
        onSearchChange={setSearch}
        rooms={rooms}
        roomId={roomId}
        onRoomIdChange={setRoomId}
        dateOptions={dateOptions}
        dateKey={dateKey}
        onDateKeyChange={setDateKey}
        timeBucket={timeBucket}
        onTimeBucketChange={setTimeBucket}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
        showTimeSort
        timeSort={timeSort}
        onTimeSortChange={setTimeSort}
      />

      {filteredSessions.length === 0 ? (
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
