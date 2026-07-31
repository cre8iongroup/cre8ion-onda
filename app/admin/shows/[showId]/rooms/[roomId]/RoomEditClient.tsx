'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { getClientFirestore, getClientStorage } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import { renameRoomDualWrite } from '@/lib/rooms'
import type { RoomDoc, ShowDoc, ShowRoom, WithId } from '@/types'
import QrCodeCard from '@/app/admin/components/QrCodeCard'
import { roomPublicUrl } from '@/lib/attendee/urls'

export default function RoomEditClient({
  showId,
  roomId,
}: {
  showId: string
  roomId: string
}) {
  const { capabilities } = useAuthContext()
  const canEdit = Boolean(capabilities?.canEditShows || capabilities?.canCreateShows)
  const canDownload = Boolean(capabilities?.canDownloadQr)
  const canGenerate = canEdit
  const readOnlyQr = canDownload && !canEdit

  const [show, setShow] = useState<WithId<ShowDoc> | null>(null)
  const [room, setRoom] = useState<WithId<RoomDoc> | null>(null)
  const [name, setName] = useState('')
  const [inherit, setInherit] = useState(true)
  const [logoUrl, setLogoUrl] = useState('')
  const [backgroundColor, setBackgroundColor] = useState('#0a0a0f')
  const [textColor, setTextColor] = useState('#f0f0fa')
  const [accent1, setAccent1] = useState('#5b3aee')
  const [accent2, setAccent2] = useState('#00d4aa')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    const fs = getClientFirestore()
    const unsubShow = onSnapshot(doc(fs, 'shows', showId), (snap) => {
      if (snap.exists()) setShow({ id: snap.id, ...(snap.data() as ShowDoc) })
    })
    const unsubRoom = onSnapshot(doc(fs, 'shows', showId, 'rooms', roomId), (snap) => {
      if (!snap.exists()) {
        setRoom(null)
        return
      }
      const data = snap.data() as RoomDoc
      setRoom({ id: snap.id, ...data })
      setName(data.name)
      setInherit(data.branding?.inherit !== false)
      setLogoUrl(data.branding?.logoUrl || '')
      setBackgroundColor(data.branding?.backgroundColor || '#0a0a0f')
      setTextColor(data.branding?.textColor || '#f0f0fa')
      setAccent1(data.branding?.accentColors?.[0] || '#5b3aee')
      setAccent2(data.branding?.accentColors?.[1] || '#00d4aa')
    })
    return () => {
      unsubShow()
      unsubRoom()
    }
  }, [showId, roomId])

  async function save() {
    if (!canEdit || !room || !show) return
    setBusy(true)
    setError(null)
    try {
      const fs = getClientFirestore()
      const rooms = (show.rooms ?? []) as ShowRoom[]
      if (name.trim() !== room.name) {
        await renameRoomDualWrite(fs, showId, rooms, roomId, name)
      }
      await updateDoc(doc(fs, 'shows', showId, 'rooms', roomId), {
        branding: inherit
          ? { inherit: true }
          : {
              inherit: false,
              logoUrl: logoUrl || undefined,
              backgroundColor,
              textColor,
              accentColors: [accent1, accent2],
            },
      })
      setFlash('Room saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save room.')
    } finally {
      setBusy(false)
    }
  }

  if (!room) {
    return (
      <div className="panel-content">
        <p style={{ color: 'var(--color-text-muted)' }}>Loading room…</p>
      </div>
    )
  }

  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Link href={`/admin/shows/${showId}`} className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          ← {show?.name || 'Show'}
        </Link>
      </div>
      <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>
        {readOnlyQr ? 'Room QR' : 'Edit room'}
      </h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>{room.name}</p>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-8)' }}>
        <a
          href={roomPublicUrl(roomId)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit' }}
        >
          /room/{roomId}
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
            <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="label" htmlFor="room-name">Name</label>
              <input
                id="room-name"
                className="input"
                value={name}
                disabled={!canEdit || busy}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <label className="checkbox-row" style={{ marginBottom: 'var(--space-4)' }}>
              <input
                type="checkbox"
                checked={inherit}
                disabled={!canEdit || busy}
                onChange={(e) => setInherit(e.target.checked)}
              />
              <span>Inherit show branding</span>
            </label>
            {!inherit ? (
              <>
                <div className="field-row" style={{ flexWrap: 'wrap' }}>
                  <div className="field">
                    <label className="label">Background</label>
                    <input type="color" className="input" value={backgroundColor} disabled={!canEdit || busy} onChange={(e) => setBackgroundColor(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">Text</label>
                    <input type="color" className="input" value={textColor} disabled={!canEdit || busy} onChange={(e) => setTextColor(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">Accent 1</label>
                    <input type="color" className="input" value={accent1} disabled={!canEdit || busy} onChange={(e) => setAccent1(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">Accent 2</label>
                    <input type="color" className="input" value={accent2} disabled={!canEdit || busy} onChange={(e) => setAccent2(e.target.value)} />
                  </div>
                </div>
                <div className="field" style={{ marginTop: 'var(--space-4)' }}>
                  <label className="label">Room logo override</label>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={!canEdit || busy}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const ext = file.name.split('.').pop() || 'png'
                      const storageRef = ref(getClientStorage(), `shows/${showId}/rooms/${roomId}/logo.${ext}`)
                      await uploadBytes(storageRef, file)
                      setLogoUrl(await getDownloadURL(storageRef))
                    }}
                  />
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" style={{ maxHeight: 40, marginTop: 8 }} />
                  ) : null}
                </div>
              </>
            ) : null}
            {canEdit ? (
              <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }} disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save room'}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <QrCodeCard
        type="room"
        showId={showId}
        id={roomId}
        label={room.name}
        deepLinkPath={`/room/${roomId}`}
        canGenerate={canGenerate}
        canDownload={canDownload}
        existingUrl={room.qrCodeUrl}
      />
    </div>
  )
}
