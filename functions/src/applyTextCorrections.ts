/**
 * KEEP IN SYNC with lib/recall/applyTextCorrections.ts
 * (functions package cannot import monorepo @/lib).
 */

export type TextCorrectionRule = {
  from: string
  to: string
}

export type GlossaryLike = {
  term?: unknown
  alsoHeardAs?: unknown
}

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

  rules.sort((a, b) => b.from.length - a.from.length || a.from.localeCompare(b.from))
  return rules
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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

    const parts = from.split(/\s+/).filter(Boolean).map(escapeRegExp)
    if (parts.length === 0) continue
    const body = parts.join('\\s+')
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'giu')
    result = result.replace(pattern, to)
  }
  return result
}
