const logEl = document.getElementById('log')
const metaEl = document.getElementById('meta')
const stateEl = document.getElementById('state')
const startBtn = document.getElementById('start')
const stopBtn = document.getElementById('stop')
const fatalEl = document.getElementById('fatal')
const unlockErrorEl = document.getElementById('unlock-error')
const sessionErrorEl = document.getElementById('session-error')
const credentialInput = document.getElementById('credential')
const sessionSelect = document.getElementById('session-select')
const lifecyclePanel = document.getElementById('lifecycle-panel')
const recordLifecycle = document.getElementById('record-lifecycle')
const showLabel = document.getElementById('show-label')

const screens = {
  unlock: document.getElementById('screen-unlock'),
  sessions: document.getElementById('screen-sessions'),
  record: document.getElementById('screen-record'),
}

const state = {
  recording: false,
  sdkReady: false,
  projectCheckOk: false,
  projectCheckError: null,
  credential: null,
  show: null,
  sessions: [],
  selectedSessionId: null,
  lifecycleStatus: null,
  sessionLabel: null,
  webhookUrl: null,
}

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('active', key === name)
  }
}

function appendLog(entry) {
  const line = document.createElement('div')
  line.className = `line-${entry.level || 'info'}`
  const extra = entry.extra ? ` ${JSON.stringify(entry.extra)}` : ''
  line.textContent = `[${entry.at || new Date().toISOString()}] ${entry.message}${extra}`
  logEl.appendChild(line)
  logEl.scrollTop = logEl.scrollHeight
}

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

function renderMeta(cfg) {
  metaEl.textContent = [
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

function renderFatal() {
  if (state.projectCheckOk === false && state.projectCheckError) {
    fatalEl.textContent = state.projectCheckError
    fatalEl.classList.add('visible')
  } else {
    fatalEl.classList.remove('visible')
    fatalEl.textContent = ''
  }
}

function renderButtons() {
  const canRecord = state.projectCheckOk && state.sdkReady && Boolean(state.selectedSessionId)
  startBtn.disabled = state.recording || !canRecord
  stopBtn.disabled = !state.recording
  stateEl.innerHTML = state.recording
    ? '<strong>recording</strong>'
    : !state.projectCheckOk
      ? '<strong>project check failed</strong>'
      : state.sdkReady
        ? 'ready'
        : '<strong>sdk not ready</strong>'
}

function renderSessionList() {
  sessionSelect.innerHTML = ''
  for (const s of state.sessions) {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = `${s.friendlyName || s.title} — ${lifecycleLabel(s.lifecycleStatus)}`
    sessionSelect.appendChild(opt)
  }
  if (state.sessions.length) {
    state.selectedSessionId = state.sessions[0].id
    sessionSelect.value = state.selectedSessionId
    renderLifecyclePreview()
  }
}

function currentSession() {
  return state.sessions.find((s) => s.id === state.selectedSessionId) || null
}

function renderLifecyclePreview() {
  const s = currentSession()
  if (!s) {
    lifecyclePanel.textContent = 'Select a session to see its lifecycle status.'
    return
  }
  const cls = statusClass(s.lifecycleStatus)
  lifecyclePanel.innerHTML =
    `<div><strong>${s.friendlyName || s.title}</strong> · ${s.location || 'no room'}</div>` +
    `<div>lifecycle: <span class="${cls}">${lifecycleLabel(s.lifecycleStatus)}</span>` +
    ` · feed: ${s.feedState}</div>` +
    (s.lifecycleStatus === 'live' || s.lifecycleStatus === 'stopping'
      ? `<div style="margin-top:6px;color:var(--warn)">Warning: session already ${s.lifecycleStatus} — start will be rejected if still active.</div>`
      : '')
}

function renderRecordLifecycle() {
  const cls = statusClass(state.lifecycleStatus)
  recordLifecycle.innerHTML =
    `<div><strong>${state.show?.name || '—'}</strong> · ${state.sessionLabel || '—'}</div>` +
    `<div>lifecycle: <span class="${cls}">${lifecycleLabel(state.lifecycleStatus)}</span></div>` +
    `<div class="meta" style="margin-top:6px">webhook: ${state.webhookUrl || '—'}</div>`
}

window.ondaSpike.onLog(appendLog)
window.ondaSpike.onStatus((patch) => {
  Object.assign(state, patch)
  if (patch.recording !== undefined) state.recording = patch.recording
  if (patch.sdkReady !== undefined) state.sdkReady = patch.sdkReady
  if (patch.projectCheckOk !== undefined) state.projectCheckOk = patch.projectCheckOk
  if (patch.projectCheckError !== undefined) state.projectCheckError = patch.projectCheckError
  if (patch.lifecycleStatus !== undefined) state.lifecycleStatus = patch.lifecycleStatus
  if (patch.webhookUrl !== undefined) state.webhookUrl = patch.webhookUrl
  if (patch.sessionLabel !== undefined) state.sessionLabel = patch.sessionLabel
  renderFatal()
  renderButtons()
  renderRecordLifecycle()
  window.ondaSpike.getConfig().then(renderMeta)
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

document.getElementById('btn-unlock').addEventListener('click', async () => {
  unlockErrorEl.textContent = ''
  const credential = credentialInput.value
  if (!credential.trim()) {
    unlockErrorEl.textContent = 'Enter the show tech credential.'
    return
  }
  const btn = document.getElementById('btn-unlock')
  btn.disabled = true
  appendLog({ level: 'info', at: new Date().toISOString(), message: 'Unlock attempt…' })
  try {
    const result = await window.ondaSpike.unlock(credential)
    if (!result.ok) {
      unlockErrorEl.textContent = result.error || 'Invalid credential'
      appendLog({
        level: 'warn',
        at: new Date().toISOString(),
        message: `Unlock failed: ${result.error}`,
      })
      return
    }
    state.credential = result.credential || credential
    state.show = result.show
    state.sessions = result.sessions || []
    showLabel.textContent = `Show: ${result.show.name} (${result.show.clientName}) · id=${result.show.id}`
    renderSessionList()
    showScreen('sessions')
  } finally {
    btn.disabled = false
  }
})

credentialInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-unlock').click()
})

sessionSelect.addEventListener('change', () => {
  state.selectedSessionId = sessionSelect.value
  renderLifecyclePreview()
})

document.getElementById('btn-use-session').addEventListener('click', async () => {
  sessionErrorEl.textContent = ''
  const session = currentSession()
  if (!session || !state.show || !state.credential) {
    sessionErrorEl.textContent = 'Select a session first.'
    return
  }
  const result = await window.ondaSpike.selectSession({
    credential: state.credential,
    showId: state.show.id,
    showName: state.show.name,
    session,
  })
  if (!result.ok) {
    sessionErrorEl.textContent = result.error || 'Could not select session'
    return
  }
  state.lifecycleStatus = session.lifecycleStatus
  state.sessionLabel = session.friendlyName || session.title
  state.webhookUrl = result.context?.webhookUrl || null
  renderRecordLifecycle()
  renderButtons()
  showScreen('record')
})

document.getElementById('btn-back-unlock').addEventListener('click', async () => {
  state.credential = null
  state.show = null
  state.sessions = []
  await window.ondaSpike.clearSession()
  showScreen('unlock')
})

document.getElementById('btn-change-session').addEventListener('click', async () => {
  await window.ondaSpike.clearSession()
  state.selectedSessionId = state.sessions[0]?.id || null
  renderLifecyclePreview()
  showScreen('sessions')
})

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true
  appendLog({ level: 'info', at: new Date().toISOString(), message: 'Start clicked' })
  const result = await window.ondaSpike.start()
  if (!result?.ok) {
    appendLog({
      level: 'error',
      at: new Date().toISOString(),
      message: `Start failed: ${result?.error || 'unknown'}`,
      extra: result,
    })
  }
  renderButtons()
})

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true
  appendLog({ level: 'info', at: new Date().toISOString(), message: 'Stop clicked' })
  await window.ondaSpike.stop()
  renderButtons()
})

window.ondaSpike.getConfig().then((cfg) => {
  renderMeta(cfg)
  state.sdkReady = Boolean(cfg.sdkReady)
  state.recording = Boolean(cfg.recording)
  state.projectCheckOk = Boolean(cfg.projectCheckOk)
  state.projectCheckError = cfg.projectCheckError || null
  renderFatal()
  renderButtons()
  // Always start at unlock — no last-session persistence
  showScreen('unlock')
})
