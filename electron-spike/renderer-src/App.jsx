import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  limitToLast,
  onChildAdded,
  onValue,
  orderByChild,
  query,
  ref,
} from 'firebase/database'
import { getOndaSpike } from './ondaSpike.js'
import { createInputMeterTap } from './lib/inputMeterTap.js'
import { getFirebaseConfigStatus, getRendererDatabase } from './lib/firebaseClient.js'
import { networkHealthColor } from './lib/networkHealth.js'

function operatorFeedLabel(feedState) {
  switch (feedState) {
    case 'standby':
      return 'Standby'
    case 'testing':
      return 'Sound check'
    case 'live':
      return 'Live'
    case 'stopping':
      return 'Stopping'
    case 'ended':
      return 'Ended'
    default:
      return feedState || '—'
  }
}

function feedBadgeClass(feedState) {
  if (feedState === 'live') return 'badge badge-live badge-pulse'
  if (feedState === 'testing') return 'badge badge-info'
  if (feedState === 'stopping') return 'badge badge-standby'
  if (feedState === 'ended') return 'badge badge-muted'
  return 'badge badge-muted'
}

function formatMeta(cfg) {
  return [
    `api=${cfg.ondaApiBase || '—'}`,
    `region=${cfg.region || '—'}`,
    `platform=${cfg.platform || '—'}`,
    `projectOk=${cfg.projectCheckOk ? 'yes' : 'NO'}`,
    `apiKey=${cfg.hasApiKey ? 'yes' : 'NO'}`,
    `webhookSecret=${cfg.hasWebhookSecret ? 'yes' : 'NO'}`,
    cfg.sessionId ? `session=${cfg.sessionId}` : null,
    cfg.feedState ? `feed=${cfg.feedState}` : null,
    cfg.recordingId ? `recordingId=${cfg.recordingId}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function CaptionPreview({ sessionId, feedState }) {
  const [chunks, setChunks] = useState([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setChunks([])
    setError('')
    setReady(false)
    if (!sessionId) return undefined
    if (feedState === 'ended') return undefined

    let unsubAdded = () => {}
    let unsubValue = () => {}
    try {
      const db = getRendererDatabase()
      const chunksRef = query(
        ref(db, `liveSessions/${sessionId}/chunks`),
        orderByChild('timestamp'),
        limitToLast(80),
      )
      const onListenError = (err) => {
        setError(err?.message || String(err))
      }
      const seen = new Map()
      unsubAdded = onChildAdded(
        chunksRef,
        (snap) => {
          const val = snap.val()
          if (!val?.text) return
          seen.set(snap.key, { id: snap.key, ...val })
          setChunks(
            Array.from(seen.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
          )
          setReady(true)
        },
        onListenError,
      )
      unsubValue = onValue(chunksRef, () => setReady(true), onListenError)
    } catch (err) {
      setError(err?.message || String(err))
    }
    return () => {
      unsubAdded()
      unsubValue()
    }
  }, [sessionId, feedState])

  if (feedState === 'ended') {
    return (
      <div className="op-caption-empty">Session ended — no live preview available</div>
    )
  }
  if (!sessionId) {
    return <div className="op-caption-empty">Select a session to preview live captions.</div>
  }
  if (error) {
    return <div className="op-caption-empty op-error">{error}</div>
  }
  if (!ready || chunks.length === 0) {
    return (
      <div className="op-caption-empty">
        Waiting for live captions…
        {feedState === 'standby' ? ' Enable sound check to start capture.' : ''}
      </div>
    )
  }
  return (
    <div className="op-caption-scroll" aria-live="polite">
      {chunks.map((c) => (
        <div key={c.id} className="op-caption-line">
          {c.speakerLabel ? <span className="op-caption-speaker">{c.speakerLabel}</span> : null}
          <span>{c.text}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Onda Operator — Slice 2B record surface.
 */
export default function App() {
  const [screen, setScreen] = useState('unlock')
  const [metaText, setMetaText] = useState('Loading…')
  const [logs, setLogs] = useState([])
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const logEndRef = useRef(null)

  const [recording, setRecording] = useState(false)
  const [sdkReady, setSdkReady] = useState(false)
  const [projectCheckOk, setProjectCheckOk] = useState(false)
  const [projectCheckError, setProjectCheckError] = useState(null)

  const [credential, setCredential] = useState(null)
  const [credentialInput, setCredentialInput] = useState('')
  const [unlockBusy, setUnlockBusy] = useState(false)
  const [unlockError, setUnlockError] = useState('')

  const [show, setShow] = useState(null)
  const [sessions, setSessions] = useState([])
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [sessionError, setSessionError] = useState('')

  const [feedState, setFeedState] = useState(null)
  const [sessionLabel, setSessionLabel] = useState(null)
  const [webhookUrl, setWebhookUrl] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [endError, setEndError] = useState('')

  const [meterLevel, setMeterLevel] = useState(0)
  const [outputLabel, setOutputLabel] = useState('—')
  const [networkName, setNetworkName] = useState('—')
  const [lastWebhookRttMs, setLastWebhookRttMs] = useState(null)
  const [lastWebhookOkAt, setLastWebhookOkAt] = useState(null)
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  const appendLog = useCallback((entry) => {
    setLogs((prev) => [
      ...prev,
      {
        level: entry.level || 'info',
        at: entry.at || new Date().toISOString(),
        message: entry.message,
        extra: entry.extra,
      },
    ])
  }, [])

  // Hardware input meter — app-open, independent of session / feedState
  useEffect(() => {
    const tap = createInputMeterTap({
      onSample: (s) => setMeterLevel(s.level),
      onError: (err) => appendLog({ level: 'warn', message: `Mic meter: ${err.message}` }),
    })
    tap.start().catch(() => {})
    return () => {
      tap.stop()
    }
  }, [appendLog])

  useEffect(() => {
    async function refreshOutput() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        const outs = all.filter((d) => d.kind === 'audiooutput')
        const def = outs.find((d) => d.deviceId === 'default') || outs[0]
        setOutputLabel(def?.label || 'Default output')
      } catch {
        setOutputLabel('Output unavailable')
      }
    }
    refreshOutput()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshOutput)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshOutput)
  }, [])

  useEffect(() => {
    function onOnline() {
      setOnline(true)
    }
    function onOffline() {
      setOnline(false)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    getOndaSpike()
      .getNetworkName()
      .then((r) => setNetworkName(r?.name || '—'))
      .catch(() => {})
    const id = window.setInterval(() => {
      getOndaSpike()
        .getNetworkName()
        .then((r) => setNetworkName(r?.name || '—'))
        .catch(() => {})
    }, 15000)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    if (!diagnosticsOpen) return
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [logs, diagnosticsOpen])

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        setDiagnosticsOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const refreshMeta = useCallback(async () => {
    const spike = getOndaSpike()
    const cfg = await spike.getConfig()
    setMetaText(formatMeta(cfg))
    return cfg
  }, [])

  useEffect(() => {
    const spike = getOndaSpike()
    const offLog = spike.onLog(appendLog)
    const offStatus = spike.onStatus((patch) => {
      if (patch.recording !== undefined) setRecording(Boolean(patch.recording))
      if (patch.sdkReady !== undefined) setSdkReady(Boolean(patch.sdkReady))
      if (patch.projectCheckOk !== undefined) setProjectCheckOk(Boolean(patch.projectCheckOk))
      if (patch.projectCheckError !== undefined) {
        setProjectCheckError(patch.projectCheckError || null)
      }
      if (patch.feedState !== undefined) setFeedState(patch.feedState)
      if (patch.webhookUrl !== undefined) setWebhookUrl(patch.webhookUrl)
      if (patch.sessionLabel !== undefined) setSessionLabel(patch.sessionLabel)
      if (patch.lastWebhookRttMs !== undefined) {
        setLastWebhookRttMs(patch.lastWebhookRttMs)
      }
      if (patch.lastWebhookOkAt !== undefined) setLastWebhookOkAt(patch.lastWebhookOkAt)
      spike.getConfig().then((cfg) => setMetaText(formatMeta(cfg)))
    })

    spike.getConfig().then((cfg) => {
      setMetaText(formatMeta(cfg))
      setSdkReady(Boolean(cfg.sdkReady))
      setRecording(Boolean(cfg.recording))
      setProjectCheckOk(Boolean(cfg.projectCheckOk))
      setProjectCheckError(cfg.projectCheckError || null)
      setScreen('unlock')
      const fb = getFirebaseConfigStatus()
      appendLog({
        level: 'info',
        message: `Firebase client config: project=${fb.projectId || '—'} dbUrl=${fb.hasDatabaseUrl} apiKey=${fb.hasApiKey}`,
      })
    })

    return () => {
      offLog?.()
      offStatus?.()
    }
  }, [appendLog])

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId],
  )

  const canControl = projectCheckOk && sdkReady && Boolean(selectedSessionId)
  const capturing =
    feedState === 'testing' || feedState === 'live' || feedState === 'stopping' || recording
  const netColor = networkHealthColor({
    rttMs: lastWebhookRttMs,
    lastOkAt: lastWebhookOkAt,
    online,
    capturing,
  })

  async function handleUnlock() {
    setUnlockError('')
    if (!credentialInput.trim()) {
      setUnlockError('Enter the show tech credential.')
      return
    }
    setUnlockBusy(true)
    try {
      const spike = getOndaSpike()
      const result = await spike.unlock(credentialInput)
      if (!result.ok) {
        setUnlockError(result.error || 'Invalid credential')
        return
      }
      const nextSessions = result.sessions || []
      setCredential(result.credential || credentialInput)
      setShow(result.show)
      setSessions(nextSessions)
      setSelectedSessionId(nextSessions[0]?.id || null)
      setScreen('sessions')
    } finally {
      setUnlockBusy(false)
    }
  }

  async function handleUseSession() {
    setSessionError('')
    setEndError('')
    if (!currentSession || !show || !credential) {
      setSessionError('Select a session first.')
      return
    }
    const spike = getOndaSpike()
    const result = await spike.selectSession({
      credential,
      showId: show.id,
      showName: show.name,
      session: currentSession,
    })
    if (!result.ok) {
      setSessionError(result.error || 'Could not select session')
      return
    }
    setFeedState(currentSession.feedState || 'standby')
    setSessionLabel(currentSession.friendlyName || currentSession.title)
    setWebhookUrl(result.context?.webhookUrl || null)
    setScreen('record')
  }

  async function handleBackUnlock() {
    setCredential(null)
    setShow(null)
    setSessions([])
    setSelectedSessionId(null)
    await getOndaSpike().clearSession()
    setScreen('unlock')
  }

  async function handleChangeSession() {
    setEndError('')
    await getOndaSpike().clearSession()
    setSelectedSessionId(sessions[0]?.id || null)
    setScreen('sessions')
  }

  async function handleSoundCheck() {
    setActionBusy(true)
    setEndError('')
    appendLog({ level: 'info', message: 'Enable sound check clicked' })
    try {
      const result = await getOndaSpike().start()
      if (!result?.ok) {
        appendLog({
          level: 'error',
          message: `Sound check failed: ${result?.error || 'unknown'}`,
          extra: result,
        })
      } else {
        setFeedState('testing')
      }
      await refreshMeta()
    } finally {
      setActionBusy(false)
    }
  }

  async function handleGoLive() {
    setActionBusy(true)
    setEndError('')
    appendLog({ level: 'info', message: 'Go Live clicked' })
    try {
      const result = await getOndaSpike().goLive()
      if (!result?.ok) {
        appendLog({
          level: 'error',
          message: `Go Live failed: ${result?.error || 'unknown'}`,
          extra: result,
        })
      } else {
        setFeedState('live')
      }
      await refreshMeta()
    } finally {
      setActionBusy(false)
    }
  }

  async function handleEndSession() {
    setActionBusy(true)
    // Optimistic Stopping — if API fails, roll back to live with persistent error
    setFeedState('stopping')
    setEndError('')
    appendLog({ level: 'info', message: 'End session clicked (optimistic stopping)' })
    try {
      const result = await getOndaSpike().stop()
      if (!result?.ok) {
        setFeedState(result?.rollbackTo || 'live')
        setEndError(
          result?.error
            ? `End session failed — session is still live. ${result.error} Retry End session.`
            : 'End session failed — session is still live. Retry End session.',
        )
        appendLog({
          level: 'error',
          message: `End failed; rolled back to live: ${result?.error}`,
          extra: result,
        })
      }
      await refreshMeta()
    } finally {
      setActionBusy(false)
    }
  }

  async function playTestTone() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const ctx = new AC()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.08
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
      osc.stop(ctx.currentTime + 0.4)
      window.setTimeout(() => ctx.close(), 500)
    } catch (err) {
      appendLog({ level: 'warn', message: `Test tone failed: ${err?.message}` })
    }
  }

  return (
    <div className="op-shell">
      {screen !== 'unlock' ? (
        <header className="op-header op-header-compact">
          <div className="op-brand-inline">
            <span className="op-brand-mark" aria-hidden="true">
              〜
            </span>
            <span className="op-brand-name">Onda Operator</span>
          </div>
          {show ? (
            <div className="op-header-show text-sm text-muted truncate">{show.name}</div>
          ) : null}
          {screen === 'record' ? (
            <div className="op-header-session">
              <label htmlFor="header-session" className="sr-only">
                Session
              </label>
              <select
                id="header-session"
                className="input input-sm"
                value={selectedSessionId || ''}
                onChange={async (e) => {
                  const id = e.target.value
                  setSelectedSessionId(id)
                  const s = sessions.find((x) => x.id === id)
                  if (s && show && credential) {
                    await getOndaSpike().selectSession({
                      credential,
                      showId: show.id,
                      showName: show.name,
                      session: s,
                    })
                    setFeedState(s.feedState || 'standby')
                    setSessionLabel(s.friendlyName || s.title)
                    setEndError('')
                  }
                }}
                disabled={capturing && feedState !== 'ended'}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.friendlyName || s.title} — {operatorFeedLabel(s.feedState)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </header>
      ) : null}

      {projectCheckOk === false && projectCheckError ? (
        <div className="op-fatal alert alert-error" id="fatal" role="alert">
          {projectCheckError}
        </div>
      ) : null}

      {screen === 'unlock' ? (
        <section id="screen-unlock" className="op-screen op-screen-welcome">
          <div className="op-welcome card">
            <div className="op-welcome-brand">
              <div className="op-brand-mark-lg" aria-hidden="true">
                〜
              </div>
              <h1 className="op-welcome-title">Onda Operator</h1>
              <p className="op-welcome-sub">
                Unlock a show with its shared tech credential to start capturing.
              </p>
            </div>
            <div className="op-row">
              <label htmlFor="credential" className="label">
                Show tech credential
              </label>
              <input
                id="credential"
                className={`input w-full${unlockError ? ' error' : ''}`}
                type="password"
                autoComplete="current-password"
                placeholder="Shared show password"
                value={credentialInput}
                onChange={(e) => setCredentialInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUnlock()
                }}
              />
            </div>
            <div className="op-controls">
              <button
                id="btn-unlock"
                type="button"
                className="btn btn-primary"
                disabled={unlockBusy}
                onClick={handleUnlock}
              >
                Unlock show
              </button>
            </div>
            <div id="unlock-error" className="op-error" role="alert">
              {unlockError}
            </div>
          </div>
        </section>
      ) : null}

      {screen === 'sessions' ? (
        <section id="screen-sessions" className="op-screen op-screen-main">
          <div className="op-row">
            <p className="op-section-kicker text-sm text-muted">
              {show
                ? `${show.name}${show.clientName ? ` · ${show.clientName}` : ''}`
                : 'Show'}
            </p>
            <h2 className="op-section-title">Select a session</h2>
          </div>
          <div className="op-row">
            <label htmlFor="session-select" className="label">
              Session
            </label>
            <select
              id="session-select"
              className="input"
              value={selectedSessionId || ''}
              onChange={(e) => setSelectedSessionId(e.target.value)}
            >
              {sessions.length === 0 ? (
                <option value="">No visible sessions (all drafts?)</option>
              ) : (
                sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {`${s.friendlyName || s.title} — ${operatorFeedLabel(s.feedState)}`}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="op-controls op-controls-primary">
            <button
              id="btn-use-session"
              type="button"
              className="btn btn-primary"
              disabled={!currentSession}
              onClick={handleUseSession}
            >
              Use selected session
            </button>
            <button
              id="btn-back-unlock"
              type="button"
              className="btn btn-secondary"
              onClick={handleBackUnlock}
            >
              Back
            </button>
          </div>
          <div id="session-error" className="op-error" role="alert">
            {sessionError}
          </div>
        </section>
      ) : null}

      {screen === 'record' ? (
        <section id="screen-record" className="op-screen op-screen-operator">
          <div className="op-operator-layout">
            <div className="op-caption-panel" aria-label="Live caption preview">
              <div className="op-caption-frame">
                <CaptionPreview sessionId={selectedSessionId} feedState={feedState} />
              </div>
            </div>

            <div className="op-status-grid">
              <div className="op-grid-cell">
                <div className="op-grid-label">Input</div>
                <div className="op-meter" aria-label={`Input level ${meterLevel}`}>
                  <div className="op-meter-fill" style={{ width: `${meterLevel}%` }} />
                </div>
                <div className="text-sm text-muted">{meterLevel}</div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => getOndaSpike().openOsSettings('sound')}
                >
                  Sound settings
                </button>
              </div>

              <div className="op-grid-cell">
                <div className="op-grid-label">Output</div>
                <div className="op-grid-value truncate" title={outputLabel}>
                  {outputLabel}
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={playTestTone}>
                  Play test tone
                </button>
              </div>

              <div className="op-grid-cell">
                <div className="op-grid-label">Network</div>
                <div className="op-net-row">
                  <span className={`op-net-dot op-net-${netColor}`} aria-label={netColor} />
                  <span className="op-grid-value truncate" title={networkName}>
                    {networkName}
                  </span>
                </div>
                <div className="text-sm text-muted">
                  {lastWebhookRttMs != null ? `${lastWebhookRttMs} ms RTT` : 'No webhook RTT yet'}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => getOndaSpike().openOsSettings('network')}
                >
                  Network settings
                </button>
              </div>

              <div className="op-grid-cell">
                <div className="op-grid-label">Status</div>
                <span className={feedBadgeClass(feedState)}>
                  {feedState === 'live' ? <span className="live-dot" aria-hidden="true" /> : null}
                  {operatorFeedLabel(feedState)}
                </span>
                <div className="op-grid-value" style={{ marginTop: 8 }}>
                  {sessionLabel || '—'}
                </div>
                <div className="text-sm text-muted">{show?.name || ''}</div>
              </div>
            </div>
          </div>

          {endError ? (
            <div className="alert alert-error" role="alert" style={{ marginTop: 16 }}>
              {endError}
            </div>
          ) : null}

          <div className="op-controls op-controls-primary op-controls-below">
            {feedState === 'standby' || !feedState ? (
              <button
                type="button"
                className="btn btn-secondary btn-lg"
                disabled={actionBusy || !canControl}
                onClick={handleSoundCheck}
              >
                Enable sound check
              </button>
            ) : feedState === 'testing' || feedState === 'live' || feedState === 'stopping' ? (
              <span className="badge badge-info">Sound check active</span>
            ) : null}

            {feedState === 'live' || feedState === 'stopping' ? (
              <button
                type="button"
                className="btn btn-danger btn-lg"
                disabled={actionBusy || feedState === 'stopping'}
                onClick={handleEndSession}
              >
                {feedState === 'stopping' ? 'Stopping…' : 'End session'}
              </button>
            ) : feedState === 'ended' ? (
              <span className="badge badge-muted">Ended</span>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={actionBusy || feedState !== 'testing'}
                title={
                  feedState === 'standby' || !feedState
                    ? 'Run sound check first.'
                    : feedState === 'testing'
                      ? 'Go live for attendees'
                      : undefined
                }
                onClick={handleGoLive}
              >
                Go Live
              </button>
            )}

            <button
              type="button"
              className="btn btn-ghost"
              disabled={capturing && feedState !== 'ended' && feedState !== 'stopping'}
              onClick={handleChangeSession}
            >
              Change session
            </button>
          </div>
        </section>
      ) : null}

      {diagnosticsOpen ? (
        <aside className="op-diagnostics" id="diagnostics-panel" aria-label="Diagnostics">
          <div className="op-diagnostics-header">
            <div>
              <div className="font-semibold">Diagnostics</div>
              <div className="text-sm text-muted">Toggle with ⌘⇧D</div>
            </div>
            <div className="op-controls" style={{ gap: 8 }}>
              <a className="btn btn-secondary btn-sm" href="#audio-concurrency-spike">
                Audio concurrency spike
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDiagnosticsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
          <div className="op-meta" id="meta">
            {metaText}
            {webhookUrl ? ` · webhook=${webhookUrl}` : ''}
          </div>
          <div id="log" className="op-log">
            {logs.length === 0 ? (
              <div className="line-debug">No log entries yet.</div>
            ) : (
              logs.map((entry, i) => (
                <div key={`${entry.at}-${i}`} className={`line-${entry.level}`}>
                  {`[${entry.at}] ${entry.message}${
                    entry.extra ? ` ${JSON.stringify(entry.extra)}` : ''
                  }`}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </aside>
      ) : null}
    </div>
  )
}
