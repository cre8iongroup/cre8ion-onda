/**
 * Deepgram streaming A/B presets for live caption speed/format tuning.
 *
 * Switch for a listening test (pick ONE):
 *   1. Edit `active` in deepgramStreamingPresets.json  → "baseline" | "punctuate" | "punctuate_endpointing"
 *   2. Or set env DEEPGRAM_STREAMING_PRESET to the same name (overrides JSON `active`)
 *
 * Then restart Operator (and Next if using /api/recall/sdk-upload).
 * Do not change model/language here — callers pass those.
 */

import presetsFile from './deepgramStreamingPresets.json'

export type DeepgramStreamingPresetId =
  | 'baseline'
  | 'punctuate'
  | 'punctuate_endpointing'

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
