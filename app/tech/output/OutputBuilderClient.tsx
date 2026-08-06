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
import {
  clearTechCheckIn,
  techCheckInHref,
  writeTechCheckIn,
} from '@/lib/tech/checkIn'
import ColorField from '@/components/ColorField'
import type {
  OutputLayoutDoc,
  OutputWindowConfig,
  RoomDoc,
  ShowDoc,
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
  const isAdmin = userDoc?.baseRole === 'admin'

  const deepShowId = searchParams.get('showId')
  const deepRoomId = searchParams.get('roomId')
  // Parked: Operator Electron link-out that auto-fills ?roomId= from selectedRoomId
  // belongs in a deliberate Operator rebuild cycle — not this pass. Until then,
  // paste Builder URLs into show operatorInstructions markdown per room.

  // Hydrate from the URL on first paint so we do not flash-spinner / race the
  // resolve-room effect while showId/roomId state are still null.
  const [showId, setShowId] = useState<string | null>(() => deepShowId)
  const [roomId, setRoomId] = useState<string | null>(() => deepRoomId)
  const [show, setShow] = useState<WithId<ShowDoc> | null>(null)
  const [rooms, setRooms] = useState<WithId<RoomDoc>[]>([])
  const [windows, setWindows] = useState<OutputWindowConfig[] | null>(null)
  const [presets, setPresets] = useState<WithId<OutputLayoutDoc>[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [needsSeed, setNeedsSeed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [resolvingRoom, setResolvingRoom] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const liveTimer = useRef<number | null>(null)
  const persistTimer = useRef<number | null>(null)
  const seededRef = useRef(false)
  // Keep room-listener callback current without re-subscribing when show loads.
  const primaryLanguageRef = useRef('en')

  const brandTextColor = show?.branding?.textColor || '#f0f0fa'
  const primaryLanguage = show?.defaultLanguages?.[0] || 'en'
  primaryLanguageRef.current = primaryLanguage
  const canManagePresets = Boolean(capabilities?.canManageOutputLayouts)

  const selectedRoomName = useMemo(() => {
    if (!roomId) return null
    const fromSub = rooms.find((r) => r.id === roomId)
    if (fromSub) return fromSub.name
    const fromDenorm = (show?.rooms || []).find((r) => r.id === roomId)
    return fromDenorm?.name || null
  }, [roomId, rooms, show?.rooms])

  // Resolve showId: deep link → assigned tech show
  useEffect(() => {
    if (deepShowId && (isAdmin || assignedShows.length === 0 || assignedShows.includes(deepShowId))) {
      setShowId(deepShowId)
      return
    }
    if (!isAdmin && assignedShows.length === 1) {
      setShowId(assignedShows[0])
    }
  }, [assignedShows, deepShowId, isAdmin])

  useEffect(() => {
    if (deepRoomId) setRoomId(deepRoomId)
  }, [deepRoomId])

  // When roomId is present but showId is not, resolve via authenticated API.
  // Skip when ?showId= is already in the URL — otherwise first paint has
  // showId state still null, this effect sets resolvingRoom=true, then the
  // showId-hydration effect cancels us and finally{} never clears the flag
  // → permanent spinner (Listen/channel still runs under the spinner).
  useEffect(() => {
    if (!deepRoomId || showId || deepShowId || !user) return
    let cancelled = false
    setResolvingRoom(true)
    void (async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(
          `/api/tech/resolve-room?roomId=${encodeURIComponent(deepRoomId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        const json = (await res.json().catch(() => ({}))) as {
          showId?: string
          error?: string
        }
        if (cancelled) return
        if (!res.ok || !json.showId) {
          setError(json.error || 'Could not resolve room to a show.')
          return
        }
        setShowId(json.showId)
        setRoomId(deepRoomId)
        const params = new URLSearchParams()
        params.set('showId', json.showId)
        params.set('roomId', deepRoomId)
        router.replace(`/tech/output?${params.toString()}`)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to resolve room.')
        }
      } finally {
        if (!cancelled) setResolvingRoom(false)
      }
    })()
    return () => {
      cancelled = true
      setResolvingRoom(false)
    }
  }, [deepRoomId, deepShowId, showId, user, router])

  // No room in URL → room check-in (unless still resolving a deep-linked room)
  useEffect(() => {
    if (resolvingRoom) return
    if (deepRoomId) return
    if (!roomId) {
      router.replace(techCheckInHref(showId || deepShowId))
    }
  }, [resolvingRoom, deepRoomId, roomId, showId, deepShowId, router])

  // Deep link / in-room URL counts as checked in once room name is known
  useEffect(() => {
    if (!showId || !roomId || !selectedRoomName) return
    writeTechCheckIn({
      showId,
      roomId,
      roomName: selectedRoomName,
      showName: show?.name,
    })
  }, [showId, roomId, selectedRoomName, show?.name])

  // Load show
  useEffect(() => {
    if (!showId) {
      setLoading(false)
      setShow(null)
      return
    }
    setLoading(true)
    const fs = getClientFirestore()
    return onSnapshot(
      doc(fs, 'shows', showId),
      (snap) => {
        if (!snap.exists()) {
          setError('Show not found.')
          setShow(null)
          setLoading(false)
          return
        }
        setShow({ id: snap.id, ...(snap.data() as ShowDoc) })
        setError(null)
      },
      (err) => {
        setError(err.message || 'Failed to load show.')
        setLoading(false)
      },
    )
  }, [showId])

  // Load rooms subcollection
  useEffect(() => {
    if (!showId) {
      setRooms([])
      return
    }
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

  // Load selected room config — subscribe once per showId/roomId.
  // primaryLanguage is read via ref so show hydration does not tear down Listen.
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
        const lang = primaryLanguageRef.current
        if (data.outputConfig && Array.isArray(data.outputConfig.windows) && data.outputConfig.windows.length > 0) {
          setWindows(ensureWindowCount(data.outputConfig.windows, lang))
          setNeedsSeed(false)
          // Hydrate RTDB once when opening an existing config
          if (!seededRef.current) {
            seededRef.current = true
            void writeOutputLive(roomId, ensureWindowCount(data.outputConfig.windows, lang)).catch(
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
  }, [showId, roomId])


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

  function changeRoom() {
    const keepShowId = showId
    setRoomId(null)
    setWindows(null)
    setNeedsSeed(false)
    clearTechCheckIn()
    router.push(techCheckInHref(keepShowId))
  }

  if (resolvingRoom || (loading && !show && Boolean(showId)) || !roomId) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
        <span className="spinner" aria-label="Loading" />
      </div>
    )
  }

  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-10)' }}>
        <div
          className="flex"
          style={{
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>
              {selectedRoomName
                ? `Output Builder — ${selectedRoomName}`
                : 'Output Builder'}
            </h1>
            <p style={{ color: 'var(--color-text-secondary)' }}>
              {show?.name || 'Show'}
              {' · Configure live caption output windows. Open the Output Windows to preview.'}
            </p>
          </div>
          <button
            type="button"
            id="btn-output-change-room"
            className="btn btn-ghost btn-sm"
            onClick={changeRoom}
            style={{ flexShrink: 0, marginTop: 'var(--space-1)' }}
          >
            ← Change room
          </button>
        </div>
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

      {needsSeed && !windows ? (
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
          <div style={{ marginBottom: 'var(--space-8)' }}>
            <div className="flex" style={{ gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
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
            </div>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: 0 }}>
              {saving ? 'Saving…' : 'Changes sync live to open Output Windows'}
            </p>
          </div>

          <div className="output-builder-windows">
            {windows.slice(0, OUTPUT_BUILDER_WINDOW_COUNT).map((w, index) => {
              const inherited = !w.textColor
              const textDisplay = w.textColor || brandTextColor
              return (
                <section
                  key={index}
                  className="card output-builder-window"
                  aria-label={`Window ${index + 1}`}
                >
                  <h2 className="output-builder-window-title">
                    Window {index + 1}
                  </h2>

                  <div className="output-builder-section">
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

                  <div className="output-builder-section">
                    <label className="label" htmlFor={`ow-font-${index}`}>Font size</label>
                    <div className="output-builder-font-row">
                      <input
                        id={`ow-font-${index}`}
                        className="output-builder-font-slider"
                        type="range"
                        min={16}
                        max={120}
                        value={w.fontSize}
                        onChange={(e) => updateWindow(index, { fontSize: Number(e.target.value) })}
                        aria-valuetext={`${w.fontSize} pixels`}
                      />
                      <span className="output-builder-font-value" aria-hidden>
                        {w.fontSize}px
                      </span>
                    </div>
                  </div>

                  <div className="output-builder-section">
                    <ColorField
                      id={`ow-bg-${index}`}
                      label="Background"
                      value={w.backgroundColor}
                      onChange={(hex) => updateWindow(index, { backgroundColor: hex })}
                    />
                    <div className="flex gap-2" style={{ flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
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
                  </div>

                  <div className="output-builder-section output-builder-section-last">
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
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
                    <ColorField
                      id={`ow-text-${index}`}
                      label="Text color"
                      value={textDisplay}
                      onChange={(hex) => updateWindow(index, { textColor: hex })}
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
