import type { RecallLookup } from './sessionDiagnosticTypes'

const RECALL_DELAY_MS = 150

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function lookupRecallRecording(
  recordingId: string,
  opts: { skip: boolean },
): Promise<RecallLookup> {
  if (opts.skip) {
    return {
      attempted: false,
      skippedReason: '--skip-recall',
      status: null,
      transcriptUrlAvailable: false,
      error: null,
    }
  }

  const apiKey = process.env.RECALL_API_KEY?.trim()
  const region = process.env.RECALL_REGION?.trim() || 'us-west-2'

  if (!apiKey) {
    return {
      attempted: false,
      skippedReason: 'RECALL_API_KEY not set',
      status: null,
      transcriptUrlAvailable: false,
      error: null,
    }
  }

  try {
    const res = await fetch(`https://${region}.recall.ai/api/v1/recording/${recordingId}/`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Token ${apiKey}`,
      },
    })

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>

    if (!res.ok) {
      return {
        attempted: true,
        skippedReason: null,
        status: null,
        transcriptUrlAvailable: false,
        error: `HTTP ${res.status}`,
      }
    }

    const shortcuts = (json.media_shortcuts ?? {}) as Record<string, { data?: { download_url?: string } }>
    const transcriptUrl = shortcuts.transcript?.data?.download_url ?? null

    return {
      attempted: true,
      skippedReason: null,
      status: typeof json.status === 'string' ? json.status : String(json.status ?? ''),
      transcriptUrlAvailable: Boolean(transcriptUrl),
      error: null,
    }
  } catch (err) {
    return {
      attempted: true,
      skippedReason: null,
      status: null,
      transcriptUrlAvailable: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await sleep(RECALL_DELAY_MS)
  }
}

export const RECALL_LOOKUP_DELAY_MS = RECALL_DELAY_MS
