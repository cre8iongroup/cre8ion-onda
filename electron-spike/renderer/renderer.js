const logEl = document.getElementById('log')
const metaEl = document.getElementById('meta')
const stateEl = document.getElementById('state')
const startBtn = document.getElementById('start')
const stopBtn = document.getElementById('stop')

const state = {
  recording: false,
  sdkReady: false,
}

function appendLog(entry) {
  const line = document.createElement('div')
  line.className = `line-${entry.level || 'info'}`
  const extra = entry.extra ? ` ${JSON.stringify(entry.extra)}` : ''
  line.textContent = `[${entry.at || new Date().toISOString()}] ${entry.message}${extra}`
  logEl.appendChild(line)
  logEl.scrollTop = logEl.scrollHeight
}

function renderMeta(cfg) {
  metaEl.textContent = [
    `sessionId=${cfg.sessionId || '—'}`,
    `region=${cfg.region || '—'}`,
    `platform=${cfg.platform || '—'}`,
    `apiKey=${cfg.hasApiKey ? 'yes' : 'NO'}`,
    `webhookSecret=${cfg.hasWebhookSecret ? 'yes' : 'NO'}`,
    `webhook=${cfg.webhookUrl || '—'}`,
    cfg.recordingId ? `recordingId=${cfg.recordingId}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function renderButtons() {
  startBtn.disabled = state.recording || !state.sdkReady
  stopBtn.disabled = !state.recording
  stateEl.innerHTML = state.recording
    ? '<strong>recording</strong>'
    : state.sdkReady
      ? 'ready'
      : '<strong>sdk not ready</strong>'
}

window.ondaSpike.onLog(appendLog)
window.ondaSpike.onStatus((patch) => {
  Object.assign(state, patch)
  if (patch.recording !== undefined) state.recording = patch.recording
  if (patch.sdkReady !== undefined) state.sdkReady = patch.sdkReady
  renderButtons()
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

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true
  appendLog({ level: 'info', at: new Date().toISOString(), message: 'Start clicked' })
  await window.ondaSpike.start()
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
  renderButtons()
})
