/**
 * Thin Recall REST helpers for the Electron main process (spike only).
 * API key lives in electron-spike/.env — do not ship this pattern to production.
 */

function recallBaseUrl(region) {
  return `https://${region}.recall.ai`
}

async function createSdkUpload({
  apiKey,
  region,
  sessionId,
  languageCode = 'en',
  publicWebhookUrl = null,
}) {
  const realtimeEndpoints = [
    {
      type: 'desktop_sdk_callback',
      events: ['transcript.data', 'transcript.partial_data'],
    },
  ]

  if (publicWebhookUrl) {
    const url = new URL(publicWebhookUrl)
    url.searchParams.set('sessionId', sessionId)
    realtimeEndpoints.push({
      type: 'webhook',
      url: url.toString(),
      events: ['transcript.data'],
    })
  }

  const body = {
    metadata: { sessionId, source: 'onda-electron-spike' },
    recording_config: {
      audio_mixed_mp3: {},
      video_mixed_mp4: null,
      transcript: {
        provider: {
          recallai_streaming: {
            mode: 'prioritize_low_latency',
            language_code: languageCode,
          },
        },
      },
      realtime_endpoints: realtimeEndpoints,
    },
  }

  const res = await fetch(`${recallBaseUrl(region)}/api/v1/sdk_upload/`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      Authorization: `Token ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(`sdk_upload failed (${res.status})`)
    err.detail = json
    throw err
  }

  return {
    id: json.id,
    uploadToken: json.upload_token,
    recordingId: json.recording_id,
  }
}

async function retrieveRecording({ apiKey, region, recordingId }) {
  const res = await fetch(
    `${recallBaseUrl(region)}/api/v1/recording/${recordingId}/`,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Token ${apiKey}`,
      },
    },
  )

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(`retrieve recording failed (${res.status})`)
    err.detail = json
    throw err
  }

  const shortcuts = json.media_shortcuts ?? {}
  return {
    id: json.id,
    status: json.status ?? null,
    audioUrl:
      shortcuts.audio_mixed?.data?.download_url ??
      shortcuts.audio_mixed_mp3?.data?.download_url ??
      null,
    videoUrl: shortcuts.video_mixed?.data?.download_url ?? null,
    transcriptUrl: shortcuts.transcript?.data?.download_url ?? null,
    mediaShortcuts: shortcuts,
    raw: json,
  }
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const fs = require('fs')
  fs.writeFileSync(destPath, buf)
  return { bytes: buf.length, path: destPath }
}

module.exports = { createSdkUpload, retrieveRecording, downloadToFile }
