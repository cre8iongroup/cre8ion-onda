/**
 * Onda Electron — Tech Operator Step 1
 *
 * Replaces hardcoded sessionId / webhook URL with:
 *  1. techCredential unlock → show
 *  2. session selection (Firestore via API)
 *  3. startSession / stopSession API (Electron never writes Firestore)
 *  4. per-session webhook /api/webhook/[sessionId]
 *  5. Loud fail if Firebase project ≠ cre8ion-onda
 */

const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain, systemPreferences } = require('electron')
const dotenv = require('dotenv')

dotenv.config({ path: path.join(__dirname, '.env') })

const { createSdkUpload, retrieveRecording, downloadToFile } = require('./lib/recallApi')
const { normalizeToOndaPayload } = require('./lib/normalizeTranscript')

const REQUIRED_FIREBASE_PROJECT_ID = 'cre8ion-onda'

const CONFIG = {
  apiKey: process.env.RECALL_API_KEY || '',
  region: process.env.RECALL_REGION || 'us-west-2',
  ondaApiBase: (process.env.ONDA_API_BASE || 'http://localhost:3000').replace(/\/$/, ''),
  webhookSecret: process.env.RECALL_WEBHOOK_SECRET || '',
  publicWebhookBase: process.env.ONDA_PUBLIC_WEBHOOK_BASE || '',
  languageCode: process.env.LANGUAGE_CODE || 'en',
  /**
   * Synthetic sdk_upload.complete → /api/webhook/[sessionId].
   * Default OFF unless explicitly "true" / "1". Non-local must leave unset.
   * DEFAULT DECISION — flagged for review; remove once Svix path is live.
   */
  localForwarderEnabled: ['true', '1', 'yes'].includes(
    String(process.env.ONDA_LOCAL_FORWARDER_ENABLED || '').trim().toLowerCase(),
  ),
}

/** @type {{ credential: string, showId: string, showName: string, sessionId: string, sessionLabel: string, lifecycleStatus: string, webhookUrl: string } | null} */
let activeContext = null

let mainWindow = null
let RecallAiSdk = null
let sdkReady = false
let recording = false
let activeWindowId = null
let activeRecordingId = null
let activeUploadId = null
let sequenceNumber = 0
const spokenAtBySeq = new Map()
let projectCheckOk = false
let projectCheckError = null

function sendLog(level, message, extra) {
  const payload = {
    level,
    message,
    extra: extra ?? null,
    at: new Date().toISOString(),
  }
  console.log(`[${level}]`, message, extra ?? '')
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('spike:log', payload)
  }
}

function sendStatus(patch) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('spike:status', patch)
  }
}

function webhookUrlForSession(sessionId) {
  return `${CONFIG.ondaApiBase}/api/webhook/${encodeURIComponent(sessionId)}`
}

async function ondaFetch(pathname, { method = 'GET', body } = {}) {
  const url = `${CONFIG.ondaApiBase}${pathname}`
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(json?.error || `HTTP ${res.status} ${pathname}`)
    err.status = res.status
    err.code = json?.code
    err.detail = json
    throw err
  }
  return json
}

/**
 * Startup check: Next /api/health must report cre8ion-onda.
 * Fails loudly (UI + log) — does not silently continue.
 */
async function assertOndaFirebaseProject() {
  try {
    const health = await ondaFetch('/api/health')
    const projectId = health?.firebaseProjectId
    if (health?.status !== 'ok' || projectId !== REQUIRED_FIREBASE_PROJECT_ID) {
      const msg =
        health?.error ||
        `Firebase project must be "${REQUIRED_FIREBASE_PROJECT_ID}" (got ${JSON.stringify(projectId)})`
      projectCheckOk = false
      projectCheckError = msg
      sendLog('error', 'FATAL: Firebase project check failed', { health })
      sendStatus({ projectCheckOk: false, projectCheckError: msg })
      return false
    }
    projectCheckOk = true
    projectCheckError = null
    sendLog('info', 'Firebase project check OK', {
      projectId,
      databaseHost: health.databaseHost,
    })
    sendStatus({ projectCheckOk: true, projectCheckError: null, firebaseProjectId: projectId })
    return true
  } catch (err) {
    const msg = `Cannot reach Onda API health at ${CONFIG.ondaApiBase}/api/health — ${err.message}. Is Next.js running with cre8ion-onda env?`
    projectCheckOk = false
    projectCheckError = msg
    sendLog('error', 'FATAL: Firebase project check failed', { message: err.message })
    sendStatus({ projectCheckOk: false, projectCheckError: msg })
    return false
  }
}

function loadRecallSdk() {
  try {
    RecallAiSdk = require('@recallai/desktop-sdk')
    return true
  } catch (err) {
    sendLog('error', 'Failed to load @recallai/desktop-sdk (expected on Linux / unsupported platforms)', {
      message: err?.message,
      platform: process.platform,
      arch: process.arch,
    })
    return false
  }
}

async function requestMacPermissions() {
  if (process.platform !== 'darwin') {
    sendLog('info', `Skipping macOS permission prompts (platform=${process.platform})`)
    return
  }

  try {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    sendLog('info', `Electron mic access status before prompt: ${micStatus}`)
    const granted = await systemPreferences.askForMediaAccess('microphone')
    sendLog(granted ? 'info' : 'warn', `Electron askForMediaAccess(microphone) → ${granted}`)
  } catch (err) {
    sendLog('warn', 'systemPreferences.askForMediaAccess failed', { message: err?.message })
  }

  if (!RecallAiSdk) return

  for (const perm of ['microphone', 'system-audio', 'accessibility', 'screen-capture']) {
    try {
      sendLog('info', `RecallAiSdk.requestPermission("${perm}")…`)
      const result = await Promise.resolve(RecallAiSdk.requestPermission(perm))
      sendLog('info', `requestPermission("${perm}") returned`, { result })
    } catch (err) {
      sendLog('warn', `requestPermission("${perm}") threw`, { message: err?.message })
    }
  }
}

function wireSdkEvents() {
  if (!RecallAiSdk) return

  RecallAiSdk.addEventListener('permissions-granted', (evt) => {
    sendLog('info', 'SDK event: permissions-granted', evt)
    sendStatus({ permissionsGranted: true })
  })

  RecallAiSdk.addEventListener('permission-status', (evt) => {
    sendLog('info', 'SDK event: permission-status', evt)
  })

  RecallAiSdk.addEventListener('error', (evt) => {
    sendLog('error', 'SDK event: error', evt)
  })

  RecallAiSdk.addEventListener('recording-started', (evt) => {
    sendLog('info', 'SDK event: recording-started', evt)
    recording = true
    sendStatus({ recording: true })
  })

  RecallAiSdk.addEventListener('recording-ended', (evt) => {
    sendLog('info', 'SDK event: recording-ended', evt)
    recording = false
    sendStatus({ recording: false })
  })

  RecallAiSdk.addEventListener('sdk-state-change', (evt) => {
    sendLog('info', 'SDK event: sdk-state-change', evt)
  })

  RecallAiSdk.addEventListener('realtime-event', async (evt) => {
    const eventName = evt?.event ?? evt?.type ?? 'unknown'
    if (eventName !== 'transcript.data' && eventName !== 'transcript.partial_data') {
      sendLog('debug', `realtime-event: ${eventName}`)
      return
    }

    if (!activeContext?.sessionId) {
      sendLog('warn', 'Transcript received but no active session context')
      return
    }

    const receivedAt = Date.now()
    sequenceNumber += 1
    const seq = sequenceNumber
    spokenAtBySeq.set(seq, receivedAt)

    const normalized = normalizeToOndaPayload(evt, activeContext.sessionId, {
      sequenceNumber: seq,
      eventHint: eventName,
    })

    if (!normalized) {
      sendLog('warn', 'Could not normalize realtime transcript event', { eventName, evt })
      return
    }

    sendLog('info', `Transcript (${eventName}): ${normalized.text}`, {
      speaker: normalized.speaker,
      isFinal: normalized.isFinal,
      seq,
      sessionId: activeContext.sessionId,
    })
    sendStatus({ lastTranscript: normalized.text, lastTranscriptAt: receivedAt })

    if (!CONFIG.webhookSecret) {
      sendLog('warn', 'RECALL_WEBHOOK_SECRET missing — skipping webhook forward')
      return
    }

    try {
      const t0 = Date.now()
      const res = await fetch(activeContext.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-recall-secret': CONFIG.webhookSecret,
        },
        body: JSON.stringify(normalized),
      })
      const latencyMs = Date.now() - t0
      const bodyText = await res.text().catch(() => '')
      if (!res.ok) {
        sendLog('error', `Webhook forward failed (${res.status})`, { bodyText, latencyMs })
      } else {
        sendLog('info', `Webhook OK (${res.status}) in ${latencyMs}ms`, {
          seq,
          webhookRttMs: latencyMs,
          path: activeContext.webhookUrl,
        })
        sendStatus({ lastWebhookOkAt: Date.now(), lastWebhookRttMs: latencyMs })
      }
    } catch (err) {
      sendLog('error', 'Webhook forward threw', { message: err?.message })
    }
  })
}

async function initSdk() {
  if (!loadRecallSdk()) {
    sendStatus({ sdkReady: false, sdkError: 'SDK package failed to load' })
    return
  }

  try {
    const apiUrl = `https://${CONFIG.region}.recall.ai`
    await RecallAiSdk.init({
      apiUrl,
      acquirePermissionsOnStartup: [
        'microphone',
        'system-audio',
        'accessibility',
        'screen-capture',
      ],
    })
    sdkReady = true
    sendLog('info', `Recall SDK init OK`, { apiUrl, platform: process.platform })
    sendStatus({ sdkReady: true, region: CONFIG.region })
    wireSdkEvents()
    await requestMacPermissions()
  } catch (err) {
    sendLog('error', 'Recall SDK init failed', { message: err?.message, stack: err?.stack })
    sendStatus({ sdkReady: false, sdkError: err?.message })
  }
}

async function startRecording() {
  if (recording) {
    sendLog('warn', 'Already recording')
    return { ok: false, error: 'Already recording' }
  }
  if (!projectCheckOk) {
    const msg = projectCheckError || 'Firebase project check failed'
    sendLog('error', msg)
    return { ok: false, error: msg }
  }
  if (!activeContext?.sessionId) {
    return { ok: false, error: 'Select a session first' }
  }
  if (!CONFIG.apiKey) {
    sendLog('error', 'RECALL_API_KEY missing in electron-spike/.env')
    return { ok: false, error: 'RECALL_API_KEY missing' }
  }
  if (!sdkReady || !RecallAiSdk) {
    sendLog('error', 'SDK not ready')
    return { ok: false, error: 'SDK not ready' }
  }

  try {
    // 1) Authoritative live transition via API (not Firestore from Electron)
    sendLog('info', 'Calling startSession…', {
      showId: activeContext.showId,
      sessionId: activeContext.sessionId,
    })
    const started = await ondaFetch('/api/tech/sessions/start', {
      method: 'POST',
      body: {
        credential: activeContext.credential,
        showId: activeContext.showId,
        sessionId: activeContext.sessionId,
      },
    })
    activeContext.lifecycleStatus = started.session?.lifecycleStatus || 'live'
    sendStatus({
      lifecycleStatus: activeContext.lifecycleStatus,
      session: started.session,
    })
    sendLog('info', 'startSession OK — session is live', started.session)

    // 2) Create Recall upload
    sendLog('info', 'Creating Desktop SDK upload…', { sessionId: activeContext.sessionId })
    const publicWebhookUrl = CONFIG.publicWebhookBase
      ? `${CONFIG.publicWebhookBase.replace(/\/$/, '')}/api/webhook/${activeContext.sessionId}`
      : null
    const upload = await createSdkUpload({
      apiKey: CONFIG.apiKey,
      region: CONFIG.region,
      sessionId: activeContext.sessionId,
      languageCode: CONFIG.languageCode,
      publicWebhookUrl,
    })
    activeUploadId = upload.id
    activeRecordingId = upload.recordingId
    sendLog('info', 'sdk_upload created', upload)
    sendStatus({
      uploadId: upload.id,
      recordingId: upload.recordingId,
    })

    // 3) Bind recordingId → session for Svix lifecycle resolution
    try {
      await ondaFetch('/api/tech/sessions/bind-recording', {
        method: 'POST',
        body: {
          credential: activeContext.credential,
          showId: activeContext.showId,
          sessionId: activeContext.sessionId,
          recordingId: upload.recordingId,
          uploadId: upload.id,
        },
      })
      sendLog('info', 'bind-recording OK', { recordingId: upload.recordingId })
    } catch (err) {
      sendLog('warn', 'bind-recording failed (lifecycle ended resolution may break)', {
        message: err.message,
      })
    }

    sendLog('info', 'prepareDesktopAudioRecording()…')
    const windowId = await RecallAiSdk.prepareDesktopAudioRecording()
    activeWindowId = windowId
    sendLog('info', 'prepareDesktopAudioRecording → windowId', { windowId })

    sendLog('info', 'startRecording()…')
    await RecallAiSdk.startRecording({
      windowId,
      uploadToken: upload.uploadToken,
    })
    recording = true
    sendStatus({ recording: true })
    sendLog('info', 'startRecording() resolved — speak into the mic')
    return { ok: true }
  } catch (err) {
    sendLog('error', 'startRecording flow failed', {
      message: err?.message,
      code: err?.code,
      detail: err?.detail,
      stack: err?.stack,
    })
    recording = false
    sendStatus({ recording: false })
    return { ok: false, error: err?.message || 'start failed', code: err?.code }
  }
}

async function notifyUploadComplete() {
  if (!activeContext?.sessionId) return

  if (!CONFIG.localForwarderEnabled) {
    sendLog(
      'info',
      'Skipping local sdk_upload.complete forwarder (ONDA_LOCAL_FORWARDER_ENABLED is not true). ' +
        'Expect Recall Svix → /api/recall/webhook to flip ended, or set ONDA_LOCAL_FORWARDER_ENABLED=true for local testing.',
    )
    return
  }

  if (!CONFIG.webhookSecret) {
    sendLog('warn', 'Local forwarder enabled but RECALL_WEBHOOK_SECRET is empty — cannot forward')
    return
  }

  try {
    const res = await fetch(activeContext.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-recall-secret': CONFIG.webhookSecret,
      },
      body: JSON.stringify({
        event: 'sdk_upload.complete',
        data: {
          data: { code: 'complete', sub_code: null, updated_at: new Date().toISOString() },
          recording: {
            id: activeRecordingId,
            metadata: { sessionId: activeContext.sessionId },
          },
          sdk_upload: {
            id: activeUploadId,
            metadata: { sessionId: activeContext.sessionId },
          },
        },
      }),
    })
    const text = await res.text()
    sendLog(
      res.ok ? 'info' : 'error',
      `Forwarded sdk_upload.complete → ended (${res.status})`,
      { body: text },
    )
    if (res.ok) {
      activeContext.lifecycleStatus = 'ended'
      sendStatus({ lifecycleStatus: 'ended' })
    }
  } catch (err) {
    sendLog('error', 'Failed to forward sdk_upload.complete', { message: err.message })
  }
}

async function stopRecording() {
  if (!activeContext?.sessionId) {
    return { ok: false, error: 'No active session' }
  }

  try {
    // Intermediate stopping state — NOT ended
    sendLog('info', 'Calling stopSession (lifecycle → stopping)…')
    const stopped = await ondaFetch('/api/tech/sessions/stop', {
      method: 'POST',
      body: {
        credential: activeContext.credential,
        showId: activeContext.showId,
        sessionId: activeContext.sessionId,
      },
    })
    activeContext.lifecycleStatus = stopped.session?.lifecycleStatus || 'stopping'
    sendStatus({
      lifecycleStatus: activeContext.lifecycleStatus,
      session: stopped.session,
    })
    sendLog('info', 'stopSession OK — waiting for Recall complete before ended', stopped.session)
  } catch (err) {
    sendLog('error', 'stopSession API failed', {
      message: err.message,
      code: err.code,
      detail: err.detail,
    })
    // Continue stopping the SDK anyway so local capture ends
  }

  if (!RecallAiSdk) {
    sendLog('error', 'SDK not loaded')
    return { ok: false, error: 'SDK not loaded' }
  }

  try {
    sendLog('info', 'stopRecording()…', { windowId: activeWindowId })
    if (typeof RecallAiSdk.stopRecording === 'function') {
      if (activeWindowId == null) {
        sendLog('error', 'No windowId to stop — call Start first')
      } else {
        await RecallAiSdk.stopRecording({ windowId: activeWindowId })
      }
    } else {
      sendLog('warn', 'stopRecording method missing on SDK — check SDK version/docs')
    }
    recording = false
    sendStatus({ recording: false })
  } catch (err) {
    sendLog('error', 'stopRecording threw', { message: err?.message })
  }

  if (!activeRecordingId) {
    sendLog('warn', 'No recording_id to retrieve')
    return { ok: true, warning: 'no recording id' }
  }

  sendLog('info', 'Polling Retrieve Recording for downloadable audio…', {
    recordingId: activeRecordingId,
  })

  const downloadsDir = path.join(__dirname, 'downloads')
  fs.mkdirSync(downloadsDir, { recursive: true })

  const maxAttempts = 30
  let audioSaved = false
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const rec = await retrieveRecording({
        apiKey: CONFIG.apiKey,
        region: CONFIG.region,
        recordingId: activeRecordingId,
      })
      sendLog('info', `Retrieve attempt ${i}/${maxAttempts}`, {
        audioUrl: Boolean(rec.audioUrl),
        videoUrl: Boolean(rec.videoUrl),
        transcriptUrl: Boolean(rec.transcriptUrl),
        status: rec.status,
      })

      if (rec.audioUrl) {
        const dest = path.join(downloadsDir, `${activeRecordingId}.mp3`)
        const saved = await downloadToFile(rec.audioUrl, dest)
        sendLog('info', 'Audio downloaded', saved)
        sendStatus({ audioDownloadPath: saved.path, audioBytes: saved.bytes })
        audioSaved = true
        break
      }

      await new Promise((r) => setTimeout(r, 2000))
    } catch (err) {
      sendLog('warn', `Retrieve attempt ${i} failed`, {
        message: err?.message,
        detail: err?.detail,
      })
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  if (!audioSaved) {
    sendLog(
      'error',
      'Timed out waiting for audio download URL — check Recall dashboard / sdk_upload.complete',
    )
  }

  // Local/spike fallback: when audio is ready (or after poll timeout with recording id),
  // forward sdk_upload.complete so Firestore flips to ended without requiring Svix
  // dashboard wiring. Production should also configure Recall Svix → /api/recall/webhook.
  await notifyUploadComplete()

  return { ok: true, audioSaved }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 780,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Onda Tech Operator — Step 1',
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

app.whenReady().then(async () => {
  createWindow()
  sendStatus({
    region: CONFIG.region,
    ondaApiBase: CONFIG.ondaApiBase,
    hasApiKey: Boolean(CONFIG.apiKey),
    hasWebhookSecret: Boolean(CONFIG.webhookSecret),
    platform: process.platform,
    projectCheckOk: false,
  })

  const ok = await assertOndaFirebaseProject()
  if (ok) {
    await initSdk()
  } else {
    sendLog('error', 'Skipping SDK init until Firebase project check passes')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('spike:unlock', async (_evt, credential) => {
  if (!projectCheckOk) {
    return { ok: false, error: projectCheckError || 'Firebase project check failed' }
  }
  try {
    const result = await ondaFetch('/api/tech/unlock', {
      method: 'POST',
      body: { credential },
    })
    // Stash credential in main only — renderer keeps a copy for subsequent calls via IPC
    sendLog('info', 'Show unlocked', {
      showId: result.show?.id,
      name: result.show?.name,
      sessionCount: result.sessions?.length ?? 0,
    })
    return { ok: true, ...result, credential }
  } catch (err) {
    sendLog('warn', 'Unlock failed', { message: err.message, code: err.code })
    return {
      ok: false,
      error: err.message || 'Unlock failed',
      code: err.code,
    }
  }
})

ipcMain.handle('spike:select-session', async (_evt, payload) => {
  const { credential, showId, showName, session } = payload || {}
  if (!credential || !showId || !session?.id) {
    return { ok: false, error: 'Missing credential, showId, or session' }
  }
  activeContext = {
    credential,
    showId,
    showName: showName || showId,
    sessionId: session.id,
    sessionLabel: session.friendlyName || session.title || session.id,
    lifecycleStatus: session.lifecycleStatus || 'unknown',
    webhookUrl: webhookUrlForSession(session.id),
  }
  sequenceNumber = 0
  sendLog('info', 'Session selected', {
    sessionId: activeContext.sessionId,
    lifecycleStatus: activeContext.lifecycleStatus,
    webhookUrl: activeContext.webhookUrl,
  })
  sendStatus({
    showId: activeContext.showId,
    showName: activeContext.showName,
    sessionId: activeContext.sessionId,
    sessionLabel: activeContext.sessionLabel,
    lifecycleStatus: activeContext.lifecycleStatus,
    webhookUrl: activeContext.webhookUrl,
  })
  return { ok: true, context: { ...activeContext, credential: undefined } }
})

ipcMain.handle('spike:clear-session', async () => {
  activeContext = null
  sendStatus({
    showId: null,
    showName: null,
    sessionId: null,
    sessionLabel: null,
    lifecycleStatus: null,
    webhookUrl: null,
  })
  return { ok: true }
})

ipcMain.handle('spike:start', async () => {
  return startRecording()
})

ipcMain.handle('spike:stop', async () => {
  return stopRecording()
})

ipcMain.handle('spike:get-config', async () => ({
  region: CONFIG.region,
  ondaApiBase: CONFIG.ondaApiBase,
  hasApiKey: Boolean(CONFIG.apiKey),
  hasWebhookSecret: Boolean(CONFIG.webhookSecret),
  platform: process.platform,
  sdkReady,
  recording,
  recordingId: activeRecordingId,
  uploadId: activeUploadId,
  projectCheckOk,
  projectCheckError,
  showId: activeContext?.showId ?? null,
  showName: activeContext?.showName ?? null,
  sessionId: activeContext?.sessionId ?? null,
  sessionLabel: activeContext?.sessionLabel ?? null,
  lifecycleStatus: activeContext?.lifecycleStatus ?? null,
  webhookUrl: activeContext?.webhookUrl ?? null,
}))
