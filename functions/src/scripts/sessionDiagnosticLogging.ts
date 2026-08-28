import { GoogleAuth } from 'google-auth-library'
import type { LogFlags } from './sessionDiagnosticTypes'

const LOGGING_SCOPE = 'https://www.googleapis.com/auth/logging.read'

const EMPTY_LOG_FLAGS = (): LogFlags => ({
  fetched: false,
  skipReason: null,
  onSessionEndNoShowId: false,
  onSessionEndMigrationFailed: false,
  onSessionEndNoChunks: false,
  autoSummarizeFailed: false,
  autoSummarizeInsufficient: false,
  webhookChunkWrites: 0,
  recallWebhookFailures: 0,
  recordingIndexMiss: false,
  audioRetrieveFailed: false,
  summarizeFailed: false,
  deeplTranslationFailures: 0,
  sampleMessages: [],
})

type RawLogEntry = {
  textPayload?: string
  jsonPayload?: Record<string, unknown>
  insertId?: string
}

function messageText(entry: RawLogEntry): string {
  if (typeof entry.textPayload === 'string') return entry.textPayload
  if (entry.jsonPayload && typeof entry.jsonPayload.message === 'string') {
    return entry.jsonPayload.message
  }
  return JSON.stringify(entry.jsonPayload ?? {})
}

function sessionIdFromEntry(entry: RawLogEntry, knownIds: Set<string>): string | null {
  const jp = entry.jsonPayload
  if (jp && typeof jp.sessionId === 'string' && knownIds.has(jp.sessionId)) {
    return jp.sessionId
  }
  const text = messageText(entry)
  for (const id of knownIds) {
    if (text.includes(id)) return id
  }
  return null
}

function applyEntryToFlags(flags: LogFlags, text: string): void {
  if (text.includes('onSessionEnd: no showId on live session')) {
    flags.onSessionEndNoShowId = true
  }
  if (text.includes('onSessionEnd: migration failed')) {
    flags.onSessionEndMigrationFailed = true
  }
  if (text.includes('onSessionEnd: no chunks found in RTDB')) {
    flags.onSessionEndNoChunks = true
  }
  if (text.includes('onSessionEnd: auto-summarize failed')) {
    flags.autoSummarizeFailed = true
  }
  if (text.includes('onSessionEnd: auto-summarize skipped — insufficient content')) {
    flags.autoSummarizeInsufficient = true
  }
  if (text.includes('[webhook/session] chunk written') || text.includes('[recall/webhook] chunk written')) {
    flags.webhookChunkWrites += 1
  }
  if (text.includes('recallWebhook: chunk written')) {
    flags.webhookChunkWrites += 1
  }
  if (text.includes('LOUD FAILURE') || text.includes('recallWebhook: write failed')) {
    flags.recallWebhookFailures += 1
  }
  if (text.includes('recording_index_miss') || text.includes('no recordingIndex entry')) {
    flags.recordingIndexMiss = true
  }
  if (
    text.includes('recall_audio_') ||
    text.includes('LOUD FAILURE: server-side Recall audio retrieve/store failed')
  ) {
    flags.audioRetrieveFailed = true
  }
  if (
    text.includes('runSummarizeForSession: Claude call failed') ||
    text.includes('runSummarizeForSession: failed to parse Claude JSON') ||
    text.includes('runSummarizeForSession: ANTHROPIC_API_KEY not configured')
  ) {
    flags.summarizeFailed = true
  }
  if (text.includes('onTranscriptChunk: translation failed — skipping language')) {
    flags.deeplTranslationFailures += 1
  }
}

/**
 * Bulk-fetch Cloud Logging entries once, then bucket by sessionId.
 * One paginated scan (~few API calls) instead of per-session queries.
 */
export async function fetchLogsBySessionId(opts: {
  projectId: string
  sessionIds: Set<string>
  sinceDays: number
  skip: boolean
}): Promise<Map<string, LogFlags>> {
  const result = new Map<string, LogFlags>()
  for (const id of opts.sessionIds) {
    result.set(id, EMPTY_LOG_FLAGS())
  }

  if (opts.skip) {
    for (const flags of result.values()) {
      flags.skipReason = 'CLI --skip-logging'
    }
    return result
  }

  const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000)
  const sinceIso = since.toISOString()

  const filter = [
    `timestamp>="${sinceIso}"`,
    '(',
    'resource.labels.function_name=("onSessionEnd" OR "onTranscriptChunk" OR "summarizeSession" OR "recallWebhook")',
    'OR textPayload=~"\\\\[recall/webhook\\\\]|\\\\[webhook/session\\\\]|onSessionEnd|recallWebhook|runSummarizeForSession|onTranscriptChunk"',
    ')',
  ].join(' ')

  let auth: GoogleAuth
  try {
    auth = new GoogleAuth({ scopes: [LOGGING_SCOPE] })
    await auth.getClient()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    for (const flags of result.values()) {
      flags.skipReason = `Logging auth failed: ${reason}`
    }
    return result
  }

  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const token = tokenResponse.token
  if (!token) {
    for (const flags of result.values()) {
      flags.skipReason = 'Logging auth returned no access token (need logging.viewer role)'
    }
    return result
  }

  let pageToken: string | undefined
  let totalEntries = 0
  const maxEntries = Number(process.env.DIAGNOSTIC_LOG_MAX_ENTRIES ?? 5000)

  do {
    const body: Record<string, unknown> = {
      resourceNames: [`projects/${opts.projectId}`],
      filter,
      pageSize: 500,
      orderBy: 'timestamp desc',
    }
    if (pageToken) body.pageToken = pageToken

    const res = await fetch('https://logging.googleapis.com/v2/entries:list', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      for (const flags of result.values()) {
        if (!flags.fetched) {
          flags.skipReason = `Logging API ${res.status}: ${errText.slice(0, 200)}`
        }
      }
      return result
    }

    const json = (await res.json()) as {
      entries?: RawLogEntry[]
      nextPageToken?: string
    }

    for (const entry of json.entries ?? []) {
      totalEntries += 1
      const sessionId = sessionIdFromEntry(entry, opts.sessionIds)
      if (!sessionId) continue

      const flags = result.get(sessionId)
      if (!flags) continue

      flags.fetched = true
      const text = messageText(entry)
      applyEntryToFlags(flags, text)
      if (flags.sampleMessages.length < 3) {
        flags.sampleMessages.push(text.slice(0, 240))
      }
    }

    pageToken = json.nextPageToken
    if (totalEntries >= maxEntries) break
  } while (pageToken)

  for (const flags of result.values()) {
    if (!flags.skipReason && flags.fetched) {
      flags.skipReason = null
    } else if (!flags.skipReason && !flags.fetched) {
      flags.skipReason = 'No matching log entries in window (not necessarily an error)'
    }
  }

  console.info('[session-diagnostic] Cloud Logging scan complete', {
    since: sinceIso,
    entriesScanned: totalEntries,
    sessionsWithHits: [...result.values()].filter((f) => f.fetched).length,
  })

  return result
}

export function emptyLogFlags(): LogFlags {
  return EMPTY_LOG_FLAGS()
}
