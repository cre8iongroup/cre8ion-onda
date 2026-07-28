import { useCallback, useEffect, useRef, useState } from 'react'
import { getOndaSpike } from './ondaSpike.js'
import { createInputMeterTap } from './lib/inputMeterTap.js'

/**
 * Isolated Slice 2B spike — NOT the operator panel.
 * Open via #audio-concurrency-spike after Electron start.
 *
 * Protocol:
 * 1. Meter starts alone (app-open style)
 * 2. Unlock + select session + Start Recall while meter stays up
 * 3. Observe meter + transcripts + SDK errors together
 * 4. Stop Recall; meter must keep running
 */

function nowIso() {
  return new Date().toISOString()
}

export default function AudioConcurrencySpike() {
  const [level, setLevel] = useState(0)
  const [peak, setPeak] = useState(0)
  const [meterSnap, setMeterSnap] = useState({
    running: false,
    deviceLabel: '',
    trackState: 'none',
    updatesPerSec: 0,
    stalled: false,
  })
  const [meterError, setMeterError] = useState('')
  const [logs, setLogs] = useState([])
  const [recording, setRecording] = useState(false)
  const [sdkReady, setSdkReady] = useState(false)
  const [projectCheckOk, setProjectCheckOk] = useState(false)
  const [lastTranscript, setLastTranscript] = useState('')
  const [lastWebhookRttMs, setLastWebhookRttMs] = useState(null)
  const [credentialInput, setCredentialInput] = useState('')
  const [credential, setCredential] = useState(null)
  const [show, setShow] = useState(null)
  const [sessions, setSessions] = useState([])
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [checklist, setChecklist] = useState({
    meterAlone: null,
    meterDuringRecall: null,
    transcriptsDuringMeter: null,
    noSdkErrors: null,
    meterAfterStop: null,
  })

  const tapRef = useRef(null)
  const logEndRef = useRef(null)
  const findingsRef = useRef({
    startedAt: nowIso(),
    platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    events: [],
  })

  const appendLog = useCallback((levelName, message, extra) => {
    const entry = { at: nowIso(), level: levelName, message, extra }
    findingsRef.current.events.push(entry)
    setLogs((prev) => [...prev, entry])
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [logs])

  // Start meter immediately on mount — independent of session
  useEffect(() => {
    const tap = createInputMeterTap({
      onSample: (sample) => {
        setLevel(sample.level)
        setPeak(sample.peak)
      },
      onError: (err) => {
        setMeterError(err.message)
        appendLog('error', `Meter tap error: ${err.message}`)
      },
    })
    tapRef.current = tap

    let cancelled = false
    ;(async () => {
      try {
        await tap.start()
        if (cancelled) return
        const snap = tap.getSnapshot()
        setMeterSnap(snap)
        appendLog('info', 'Meter tap started (app-open style)', snap)
      } catch (err) {
        if (!cancelled) {
          setMeterError(err?.message || String(err))
        }
      }
    })()

    const poll = window.setInterval(() => {
      if (!tapRef.current) return
      setMeterSnap(tapRef.current.getSnapshot())
    }, 500)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      tap.stop()
    }
  }, [appendLog])

  useEffect(() => {
    const spike = getOndaSpike()
    const offLog = spike.onLog((entry) => {
      appendLog(entry.level || 'info', `[main] ${entry.message}`, entry.extra)
      const msg = String(entry.message || '').toLowerCase()
      if (msg.includes('sdk event: error') || entry.level === 'error') {
        // Soft signal for checklist — operator still confirms
        findingsRef.current.sawSdkOrMainError = true
      }
    })
    const offStatus = spike.onStatus((patch) => {
      if (patch.recording !== undefined) setRecording(Boolean(patch.recording))
      if (patch.sdkReady !== undefined) setSdkReady(Boolean(patch.sdkReady))
      if (patch.projectCheckOk !== undefined) setProjectCheckOk(Boolean(patch.projectCheckOk))
      if (patch.lastTranscript) {
        setLastTranscript(patch.lastTranscript)
        findingsRef.current.sawTranscriptWhileMeter = true
      }
      if (patch.lastWebhookRttMs !== undefined) setLastWebhookRttMs(patch.lastWebhookRttMs)
    })
    spike.getConfig().then((cfg) => {
      setSdkReady(Boolean(cfg.sdkReady))
      setRecording(Boolean(cfg.recording))
      setProjectCheckOk(Boolean(cfg.projectCheckOk))
      appendLog('info', 'Spike config', {
        platform: cfg.platform,
        sdkReady: cfg.sdkReady,
        projectCheckOk: cfg.projectCheckOk,
        hasApiKey: cfg.hasApiKey,
      })
    })
    return () => {
      offLog?.()
      offStatus?.()
    }
  }, [appendLog])

  function mark(key, value) {
    setChecklist((prev) => ({ ...prev, [key]: value }))
    appendLog('info', `Checklist ${key}=${value}`)
  }

  async function handleUnlock() {
    setBusy(true)
    try {
      const result = await getOndaSpike().unlock(credentialInput)
      if (!result.ok) {
        appendLog('error', `Unlock failed: ${result.error}`)
        return
      }
      setCredential(result.credential || credentialInput)
      setShow(result.show)
      setSessions(result.sessions || [])
      setSelectedSessionId(result.sessions?.[0]?.id || null)
      appendLog('info', 'Unlocked show', {
        showId: result.show?.id,
        sessions: result.sessions?.length,
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleSelectAndStart() {
    const session = sessions.find((s) => s.id === selectedSessionId)
    if (!session || !show || !credential) {
      appendLog('error', 'Select a session after unlock first')
      return
    }
    setBusy(true)
    try {
      const selected = await getOndaSpike().selectSession({
        credential,
        showId: show.id,
        showName: show.name,
        session,
      })
      if (!selected.ok) {
        appendLog('error', `selectSession failed: ${selected.error}`)
        return
      }
      const before = tapRef.current?.getSnapshot()
      appendLog('info', 'Meter snapshot BEFORE startRecording', before)
      const started = await getOndaSpike().start()
      const after = tapRef.current?.getSnapshot()
      appendLog(started?.ok ? 'info' : 'error', 'startRecording result', {
        started,
        meterAfter: after,
      })
      findingsRef.current.meterDuringStart = after
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    setBusy(true)
    try {
      const before = tapRef.current?.getSnapshot()
      appendLog('info', 'Meter snapshot BEFORE stopRecording', before)
      const stopped = await getOndaSpike().stop()
      // Give meter a beat to prove it survived
      await new Promise((r) => setTimeout(r, 1200))
      const after = tapRef.current?.getSnapshot()
      appendLog('info', 'Meter snapshot AFTER stopRecording (+1.2s)', {
        stopped,
        meterAfter: after,
      })
      findingsRef.current.meterAfterStop = after
    } finally {
      setBusy(false)
    }
  }

  function exportFindings() {
    const payload = {
      ...findingsRef.current,
      exportedAt: nowIso(),
      checklist,
      meterFinal: tapRef.current?.getSnapshot() || meterSnap,
      lastTranscript,
      lastWebhookRttMs,
      recording,
      sdkReady,
      projectCheckOk,
      provisionalVerdict:
        checklist.meterAlone === true &&
        checklist.meterDuringRecall === true &&
        checklist.transcriptsDuringMeter === true &&
        checklist.noSdkErrors === true &&
        checklist.meterAfterStop === true
          ? 'PASS — concurrency looks safe on this machine'
          : checklist.meterDuringRecall === false || checklist.transcriptsDuringMeter === false
            ? 'FAIL — do not ship simultaneous getUserMedia + Recall without alternative'
            : 'INCOMPLETE — finish checklist on Mac hardware',
    }
    const text = JSON.stringify(payload, null, 2)
    navigator.clipboard?.writeText(text).catch(() => {})
    appendLog('info', 'Findings JSON copied to clipboard (also logged below)')
    appendLog('info', text)
    return payload
  }

  const currentSession = sessions.find((s) => s.id === selectedSessionId)

  return (
    <div className="op-shell" style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <header className="op-header op-header-compact">
        <div className="op-brand-inline">
          <span className="op-brand-mark" aria-hidden="true">
            〜
          </span>
          <span className="op-brand-name">Audio concurrency spike</span>
        </div>
        <a className="btn btn-ghost btn-sm" href="#/">
          Back to operator UI
        </a>
      </header>

      <div className="alert alert-warning" role="note" style={{ marginBottom: 16 }}>
        Slice 2B Step 0 only. Confirms whether a continuous getUserMedia meter can coexist with
        Recall <code>startRecording</code> on the same default mic. Not the production layout.
      </div>

      <section className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>1. Input meter (always on)</h2>
        <p className="text-sm text-muted">
          Device: {meterSnap.deviceLabel || '—'} · track={meterSnap.trackState} ·{' '}
          {meterSnap.updatesPerSec} updates/s
          {meterSnap.stalled ? ' · STALLED' : ''}
        </p>
        <div
          style={{
            height: 18,
            background: 'rgba(0,0,0,0.08)',
            borderRadius: 4,
            overflow: 'hidden',
            position: 'relative',
          }}
          aria-label={`Input level ${level}`}
        >
          <div
            style={{
              width: `${level}%`,
              height: '100%',
              background: meterSnap.stalled ? '#c45c26' : '#1f6f5a',
              transition: 'width 50ms linear',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `${peak}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: '#222',
              opacity: 0.5,
            }}
          />
        </div>
        <div className="text-sm" style={{ marginTop: 8 }}>
          Level {level} · peak hold {peak}
          {meterError ? ` · error: ${meterError}` : ''}
        </div>
        <div className="op-controls" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => mark('meterAlone', !meterSnap.stalled && meterSnap.running && level >= 0)}
          >
            Mark: meter alone OK
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => mark('meterAlone', false)}
          >
            Fail
          </button>
        </div>
      </section>

      <section className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>2. Recall recording (same mic)</h2>
        <p className="text-sm text-muted">
          sdkReady={String(sdkReady)} · projectOk={String(projectCheckOk)} · recording=
          {String(recording)}
          {lastWebhookRttMs != null ? ` · last webhook RTT ${lastWebhookRttMs}ms` : ''}
        </p>
        {!credential ? (
          <div className="op-row">
            <label className="label" htmlFor="spike-cred">
              Show tech credential
            </label>
            <input
              id="spike-cred"
              className="input"
              type="password"
              value={credentialInput}
              onChange={(e) => setCredentialInput(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={handleUnlock}
            >
              Unlock
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm">
              {show?.name} · session{' '}
              <select
                className="input"
                value={selectedSessionId || ''}
                onChange={(e) => setSelectedSessionId(e.target.value)}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.friendlyName || s.title} ({s.feedState})
                  </option>
                ))}
              </select>
            </p>
            {currentSession ? (
              <p className="text-sm text-muted">
                feed={currentSession.feedState}
              </p>
            ) : null}
            <div className="op-controls">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || recording || !sdkReady || !projectCheckOk}
                onClick={handleSelectAndStart}
              >
                Start Recall (meter stays up)
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || !recording}
                onClick={handleStop}
              >
                Stop Recall (meter stays up)
              </button>
            </div>
          </>
        )}
        <p className="text-sm" style={{ marginTop: 12 }}>
          Last transcript: {lastTranscript || '—'}
        </p>
        <div className="op-controls" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              mark('meterDuringRecall', recording && meterSnap.running && !meterSnap.stalled)
            }
          >
            Mark: meter OK during Recall
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => mark('meterDuringRecall', false)}
          >
            Fail
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => mark('transcriptsDuringMeter', Boolean(lastTranscript))}
          >
            Mark: transcripts OK
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => mark('transcriptsDuringMeter', false)}
          >
            Fail
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => mark('noSdkErrors', !findingsRef.current.sawSdkOrMainError)}
          >
            Mark: no SDK errors
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => mark('noSdkErrors', false)}
          >
            Fail
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              mark('meterAfterStop', !recording && meterSnap.running && !meterSnap.stalled)
            }
          >
            Mark: meter OK after stop
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => mark('meterAfterStop', false)}
          >
            Fail
          </button>
        </div>
      </section>

      <section className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>3. Checklist / export</h2>
        <ul className="text-sm">
          {Object.entries(checklist).map(([k, v]) => (
            <li key={k}>
              {k}: {v === null ? 'pending' : v ? 'PASS' : 'FAIL'}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-primary" onClick={exportFindings}>
          Export findings JSON
        </button>
      </section>

      <section className="card" style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Log</h2>
        <div className="op-log" style={{ maxHeight: 280, overflow: 'auto' }}>
          {logs.map((entry, i) => (
            <div key={`${entry.at}-${i}`} className={`line-${entry.level}`}>
              [{entry.at}] {entry.message}
              {entry.extra ? ` ${JSON.stringify(entry.extra)}` : ''}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </section>
    </div>
  )
}
