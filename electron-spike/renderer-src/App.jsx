import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getOndaSpike } from './ondaSpike.js'

function statusClass(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'live') return 'status-live'
  if (s === 'stopping') return 'status-stopping'
  if (s === 'ended') return 'status-ended'
  if (s === 'ready' || s === 'preproduction') return 'status-ready'
  return ''
}

/** Map internal lifecycle to operator-friendly label (scheduled ≈ ready/preproduction). */
function lifecycleLabel(status) {
  switch (status) {
    case 'preproduction':
    case 'ready':
      return `${status} (scheduled)`
    default:
      return status || 'unknown'
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

function recordStateLabel({ recording, projectCheckOk, sdkReady }) {
  if (recording) return <strong>recording</strong>
  if (!projectCheckOk) return <strong>project check failed</strong>
  if (sdkReady) return 'ready'
  return <strong>sdk not ready</strong>
}

/**
 * Stage 1 React port of the former renderer/renderer.js behavior.
 * IPC surface: window.ondaSpike only (preload contract unchanged).
 */
export default function App() {
  const [screen, setScreen] = useState('unlock')
  const [metaText, setMetaText] = useState('Loading…')
  const [logs, setLogs] = useState([])
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
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [logs])

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
      <header className="op-header">
        <h1>Onda · Tech Operator (Step 1)</h1>
        <div className="op-meta" id="meta">
          {metaText}
        </div>
      </header>

      {projectCheckOk === false && projectCheckError ? (
        <div className="op-fatal alert alert-error" id="fatal" role="alert">
          {projectCheckError}
        </div>
      ) : null}

      {screen === 'unlock' ? (
        <section id="screen-unlock" className="op-screen">
          <div className="op-row">
            <label htmlFor="credential" className="label">
              Show tech credential
            </label>
            <input
              id="credential"
              className={`input${unlockError ? ' error' : ''}`}
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
        </section>
      ) : null}

      {screen === 'sessions' ? (
        <section id="screen-sessions" className="op-screen">
          <div className="op-row">
            <div className="op-meta" id="show-label">
              {show
                ? `Show: ${show.name} (${show.clientName}) · id=${show.id}`
                : 'Show'}
            </div>
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
                  {`${s.friendlyName || s.title} — ${lifecycleLabel(s.lifecycleStatus)}`}
                </option>
              ))}
            </select>
          </div>
          <div id="lifecycle-panel" className="op-lifecycle">
            {!currentSession ? (
              'Select a session to see its lifecycle status.'
            ) : (
              <>
                <div>
                  <strong>{currentSession.friendlyName || currentSession.title}</strong>
                  {' · '}
                  {currentSession.location || 'no room'}
                </div>
                <div>
                  lifecycle:{' '}
                  <span className={statusClass(currentSession.lifecycleStatus)}>
                    {lifecycleLabel(currentSession.lifecycleStatus)}
                  </span>
                  {` · feed: ${currentSession.feedState}`}
                </div>
                {currentSession.lifecycleStatus === 'live' ||
                currentSession.lifecycleStatus === 'stopping' ? (
                  <div className="op-warn">
                    {`Warning: session already ${currentSession.lifecycleStatus} — start will be rejected if still active.`}
                  </div>
                ) : null}
              </>
            )}
          </div>
          <div className="op-controls">
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
        <section id="screen-record" className="op-screen">
          <div id="record-lifecycle" className="op-lifecycle">
            <div>
              <strong>{show?.name || '—'}</strong>
              {' · '}
              {sessionLabel || '—'}
            </div>
            <div>
              lifecycle:{' '}
              <span className={statusClass(lifecycleStatus)}>
                {lifecycleLabel(lifecycleStatus)}
              </span>
            </div>
            <div className="op-meta" style={{ marginTop: 'var(--space-2)' }}>
              {`webhook: ${webhookUrl || '—'}`}
            </div>
          </div>
          <div className="op-controls">
            <button
              id="start"
              type="button"
              className="btn btn-primary"
              disabled={startBusy || recording || !canRecord}
              onClick={handleStart}
            >
              Start recording
            </button>
            <button
              id="stop"
              type="button"
              className="btn btn-danger"
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
            <span className="op-pill" id="state">
              {recordStateLabel({ recording, projectCheckOk, sdkReady })}
            </span>
          </div>
        </section>
      ) : null}

      <div id="log" className="op-log">
        {logs.map((entry, i) => (
          <div key={`${entry.at}-${i}`} className={`line-${entry.level}`}>
            {`[${entry.at}] ${entry.message}${
              entry.extra ? ` ${JSON.stringify(entry.extra)}` : ''
            }`}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  )
}
