/**
 * Map RTDB chunks to the text field buildCaptionDisplayLines expects,
 * based on the attendee's selected caption language.
 *
 * Rules (product decisions):
 * - en → use chunk.text (including live partials)
 * - other langs → only finalized chunks with a non-empty translations[lang];
 *   omit partials and omit finalized lines missing a translation (no English fallback)
 */

import { isChunkFinalized, type CaptionChunkLike } from '@/lib/attendee/captionLines'
import type { RTDBChunk } from '@/types'

export const CAPTION_LANG_STORAGE_KEY = 'onda.captionLang'

export const CAPTION_LANGUAGE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
]

export function normalizeCaptionLanguages(languages: string[] | null | undefined): string[] {
  const allowed = new Set(CAPTION_LANGUAGE_OPTIONS.map((o) => o.code))
  const raw = Array.isArray(languages) ? languages : []
  const filtered = raw.filter((l) => typeof l === 'string' && allowed.has(l))
  // English is always available as the transcription source
  if (!filtered.includes('en')) filtered.unshift('en')
  // Dedupe while preserving order
  return [...new Set(filtered)]
}

export function readStoredCaptionLang(available: string[]): string {
  const fallback = available.includes('en') ? 'en' : available[0] ?? 'en'
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(CAPTION_LANG_STORAGE_KEY)
    if (raw && available.includes(raw)) return raw
  } catch {
    /* ignore quota / private mode */
  }
  return fallback
}

export function writeStoredCaptionLang(lang: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CAPTION_LANG_STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
}

type ChunkWithTranslations = CaptionChunkLike & {
  translations?: RTDBChunk['translations'] | Record<string, string>
}

/**
 * Resolve display text for one chunk in the selected language.
 * Returns null when the line should be omitted from the feed.
 */
export function resolveCaptionTextForLanguage(
  chunk: ChunkWithTranslations | null | undefined,
  lang: string,
): string | null {
  if (!chunk) return null

  if (lang === 'en') {
    const text = typeof chunk.text === 'string' ? chunk.text.trim() : ''
    return text || null
  }

  // Non-English: never show partials; never fall back to English
  if (!isChunkFinalized(chunk)) return null

  const translations = chunk.translations
  const translated =
    translations && typeof translations === 'object'
      ? (translations as Record<string, string>)[lang]
      : undefined
  if (typeof translated !== 'string') return null
  const trimmed = translated.trim()
  return trimmed || null
}

/**
 * Project chunks into CaptionChunkLike rows with `text` set to the selected
 * language (or omitted when resolve returns null). Does not mutate inputs.
 */
export function mapChunksForCaptionLanguage<T extends ChunkWithTranslations>(
  chunks: T[] | null | undefined,
  lang: string,
): CaptionChunkLike[] {
  if (!Array.isArray(chunks) || chunks.length === 0) return []

  const out: CaptionChunkLike[] = []
  for (const chunk of chunks) {
    const text = resolveCaptionTextForLanguage(chunk, lang)
    if (text === null) continue
    out.push({
      id: chunk.id,
      text,
      speakerLabel: chunk.speakerLabel,
      timestamp: chunk.timestamp,
      sequenceNumber: chunk.sequenceNumber,
      isFinalized: chunk.isFinalized,
      isFinal: chunk.isFinal,
    })
  }
  return out
}
