import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/recall/recordings/[recordingId]
 *
 * Spike helper: Retrieve Recording from Recall after sdk_upload.complete.
 * Surfaces media_shortcuts download URLs (audio_mixed / video_mixed / transcript).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ recordingId: string }> },
) {
  const apiKey = process.env.RECALL_API_KEY
  const region = process.env.RECALL_REGION ?? 'us-west-2'

  if (!apiKey) {
    return NextResponse.json({ error: 'RECALL_API_KEY not configured' }, { status: 500 })
  }

  const { recordingId } = await context.params
  if (!recordingId) {
    return NextResponse.json({ error: 'Missing recordingId' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://${region}.recall.ai/api/v1/recording/${recordingId}/`,
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
      return NextResponse.json(
        { error: 'Recall retrieve recording failed', detail: json },
        { status: res.status },
      )
    }

    const shortcuts = json.media_shortcuts ?? {}
    const audioUrl =
      shortcuts.audio_mixed?.data?.download_url ??
      shortcuts.audio_mixed_mp3?.data?.download_url ??
      null
    const videoUrl = shortcuts.video_mixed?.data?.download_url ?? null
    const transcriptUrl = shortcuts.transcript?.data?.download_url ?? null

    return NextResponse.json({
      id: json.id,
      status: json.status ?? null,
      download: {
        audio: audioUrl,
        video: videoUrl,
        transcript: transcriptUrl,
      },
      media_shortcuts: shortcuts,
      raw: json,
    })
  } catch (err) {
    console.error('[recall/recordings] request failed', err)
    return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 })
  }
}
