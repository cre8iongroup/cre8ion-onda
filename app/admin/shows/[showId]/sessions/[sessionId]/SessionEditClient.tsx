'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { doc, onSnapshot, updateDoc, Timestamp } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import type { SessionDoc, ShowDoc, WithId } from '@/types'
import QrCodeCard from '@/app/admin/components/QrCodeCard'
import { sessionPublicUrl } from '@/lib/attendee/urls'

function toLocalInput(ts?: Timestamp): string {
  if (!ts) return ''
  const d = ts.toDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SessionEditClient({
  showId,
  sessionId,
}: {
  showId: string
  sessionId: string
}) {
  const { capabilities } = useAuthContext()
  const canEdit = Boolean(capabilities?.canEditShows || capabilities?.canCreateShows)
  const canDownload = Boolean(capabilities?.canDownloadQr)
  const canGenerate = canEdit
  const readOnlyQr = canDownload && !canEdit

  const [show, setShow] = useState<WithId<ShowDoc> | null>(null)
  const [session, setSession] = useState<WithId<SessionDoc> | null>(null)
  const [title, setTitle] = useState('')
  const [friendlyName, setFriendlyName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [scheduledStart, setScheduledStart] = useState('')
  const [scheduledEnd, setScheduledEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    const fs = getClientFirestore()
    const unsubShow = onSnapshot(doc(fs, 'shows', showId), (snap) => {
      if (snap.exists()) setShow({ id: snap.id, ...(snap.data() as ShowDoc) })
    })
    const unsubSession = onSnapshot(doc(fs, 'shows', showId, 'sessions', sessionId), (snap) => {
      if (!snap.exists()) {
        setSession(null)
        return
      }
      const data = { id: snap.id, ...(snap.data() as SessionDoc) }
      setSession(data)
      setTitle(data.title)
      setFriendlyName(data.friendlyName)
      setRoomId(data.roomId)
      setScheduledStart(toLocalInput(data.scheduledStart))
      setScheduledEnd(toLocalInput(data.scheduledEnd))
    })
    return () => {
      unsubShow()
      unsubSession()
    }
  }, [showId, sessionId])

  async function save() {
    if (!canEdit || !session) return
    setBusy(true)
    setError(null)
    try {
      const start = new Date(scheduledStart)
      const end = new Date(scheduledEnd)
      if (!(end > start)) throw new Error('End time must be after start time')
      await updateDoc(doc(getClientFirestore(), 'shows', showId, 'sessions', sessionId), {
        title: title.trim(),
        friendlyName: friendlyName.trim(),
        roomId,
        scheduledStart: Timestamp.fromDate(start),
        scheduledEnd: Timestamp.fromDate(end),
      })
      setFlash('Session saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save session.')
    } finally {
      setBusy(false)
    }
  }

  if (!session) {
    return (
      <div className="panel-content">
        <p style={{ color: 'var(--color-text-muted)' }}>Loading session…</p>
      </div>
    )
  }

  const rooms = show?.rooms ?? []

  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Link href={`/admin/shows/${showId}`} className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          ← {show?.name || 'Show'}
        </Link>
      </div>
      <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>
        {readOnlyQr ? 'Session QR' : 'Edit session'}
      </h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
        {session.friendlyName || session.title}
      </p>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-8)' }}>
        <a
          href={sessionPublicUrl(sessionId)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit' }}
        >
          /session/{sessionId}
        </a>
      </p>

      {flash && (
        <div className="alert alert-success" role="status" style={{ marginBottom: 'var(--space-6)' }}>
          {flash}
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error}
        </div>
      )}

      {!readOnlyQr ? (
        <section style={{ marginBottom: 'var(--space-8)' }}>
          <div className="card" style={{ padding: 'var(--space-5)' }}>
            <div className="field">
              <label className="label" htmlFor="sess-title">Title</label>
              <input id="sess-title" className="input" value={title} disabled={!canEdit || busy} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="sess-friendly">Friendly name</label>
              <input id="sess-friendly" className="input" value={friendlyName} disabled={!canEdit || busy} onChange={(e) => setFriendlyName(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="sess-room">Room</label>
              <select id="sess-room" className="input" value={roomId} disabled={!canEdit || busy} onChange={(e) => setRoomId(e.target.value)}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label className="label" htmlFor="sess-start">Start</label>
                <input id="sess-start" type="datetime-local" className="input" value={scheduledStart} disabled={!canEdit || busy} onChange={(e) => setScheduledStart(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="sess-end">End</label>
                <input id="sess-end" type="datetime-local" className="input" value={scheduledEnd} disabled={!canEdit || busy} onChange={(e) => setScheduledEnd(e.target.value)} />
              </div>
            </div>
            {canEdit ? (
              <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }} disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save session'}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <QrCodeCard
        type="session"
        showId={showId}
        id={sessionId}
        label={session.friendlyName || session.title}
        deepLinkPath={`/session/${sessionId}`}
        canGenerate={canGenerate}
        canDownload={canDownload}
        existingUrl={session.qrCodeUrl}
      />
    </div>
  )
}
