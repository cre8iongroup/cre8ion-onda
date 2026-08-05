/**
 * English caption text corrections from Show glossary `alsoHeardAs` → `term`.
 *
 * Pure helpers — shared by:
 *   - app/api/webhook/[sessionId]/route.ts
 *   - lib/recall/workspaceWebhook.ts
 *   - functions/src/recallWebhook.ts (keep mirror in sync)
 *
 * Matching: case-insensitive on "from", exact `term` casing out, whole-phrase
 * boundaries (no "alphabet" → "ALPFAbet"), longest-match-first.
 */

export type TextCorrectionRule = {
  from: string
  to: string
}

export type GlossaryLike = {
  term?: unknown
  alsoHeardAs?: unknown
}

/** Build correction rules from glossary entries (alsoHeardAs → term). */
export function textCorrectionsFromGlossary(
  glossary: GlossaryLike[] | null | undefined,
): TextCorrectionRule[] {
  if (!Array.isArray(glossary) || glossary.length === 0) return []

  const rules: TextCorrectionRule[] = []
  const seenFrom = new Set<string>()

  for (const entry of glossary) {
    if (!entry || typeof entry.term !== 'string') continue
    const to = entry.term.trim()
    if (!to) continue

    const heard = Array.isArray(entry.alsoHeardAs) ? entry.alsoHeardAs : []
    for (const raw of heard) {
      if (typeof raw !== 'string') continue
      const from = raw.trim()
      if (!from) continue
      const key = from.toLowerCase()
      if (seenFrom.has(key)) continue
      // Skip exact no-ops; allow case-only fixes (alpfa → ALPFA)
      if (from === to) continue
      seenFrom.add(key)
      rules.push({ from, to })
    }
  }

  // Longest phrase first so "Alpha Familia" wins over "Alpha"
  rules.sort((a, b) => b.from.length - a.from.length || a.from.localeCompare(b.from))
  return rules
}

/** Deepgram keyterm list = glossary `term` values (correct spellings only). */
export function deepgramKeytermsFromGlossary(
  glossary: GlossaryLike[] | null | undefined,
): string[] {
  if (!Array.isArray(glossary) || glossary.length === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of glossary) {
    if (!entry || typeof entry.term !== 'string') continue
    const term = entry.term.trim()
    if (!term || seen.has(term)) continue
    seen.add(term)
    out.push(term)
  }
  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Apply correction rules to English transcript text.
 * Empty rules / empty text → unchanged.
 */
export function applyTextCorrections(
  text: string,
  rules: TextCorrectionRule[] | null | undefined,
): string {
  if (!text || !Array.isArray(rules) || rules.length === 0) return text

  let result = text
  for (const rule of rules) {
    const from = rule.from?.trim()
    const to = rule.to?.trim()
    if (!from || !to) continue

    // Phrase-safe: flexible internal whitespace; no letter/number/_ adjacency.
    const parts = from.split(/\s+/).filter(Boolean).map(escapeRegExp)
    if (parts.length === 0) continue
    const body = parts.join('\\s+')
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'giu')
    result = result.replace(pattern, to)
  }
  return result
}
