/**
 * Onda Electron spike — Recall Desktop SDK adhoc/in-person audio capture.
 *
 * Flow:
 *  1. init SDK + request mic (and log other macOS permission prompts)
 *  2. Start → create sdk_upload → prepareDesktopAudioRecording → startRecording
 *  3. realtime-event transcript.* → normalize → POST Onda webhook (x-recall-secret)
 *  4. Stop → stopRecording → poll Retrieve Recording → download audio if ready
 *
 * Mac-first. Linux cloud agents cannot exercise native capture.
 */

const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain, systemPreferences } = require('electron')
const dotenv = require('dotenv')

dotenv.config({ path: path.join(__dirname, '.env') })

const { createSdkUpload, retrieveRecording, downloadToFile } = require('./lib/recallApi')
const { normalizeToOndaPayload } = require('./lib/normalizeTranscript')

const CONFIG = {
  apiKey: process.env.RECALL_API_KEY || '',
  region: process.env.RECALL_REGION || 'us-west-2',
  webhookUrl: process.env.ONDA_WEBHOOK_URL || 'http://localhost:3000/api/recall/webhook',
  webhookSecret: process.env.RECALL_WEBHOOK_SECRET || '',
  sessionId: process.env.SESSION_ID || 'spike-test-session',
  publicWebhookUrl: process.env.ONDA_PUBLIC_WEBHOOK_URL || '',
  languageCode: process.env.LANGUAGE_CODE || 'en',
}

let mainWindow = null
let RecallAiSdk = null
let sdkReady = false
let recording = false
let activeWindowId = null
let activeRecordingId = null
let activeUploadId = null
let sequenceNumber = 0
const spokenAtBySeq = new Map()

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

    const receivedAt = Date.now()
    sequenceNumber += 1
    const seq = sequenceNumber
    spokenAtBySeq.set(seq, receivedAt)

    const normalized = normalizeToOndaPayload(evt, CONFIG.sessionId, {
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
    })
    sendStatus({ lastTranscript: normalized.text, lastTranscriptAt: receivedAt })

    // Forward finals (and optionally partials) to Onda webhook
    if (!CONFIG.webhookSecret) {
      sendLog('warn', 'RECALL_WEBHOOK_SECRET missing — skipping webhook forward')
      return
    }

    try {
      const t0 = Date.now()
      const res = await fetch(CONFIG.webhookUrl, {
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
          // Rough end-to-end: speak→chunk receive is SDK latency; this is forward RTT only
          webhookRttMs: latencyMs,
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
    sendStatus({ sdkReady: true, region: CONFIG.region, sessionId: CONFIG.sessionId })
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
    return
  }
  if (!CONFIG.apiKey) {
    sendLog('error', 'RECALL_API_KEY missing in electron-spike/.env')
    return
  }
  if (!sdkReady || !RecallAiSdk) {
    sendLog('error', 'SDK not ready')
    return
  }

  try {
    sendLog('info', 'Creating Desktop SDK upload…', { sessionId: CONFIG.sessionId })
    const upload = await createSdkUpload({
      apiKey: CONFIG.apiKey,
      region: CONFIG.region,
      sessionId: CONFIG.sessionId,
      languageCode: CONFIG.languageCode,
      publicWebhookUrl: CONFIG.publicWebhookUrl || null,
    })
    activeUploadId = upload.id
    activeRecordingId = upload.recordingId
    sendLog('info', 'sdk_upload created', upload)
    sendStatus({
      uploadId: upload.id,
      recordingId: upload.recordingId,
    })

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
  } catch (err) {
    sendLog('error', 'startRecording flow failed', {
      message: err?.message,
      detail: err?.detail,
      stack: err?.stack,
    })
    recording = false
    sendStatus({ recording: false })
  }
}

async function stopRecording() {
  if (!RecallAiSdk) {
    sendLog('error', 'SDK not loaded')
    return
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
    return
  }

  sendLog('info', 'Polling Retrieve Recording for downloadable audio…', {
    recordingId: activeRecordingId,
  })

  const downloadsDir = path.join(__dirname, 'downloads')
  fs.mkdirSync(downloadsDir, { recursive: true })

  const maxAttempts = 30
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
        return
      }

      // Upload may still be processing
      await new Promise((r) => setTimeout(r, 2000))
    } catch (err) {
      sendLog('warn', `Retrieve attempt ${i} failed`, {
        message: err?.message,
        detail: err?.detail,
      })
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  sendLog('error', 'Timed out waiting for audio download URL — check Recall dashboard / sdk_upload.complete')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Onda Recall Adhoc Spike',
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

app.whenReady().then(async () => {
  createWindow()
  sendStatus({
    sessionId: CONFIG.sessionId,
    region: CONFIG.region,
    webhookUrl: CONFIG.webhookUrl,
    hasApiKey: Boolean(CONFIG.apiKey),
    hasWebhookSecret: Boolean(CONFIG.webhookSecret),
    platform: process.platform,
  })
  await initSdk()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('spike:start', async () => {
  await startRecording()
  return { ok: true }
})

ipcMain.handle('spike:stop', async () => {
  await stopRecording()
  return { ok: true }
})

ipcMain.handle('spike:get-config', async () => ({
  sessionId: CONFIG.sessionId,
  region: CONFIG.region,
  webhookUrl: CONFIG.webhookUrl,
  hasApiKey: Boolean(CONFIG.apiKey),
  hasWebhookSecret: Boolean(CONFIG.webhookSecret),
  platform: process.platform,
  sdkReady,
  recording,
  recordingId: activeRecordingId,
  uploadId: activeUploadId,
}))
