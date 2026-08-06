/**
 * Defaults + helpers for room outputConfig / outputLive windows.
 *
 * Data layer is an arbitrary-length windows[]. ALPFA UI currently edits 2.
 */

import type { OutputWindowConfig, RoomOutputConfig } from '@/types'

/** Chroma-key green for switcher keying (named swatch in Builder UI). */
export const OUTPUT_CHROMA_GREEN = '#00FF00'

export const DEFAULT_OUTPUT_FONT_SIZE_PX = 48
export const DEFAULT_OUTPUT_BACKGROUND = '#000000'

/** Builder / ALPFA UI currently surfaces this many window editors. */
export const OUTPUT_BUILDER_WINDOW_COUNT = 2

/**
 * Seed windows when a room has no outputConfig yet.
 * windows[0].language = show primary (defaultLanguages[0]); further windows = null.
 */
export function seedOutputWindows(
  primaryLanguage: string | null | undefined,
  windowCount: number = OUTPUT_BUILDER_WINDOW_COUNT,
): OutputWindowConfig[] {
  const primary =
    typeof primaryLanguage === 'string' && primaryLanguage.trim()
      ? primaryLanguage.trim()
      : 'en'
  const count = Math.max(1, Math.floor(windowCount))
  const windows: OutputWindowConfig[] = []
  for (let i = 0; i < count; i++) {
    windows.push({
      language: i === 0 ? primary : null,
      fontSize: DEFAULT_OUTPUT_FONT_SIZE_PX,
      backgroundColor: DEFAULT_OUTPUT_BACKGROUND,
      // textColor omitted → inherit show branding at render
    })
  }
  return windows
}

export function seedRoomOutputConfig(
  primaryLanguage: string | null | undefined,
  windowCount?: number,
): Pick<RoomOutputConfig, 'windows'> {
  return { windows: seedOutputWindows(primaryLanguage, windowCount) }
}

/** Strip undefined optional fields so Firestore/RTDB writes never send undefined. */
export function sanitizeOutputWindow(window: OutputWindowConfig): OutputWindowConfig {
  const next: OutputWindowConfig = {
    language: window.language === undefined ? null : window.language,
    fontSize: typeof window.fontSize === 'number' && Number.isFinite(window.fontSize)
      ? window.fontSize
      : DEFAULT_OUTPUT_FONT_SIZE_PX,
    backgroundColor:
      typeof window.backgroundColor === 'string' && window.backgroundColor.trim()
        ? window.backgroundColor.trim()
        : DEFAULT_OUTPUT_BACKGROUND,
  }
  if (typeof window.textColor === 'string' && window.textColor.trim()) {
    next.textColor = window.textColor.trim()
  }
  return next
}

export function sanitizeOutputWindows(windows: OutputWindowConfig[]): OutputWindowConfig[] {
  return (Array.isArray(windows) ? windows : []).map(sanitizeOutputWindow)
}

/** True when a Firestore outputLayouts doc matches the windows[] preset schema. */
export function isOutputPresetDoc(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as { name?: unknown; windows?: unknown }
  return typeof d.name === 'string' && Array.isArray(d.windows)
}
