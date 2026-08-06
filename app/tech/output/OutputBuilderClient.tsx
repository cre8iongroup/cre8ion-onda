'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { useRouter, useSearchParams } from 'next/navigation'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import {
  DEFAULT_OUTPUT_BACKGROUND,
  DEFAULT_OUTPUT_FONT_SIZE_PX,
  OUTPUT_BUILDER_WINDOW_COUNT,
  OUTPUT_CHROMA_GREEN,
  isOutputPresetDoc,
  sanitizeOutputWindows,
  seedOutputWindows,
} from '@/lib/output/defaults'
import { writeOutputLive, writeRoomOutputConfig } from '@/lib/output/writeLiveConfig'
import type {
  OutputLayoutDoc,
  OutputWindowConfig,
  RoomDoc,
  ShowDoc,
  ShowRoom,
  WithId,
} from '@/types'

const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' },
]

const BG_SWATCHES = [
  { value: '#000000', label: 'Black' },
  { value: '#FFFFFF', label: 'White' },
  { value: OUTPUT_CHROMA_GREEN, label: 'Chroma key' },
]

function ensureWindowCount(
  windows: OutputWindowConfig[],
  primaryLanguage: string,
  count = OUTPUT_BUILDER_WINDOW_COUNT,
): OutputWindowConfig[] {
  const next = sanitizeOutputWindows(windows)
  while (next.length < count) {
    next.push({
      language: next.length === 0 ? primaryLanguage : null,
      fontSize: DEFAULT_OUTPUT_FONT_SIZE_PX,
      backgroundColor: DEFAULT_OUTPUT_BACKGROUND,
    })
  }
  // Keep any windows beyond the Builder UI count (data layer is not hard-capped at 2).
  return next
}

export default function OutputBuilderClient() {
  const { user, userDoc, capabilities } = useAuthContext()
  const searchParams = useSearchParams()
  const router = useRouter()

  const assignedShows = useMemo(
    () => (Array.isArray(userDoc?.assignedShows) ? userDoc!.assignedShows : []),
    [userDoc],
  )

  const deepShowId = searchParams.get('showId')
  const deepRoomId = searchParams.get('roomId')
  // Parked: Operator Electron link-out that auto-fills ?roomId= from selectedRoomId
  // belongs in a deliberate Operator rebuild cycle — not this pass. Until then,
  // paste Builder URLs into show operatorInstructions markdown per room.

  const [showId, setShowId] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [show, setShow] = useState<WithId<ShowDoc> | null>(null)
  const [rooms, setRooms] = useState<WithId<RoomDoc>[]>([])
  const [windows, setWindows] = useState<OutputWindowConfig[] | null>(null)
  const [presets, setPresets] = useState<WithId<OutputLayoutDoc>[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [needsSeed, setNeedsSeed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const liveTimer = useRef<number | null>(null)
  const persistTimer = useRef<number | null>(null)
  const seededRef = useRef(false)

  const brandTextColor = show?.branding?.textColor || '#f0f0fa'
  const primaryLanguage = show?.defaultLanguages?.[0] || 'en'
  const canManagePresets = Boolean(capabilities?.canManageOutputLayouts)

  // Resolve initial show from assignedShows / deep link
  useEffect(() => {
    if (deepShowId && (assignedShows.length === 0 || assignedShows.includes(deepShowId) || userDoc?.baseRole === 'admin')) {
      setShowId(deepShowId)
      return
    }
    if (assignedShows[0]) setShowId(assignedShows[0])
  }, [assignedShows, deepShowId, userDoc?.baseRole])

  useEffect(() => {
    if (deepRoomId) setRoomId(deepRoomId)
  }, [deepRoomId])

  // Load show
  useEffect(() => {
    if (!showId) {
      setLoading(false)
      return
    }
    const fs = getClientFirestore()
    return onSnapshot(
      doc(fs, 'shows', showId),
      (snap) => {
        if (!snap.exists()) {
          setError('Show not found.')
          setShow(null)
          return
        }
        setShow({ id: snap.id, ...(snap.data() as ShowDoc) })
        setError(null)
      },
      (err) => setError(err.message || 'Failed to load show.'),
    )
  }, [showId])

  // Load rooms subcollection
  useEffect(() => {
    if (!showId) return
    const fs = getClientFirestore()
    return onSnapshot(
      collection(fs, 'shows', showId, 'rooms'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as RoomDoc) }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        setRooms(list)
        setLoading(false)
      },
      (err) => {
        setError(err.message || 'Failed to load rooms.')
        setLoading(false)
      },
    )
  }, [showId])

  // If deep roomId but show not set: find room among loaded rooms once rooms arrive
  useEffect(() => {
    if (!deepRoomId || showId) return
    // Admin with empty assignedShows may need to pick show first — leave as-is
  }, [deepRoomId, showId])

  // Load selected room config
  useEffect(() => {
    if (!showId || !roomId) {
      setWindows(null)
      setNeedsSeed(false)
      seededRef.current = false
      return
    }
    seededRef.current = false
    const fs = getClientFirestore()
    return onSnapshot(
      doc(fs, 'shows', showId, 'rooms', roomId),
      (snap) => {
        if (!snap.exists()) {
          setError('Room not found.')
          setWindows(null)
          return
        }
        const data = snap.data() as RoomDoc
        if (data.outputConfig && Array.isArray(data.outputConfig.windows) && data.outputConfig.windows.length > 0) {
          setWindows(ensureWindowCount(data.outputConfig.windows, primaryLanguage))
          setNeedsSeed(false)
          // Hydrate RTDB once when opening an existing config
          if (!seededRef.current) {
            seededRef.current = true
            void writeOutputLive(roomId, ensureWindowCount(data.outputConfig.windows, primaryLanguage)).catch(
              (err) => console.warn('outputLive hydrate failed', err),
            )
          }
        } else {
          setNeedsSeed(true)
          setWindows(null)
        }
      },
      (err) => setError(err.message || 'Failed to load room.'),
    )
  }, [showId, roomId, primaryLanguage])

  // Presets for first-run apply
  useEffect(() => {
    if (!canManagePresets && !user) return
    const fs = getClientFirestore()
    const q = query(collection(fs, 'outputLayouts'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, (snap) => {
      const next: WithId<OutputLayoutDoc>[] = []
      for (const d of snap.docs) {
        if (isOutputPresetDoc(d.data())) {
          next.push({ id: d.id, ...(d.data() as OutputLayoutDoc) })
        }
      }
      setPresets(next)
    })
  }, [canManagePresets, user])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 3500)
    return () => window.clearTimeout(t)
  }, [flash])

  const pushLive = useCallback((next: OutputWindowConfig[]) => {
    if (!roomId) return
    if (liveTimer.current) window.clearTimeout(liveTimer.current)
    liveTimer.current = window.setTimeout(() => {
      void writeOutputLive(roomId, next).catch((err) => {
        console.error('outputLive write failed', err)
        setError(err instanceof Error ? err.message : 'Failed to sync live output.')
      })
    }, 75)
  }, [roomId])

  const pushPersist = useCallback((next: OutputWindowConfig[]) => {
    if (!showId || !roomId || !user) return
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      setSaving(true)
      void writeRoomOutputConfig(showId, roomId, next, user.uid)
        .catch((err) => {
          console.error('outputConfig write failed', err)
          setError(err instanceof Error ? err.message : 'Failed to save output config.')
        })
        .finally(() => setSaving(false))
    }, 450)
  }, [showId, roomId, user])

  const applyWindows = useCallback((next: OutputWindowConfig[]) => {
    const normalized = ensureWindowCount(next, primaryLanguage)
    setWindows(normalized)
    setNeedsSeed(false)
    pushLive(normalized)
    pushPersist(normalized)
  }, [primaryLanguage, pushLive, pushPersist])

  function updateWindow(index: number, patch: Partial<OutputWindowConfig>) {
    if (!windows) return
    const next = windows.map((w, i) => {
      if (i !== index) return w
      const merged: OutputWindowConfig = {
        language: patch.language !== undefined ? patch.language : w.language,
        fontSize: patch.fontSize !== undefined ? patch.fontSize : w.fontSize,
        backgroundColor: patch.backgroundColor !== undefined ? patch.backgroundColor : w.backgroundColor,
      }
      if (patch.textColor !== undefined) {
        if (patch.textColor && patch.textColor.trim()) merged.textColor = patch.textColor.trim()
        // else omit → inherit
      } else if (w.textColor) {
        merged.textColor = w.textColor
      }
      return merged
    })
    applyWindows(next)
  }

  function seedDefaults() {
    applyWindows(seedOutputWindows(primaryLanguage, OUTPUT_BUILDER_WINDOW_COUNT))
    setFlash('Started with default two-window config.')
  }

  function applyPreset() {
    const preset = presets.find((p) => p.id === selectedPresetId)
    if (!preset) return
    applyWindows(ensureWindowCount(preset.windows, primaryLanguage))
    setFlash(`Applied preset “${preset.name}”. Room config is now independent.`)
  }

  function openWindow(index: number) {
    if (!roomId) return
    window.open(`/output/${encodeURIComponent(roomId)}/${index}`, `onda-output-${roomId}-${index}`)
  }

  function selectRoom(nextRoomId: string) {
    setRoomId(nextRoomId || null)
    const params = new URLSearchParams()
    if (showId) params.set('showId', showId)
    if (nextRoomId) params.set('roomId', nextRoomId)
    router.replace(`/tech/output?${params.toString()}`)
  }

  const denormRooms: ShowRoom[] = useMemo(() => {
    if (rooms.length > 0) return rooms.map((r) => ({ id: r.id, name: r.name }))
    return Array.isArray(show?.rooms) ? show!.rooms! : []
  }, [rooms, show])

  const showPickerOptions = assignedShows.length > 1 || userDoc?.baseRole === 'admin'

  if (loading && !show) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
        <span className="spinner" aria-label="Loading" />
      </div>
    )
  }

  if (!showId) {
    return (
      <div className="alert alert-warning" role="status">
        This tech account is not assigned to a show. Ask an admin to provision tech login for the show.
      </div>
    )
  }

  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>Output Builder</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Configure live caption output windows for one room. Open the Output Windows to preview — there is no in-page preview.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error}
        </div>
      )}
      {flash && (
        <div className="alert alert-success" role="status" style={{ marginBottom: 'var(--space-6)' }}>
          {flash}
        </div>
      )}

      <div className="field-row" style={{ marginBottom: 'var(--space-6)' }}>
        {showPickerOptions ? (
          <div className="field">
            <label htmlFor="output-show" className="label">Show</label>
            <select
              id="output-show"
              className="input"
              value={showId}
              onChange={(e) => {
                setShowId(e.target.value)
                setRoomId(null)
                router.replace(`/tech/output?showId=${encodeURIComponent(e.target.value)}`)
              }}
            >
              {(assignedShows.length ? assignedShows : [showId]).map((id) => (
                <option key={id} value={id}>
                  {id === show?.id ? show.name : id}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field">
            <span className="label">Show</span>
            <p style={{ marginTop: 'var(--space-2)' }}>{show?.name || showId}</p>
          </div>
        )}

        <div className="field">
          <label htmlFor="output-room" className="label">Room</label>
          <select
            id="output-room"
            className="input"
            value={roomId || ''}
            onChange={(e) => selectRoom(e.target.value)}
          >
            <option value="">Select a room…</option>
            {denormRooms.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      {!roomId ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Select a room to edit its output windows.</p>
      ) : needsSeed && !windows ? (
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>
            First-time setup
          </h2>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            This room has no output config yet. Apply a preset or start from defaults
            (window 1 = {primaryLanguage}, window 2 = unset).
          </p>
          {presets.length > 0 && (
            <div className="field-row" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="field">
                <label htmlFor="output-preset" className="label">Preset</label>
                <select
                  id="output-preset"
                  className="input"
                  value={selectedPresetId}
                  onChange={(e) => setSelectedPresetId(e.target.value)}
                >
                  <option value="">Select a preset…</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ alignSelf: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!selectedPresetId}
                  onClick={applyPreset}
                >
                  Apply preset
                </button>
              </div>
            </div>
          )}
          <button type="button" className="btn btn-primary" onClick={seedDefaults}>
            Start with defaults
          </button>
        </div>
      ) : windows ? (
        <>
          <div className="flex gap-3" style={{ marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
            {windows.slice(0, OUTPUT_BUILDER_WINDOW_COUNT).map((_, i) => (
              <button
                key={i}
                type="button"
                className="btn btn-secondary"
                onClick={() => openWindow(i)}
              >
                Open Window {i + 1}
              </button>
            ))}
            <span className="text-sm" style={{ color: 'var(--color-text-muted)', alignSelf: 'center' }}>
              {saving ? 'Saving…' : 'Changes sync live to open Output Windows'}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 'var(--space-6)',
            }}
          >
            {windows.slice(0, OUTPUT_BUILDER_WINDOW_COUNT).map((w, index) => {
              const inherited = !w.textColor
              const textDisplay = w.textColor || brandTextColor
              return (
                <section
                  key={index}
                  className="card"
                  style={{ padding: 'var(--space-5)' }}
                  aria-label={`Window ${index + 1}`}
                >
                  <h2 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-4)' }}>
                    Window {index + 1}
                  </h2>

                  <div className="field">
                    <label className="label" htmlFor={`ow-lang-${index}`}>Language</label>
                    <select
                      id={`ow-lang-${index}`}
                      className="input"
                      value={w.language || ''}
                      onChange={(e) =>
                        updateWindow(index, {
                          language: e.target.value ? e.target.value : null,
                        })
                      }
                    >
                      <option value="">Unset</option>
                      {LANGS.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label className="label" htmlFor={`ow-font-${index}`}>
                      Font size ({w.fontSize}px)
                    </label>
                    <input
                      id={`ow-font-${index}`}
                      type="range"
                      min={16}
                      max={120}
                      value={w.fontSize}
                      onChange={(e) => updateWindow(index, { fontSize: Number(e.target.value) })}
                    />
                    <input
                      type="number"
                      className="input"
                      min={12}
                      max={200}
                      value={w.fontSize}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (Number.isFinite(n)) updateWindow(index, { fontSize: n })
                      }}
                      style={{ marginTop: 'var(--space-2)' }}
                    />
                  </div>

                  <div className="field">
                    <label className="label" htmlFor={`ow-bg-${index}`}>Background</label>
                    <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                      {BG_SWATCHES.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => updateWindow(index, { backgroundColor: s.value })}
                        >
                          <span
                            aria-hidden
                            style={{
                              display: 'inline-block',
                              width: 12,
                              height: 12,
                              background: s.value,
                              border: '1px solid var(--color-border)',
                              marginRight: 6,
                              verticalAlign: 'middle',
                            }}
                          />
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <input
                      id={`ow-bg-${index}`}
                      className="input"
                      value={w.backgroundColor}
                      onChange={(e) => updateWindow(index, { backgroundColor: e.target.value })}
                    />
                  </div>

                  <div className="field">
                    <label className="label" htmlFor={`ow-text-${index}`}>Text color</label>
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                      {inherited ? 'Inherited from brand' : 'Custom override'}
                      {inherited ? (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => updateWindow(index, { textColor: brandTextColor })}
                          >
                            Override
                          </button>
                        </>
                      ) : (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => updateWindow(index, { textColor: '' })}
                          >
                            Use brand
                          </button>
                        </>
                      )}
                    </p>
                    <input
                      id={`ow-text-${index}`}
                      type="color"
                      className="input"
                      value={/^#[0-9A-Fa-f]{6}$/.test(textDisplay) ? textDisplay : '#f0f0fa'}
                      onChange={(e) => updateWindow(index, { textColor: e.target.value })}
                    />
                    <input
                      className="input"
                      style={{ marginTop: 'var(--space-2)' }}
                      value={textDisplay}
                      onChange={(e) => updateWindow(index, { textColor: e.target.value })}
                    />
                  </div>
                </section>
              )
            })}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-12)' }}>
          <span className="spinner" aria-label="Loading room config" />
        </div>
      )}
    </div>
  )
}
