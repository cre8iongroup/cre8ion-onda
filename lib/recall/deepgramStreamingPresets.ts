/**
 * Deepgram streaming presets for live caption formatting.
 *
 * Primary (production): show.transcriptionStyle → TRANSCRIPTION_STYLE_TO_PRESET
 *   → pass presetId into buildDeepgramStreamingConfig.
 * Fallback (dev / missing show field):
 *   1. Explicit presetId argument
 *   2. Env DEEPGRAM_STREAMING_PRESET
 *   3. JSON `active`
 *   4. baseline
 *
 * Style changes apply at Operator unlock / recording-start — re-unlock or
 * restart Operator after Admin changes mid-show. Do not change model/language
 * here — callers pass those.
 */

import presetsFile from './deepgramStreamingPresets.json'
import type { TranscriptionStyle } from '@/types'

export type DeepgramStreamingPresetId =
  | 'baseline'
  | 'punctuate'
  | 'punctuate_endpointing'

/** Single source of truth: Admin Transcription style → Deepgram preset id. */
export const TRANSCRIPTION_STYLE_TO_PRESET: Record<
  TranscriptionStyle,
  DeepgramStreamingPresetId
> = {
  standard: 'baseline',
  lightweight: 'punctuate',
}

type PresetFile = {
  active: string
  presets: Record<
    string,
    {
      label: string
      notes: string
      options: Record<string, string | number | boolean>
    }
  >
}

const file = presetsFile as PresetFile

/**
 * Map a show transcriptionStyle to a preset id.
 * Unknown / missing → null (caller should fall through to env/JSON).
 */
export function presetIdForTranscriptionStyle(
  style?: string | null,
): DeepgramStreamingPresetId | null {
  if (style === 'standard' || style === 'lightweight') {
    return TRANSCRIPTION_STYLE_TO_PRESET[style]
  }
  return null
}

export function resolveDeepgramStreamingPresetId(
  override?: string | null,
): DeepgramStreamingPresetId {
  const raw = (override || process.env.DEEPGRAM_STREAMING_PRESET || file.active || 'baseline')
    .trim()
    .toLowerCase()
  if (raw in file.presets) {
    return raw as DeepgramStreamingPresetId
  }
  console.warn(
    `[deepgramStreamingPresets] unknown preset ${JSON.stringify(raw)}; falling back to baseline`,
  )
  return 'baseline'
}

export function buildDeepgramStreamingConfig(opts: {
  language: string
  presetId?: string | null
}): {
  presetId: DeepgramStreamingPresetId
  label: string
  notes: string
  deepgram_streaming: Record<string, string | number | boolean>
} {
  const presetId = resolveDeepgramStreamingPresetId(opts.presetId)
  const preset = file.presets[presetId]
  return {
    presetId,
    label: preset.label,
    notes: preset.notes,
    deepgram_streaming: {
      model: 'nova-3',
      language: opts.language || 'en',
      ...preset.options,
    },
  }
}
