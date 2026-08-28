/**
 * Eligibility helpers for backfill-summaries — self-contained in functions/.
 * Logic mirrors lib/review/parseAiSummary.ts and lib/sessions/sessionFilters.ts.
 */

/** Keep in sync with functions/src/shared/runSummarizeForSession.ts */
export const MIN_TRANSCRIPT_CHARS = 200

export function isAvTestSession(session: {
  title?: string
  friendlyName?: string
}): boolean {
  const needle = 'av test'
  const title = (session.title || '').toLowerCase()
  const friendly = (session.friendlyName || '').toLowerCase()
  return title.includes(needle) || friendly.includes(needle)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isQuotes(value: unknown): value is Array<{ speaker?: string; text: string }> {
  if (!Array.isArray(value)) return false
  return value.every((q) => {
    if (!q || typeof q !== 'object') return false
    const row = q as { speaker?: unknown; text?: unknown }
    if (typeof row.text !== 'string') return false
    if (row.speaker !== undefined && typeof row.speaker !== 'string') return false
    return true
  })
}

/** Never throws — returns ok:false for empty/missing/invalid aiSummary JSON. */
export function parseAiSummary(raw: string | null | undefined): { ok: boolean } {
  if (raw == null || String(raw).trim() === '') {
    return { ok: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false }
  }

  const obj = parsed as Record<string, unknown>
  if (typeof obj.executiveSummary !== 'string') return { ok: false }
  if (!isStringArray(obj.keyTopics)) return { ok: false }
  if (!isStringArray(obj.actionItems)) return { ok: false }
  if (!isQuotes(obj.quotes)) return { ok: false }

  return { ok: true }
}
