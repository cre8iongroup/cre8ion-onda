import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/recall/sdk-upload
 *
 * Spike/backend helper: creates a Recall Desktop SDK upload configured for
 * adhoc/in-person audio + realtime transcription.
 *
 * Body: { sessionId: string, webhookUrl?: string }
 * Returns: { id, upload_token, recording_id }
 *
 * Requires RECALL_API_KEY (+ optional RECALL_REGION, default us-west-2).
 * Not authenticated beyond env presence — spike only; lock down before prod.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.RECALL_API_KEY
  const region = process.env.RECALL_REGION ?? 'us-west-2'

  if (!apiKey) {
    return NextResponse.json({ error: 'RECALL_API_KEY not configured' }, { status: 500 })
  }

  let body: { sessionId?: string; webhookUrl?: string; languageCode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sessionId = body.sessionId
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
  }

  const baseWebhook =
    body.webhookUrl ??
    process.env.RECALL_ONDA_WEBHOOK_URL ??
    null

  const realtimeEndpoints: Array<Record<string, unknown>> = [
    {
      type: 'desktop_sdk_callback',
      events: ['transcript.data', 'transcript.partial_data'],
    },
  ]

  // Optional: also push native events to Onda webhook (needs public URL + secret header
  // is NOT set by Recall — prefer Electron forwarder for secret auth).
  if (baseWebhook) {
    const url = new URL(baseWebhook)
    url.searchParams.set('sessionId', sessionId)
    realtimeEndpoints.push({
      type: 'webhook',
      url: url.toString(),
      events: ['transcript.data'],
    })
  }

  const payload = {
    metadata: { sessionId, source: 'onda-electron-spike' },
    recording_config: {
      // Audio delivery artifact (full session audio for client delivery)
      audio_mixed_mp3: {},
      // Adhoc/in-person is audio-centric; disable default mixed video
      video_mixed_mp4: null,
      transcript: {
        provider: {
          recallai_streaming: {
            mode: 'prioritize_low_latency',
            language_code: body.languageCode ?? 'en',
          },
        },
      },
      realtime_endpoints: realtimeEndpoints,
    },
  }

  try {
    const res = await fetch(`https://${region}.recall.ai/api/v1/sdk_upload/`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[recall/sdk-upload] Recall error', res.status, json)
      return NextResponse.json(
        { error: 'Recall sdk_upload failed', detail: json },
        { status: res.status },
      )
    }

    return NextResponse.json(
      {
        id: json.id,
        upload_token: json.upload_token,
        recording_id: json.recording_id,
        sessionId,
        region,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[recall/sdk-upload] request failed', err)
    return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 })
  }
}
