import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getOndaSpike } from './ondaSpike.js'

/**
 * Visual badge class for lifecycleStatus (existing .badge-* tokens).
 * live → green success + pulse (operator "in progress"), not Admin feed-red.
 */
function lifecycleBadgeClass(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'live') return 'badge badge-success badge-pulse'
  if (s === 'stopping') return 'badge badge-standby'
  if (s === 'ended') return 'badge badge-muted'
  if (s === 'ready' || s === 'preproduction') return 'badge badge-info'
  if (s === 'underreview' || s === 'approved' || s === 'published') return 'badge badge-muted'
  return 'badge badge-muted'
}

/** Short scannable label — not a sentence. */
function lifecycleBadgeLabel(status) {
  switch (status) {
    case 'preproduction':
    case 'ready':
      return 'Scheduled'
    case 'live':
      return 'Live'
    case 'stopping':
      return 'Stopping'
    case 'ended':
      return 'Ended'
    case 'underReview':
      return 'Under review'
    case 'approved':
      return 'Approved'
    case 'published':
      return 'Published'
    default:
      return status || 'Unknown'
  }
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
    cfg.lifecycleStatus ? `lifecycle=${cfg.lifecycleStatus}` : null,
    cfg.recordingId ? `recordingId=${cfg.recordingId}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function captureBadge({ recording, projectCheckOk, sdkReady }) {
  if (recording) {
    return { className: 'badge badge-success badge-pulse', label: 'Recording' }
  }
  if (!projectCheckOk) {
    return { className: 'badge badge-standby', label: 'Blocked' }
  }
  if (sdkReady) {
    return { className: 'badge badge-info', label: 'Ready' }
  }
  return { className: 'badge badge-muted', label: 'SDK not ready' }
}

function LifecycleBadge({ status }) {
  return (
    <span className={lifecycleBadgeClass(status)}>
      {status === 'live' ? <span className="live-dot" aria-hidden="true" /> : null}
      {lifecycleBadgeLabel(status)}
    </span>
  )
}

/**
 * Stage 2A — UI restructuring only.
 * IPC surface unchanged: same window.ondaSpike calls as Stage 1.
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

  const [lifecycleStatus, setLifecycleStatus] = useState(null)
  const [sessionLabel, setSessionLabel] = useState(null)
  const [webhookUrl, setWebhookUrl] = useState(null)
  const [startBusy, setStartBusy] = useState(false)
  const [stopBusy, setStopBusy] = useState(false)

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

  useEffect(() => {
    if (!diagnosticsOpen) return
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [logs, diagnosticsOpen])

  useEffect(() => {
    function onKeyDown(e) {
      // Cmd+Shift+D (Mac) or Ctrl+Shift+D (non-Mac preview)
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
      if (patch.lifecycleStatus !== undefined) setLifecycleStatus(patch.lifecycleStatus)
      if (patch.webhookUrl !== undefined) setWebhookUrl(patch.webhookUrl)
      if (patch.sessionLabel !== undefined) setSessionLabel(patch.sessionLabel)

      spike.getConfig().then((cfg) => setMetaText(formatMeta(cfg)))

      if (patch.lastTranscript) {
        appendLog({
          level: 'info',
          at: new Date().toISOString(),
          message: `UI lastTranscript: ${patch.lastTranscript}`,
        })
      }
      if (patch.audioDownloadPath) {
        appendLog({
          level: 'info',
          at: new Date().toISOString(),
          message: `Audio saved → ${patch.audioDownloadPath} (${patch.audioBytes} bytes)`,
        })
      }
    })

    spike.getConfig().then((cfg) => {
      setMetaText(formatMeta(cfg))
      setSdkReady(Boolean(cfg.sdkReady))
      setRecording(Boolean(cfg.recording))
      setProjectCheckOk(Boolean(cfg.projectCheckOk))
      setProjectCheckError(cfg.projectCheckError || null)
      // Always start at unlock — no last-session persistence
      setScreen('unlock')
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

  const canRecord = projectCheckOk && sdkReady && Boolean(selectedSessionId)
  const capture = captureBadge({ recording, projectCheckOk, sdkReady })

  async function handleUnlock() {
    setUnlockError('')
    if (!credentialInput.trim()) {
      setUnlockError('Enter the show tech credential.')
      return
    }
    setUnlockBusy(true)
    appendLog({ level: 'info', at: new Date().toISOString(), message: 'Unlock attempt…' })
    try {
      const spike = getOndaSpike()
      const result = await spike.unlock(credentialInput)
      if (!result.ok) {
        setUnlockError(result.error || 'Invalid credential')
        appendLog({
          level: 'warn',
          at: new Date().toISOString(),
          message: `Unlock failed: ${result.error}`,
        })
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
    setLifecycleStatus(currentSession.lifecycleStatus)
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
    await getOndaSpike().clearSession()
    setSelectedSessionId(sessions[0]?.id || null)
    setScreen('sessions')
  }

  async function handleStart() {
    setStartBusy(true)
    appendLog({ level: 'info', at: new Date().toISOString(), message: 'Start clicked' })
    try {
      const result = await getOndaSpike().start()
      if (!result?.ok) {
        appendLog({
          level: 'error',
          at: new Date().toISOString(),
          message: `Start failed: ${result?.error || 'unknown'}`,
          extra: result,
        })
      }
      await refreshMeta()
    } finally {
      setStartBusy(false)
    }
  }

  async function handleStop() {
    setStopBusy(true)
    appendLog({ level: 'info', at: new Date().toISOString(), message: 'Stop clicked' })
    try {
      await getOndaSpike().stop()
      await refreshMeta()
    } finally {
      setStopBusy(false)
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
            <div className="op-header-show text-sm text-muted truncate">
              {show.name}
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
            <p className="op-section-kicker text-sm text-muted" id="show-label">
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
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${s.friendlyName || s.title} — ${lifecycleBadgeLabel(s.lifecycleStatus)}`}
                </option>
              ))}
            </select>
          </div>
          <div id="lifecycle-panel" className="card op-session-card">
            {!currentSession ? (
              <p className="text-sm text-muted" style={{ margin: 0 }}>
                Select a session to see its status.
              </p>
            ) : (
              <>
                <div className="op-session-card-top">
                  <div>
                    <div className="op-session-name">
                      {currentSession.friendlyName || currentSession.title}
                    </div>
                    <div className="text-sm text-muted">
                      {currentSession.location || 'No room set'}
                    </div>
                  </div>
                  <LifecycleBadge status={currentSession.lifecycleStatus} />
                </div>
                {currentSession.feedState ? (
                  <div className="op-session-meta text-sm text-muted">
                    Feed: {currentSession.feedState}
                  </div>
                ) : null}
                {currentSession.lifecycleStatus === 'live' ||
                currentSession.lifecycleStatus === 'stopping' ? (
                  <div className="op-warn">
                    {`This session is already ${lifecycleBadgeLabel(currentSession.lifecycleStatus).toLowerCase()} — start will be rejected if still active.`}
                  </div>
                ) : null}
              </>
            )}
          </div>
          <div className="op-controls op-controls-primary">
            <button
              id="btn-use-session"
              type="button"
              className="btn btn-primary"
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
        <section id="screen-record" className="op-screen op-screen-main">
          <div id="record-lifecycle" className="card op-session-card op-session-card-hero">
            <div className="op-session-card-top">
              <div>
                <p className="op-section-kicker text-sm text-muted" style={{ margin: 0 }}>
                  {show?.name || '—'}
                </p>
                <div className="op-session-name">{sessionLabel || '—'}</div>
              </div>
              <div className="op-badge-stack">
                <LifecycleBadge status={lifecycleStatus} />
                <span className={capture.className} id="state">
                  {capture.label === 'Recording' ? (
                    <span className="live-dot" aria-hidden="true" />
                  ) : null}
                  {capture.label}
                </span>
              </div>
            </div>
          </div>
          <div className="op-controls op-controls-primary">
            <button
              id="start"
              type="button"
              className="btn btn-primary btn-lg"
              disabled={startBusy || recording || !canRecord}
              onClick={handleStart}
            >
              Start recording
            </button>
            <button
              id="stop"
              type="button"
              className="btn btn-danger btn-lg"
              disabled={stopBusy || !recording}
              onClick={handleStop}
            >
              Stop + retrieve audio
            </button>
            <button
              id="btn-change-session"
              type="button"
              className="btn btn-secondary"
              onClick={handleChangeSession}
            >
              Change session
            </button>
          </div>
        </section>
      ) : null}

      {diagnosticsOpen ? (
        <aside
          className="op-diagnostics"
          id="diagnostics-panel"
          aria-label="Diagnostics"
        >
          <div className="op-diagnostics-header">
            <div>
              <div className="font-semibold">Diagnostics</div>
              <div className="text-sm text-muted">Toggle with ⌘⇧D</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDiagnosticsOpen(false)}
            >
              Close
            </button>
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
