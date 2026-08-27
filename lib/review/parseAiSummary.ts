import type { ClaudeSummary } from '@/types'

export type ParseAiSummaryResult =
  | { ok: true; summary: ClaudeSummary }
  | { ok: false; reason: 'missing' | 'invalid' }

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isQuotes(
  value: unknown,
): value is Array<{ speaker?: string; text: string }> {
  if (!Array.isArray(value)) return false
  return value.every((q) => {
    if (!q || typeof q !== 'object') return false
    const row = q as { speaker?: unknown; text?: unknown }
    if (typeof row.text !== 'string') return false
    if (row.speaker !== undefined && typeof row.speaker !== 'string') return false
    return true
  })
}

/**
 * Parse SessionDoc.aiSummary (JSON.stringify of ClaudeSummary).
 * Never throws — returns a typed failure for empty/missing/invalid payloads.
 */
export function parseAiSummary(raw: string | null | undefined): ParseAiSummaryResult {
  if (raw == null || String(raw).trim() === '') {
    return { ok: false, reason: 'missing' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'invalid' }
  }

  const obj = parsed as Record<string, unknown>
  if (typeof obj.executiveSummary !== 'string') return { ok: false, reason: 'invalid' }
  if (!isStringArray(obj.keyTopics)) return { ok: false, reason: 'invalid' }
  if (!isStringArray(obj.actionItems)) return { ok: false, reason: 'invalid' }
  if (!isQuotes(obj.quotes)) return { ok: false, reason: 'invalid' }

  return {
    ok: true,
    summary: {
      executiveSummary: obj.executiveSummary,
      keyTopics: obj.keyTopics,
      actionItems: obj.actionItems,
      quotes: obj.quotes,
    },
  }
}
