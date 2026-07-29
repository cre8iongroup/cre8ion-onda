/**
 * Deepgram streaming presets (Electron mirror of lib/recall/deepgramStreamingPresets.*).
 *
 * Primary: show.transcriptionStyle → TRANSCRIPTION_STYLE_TO_PRESET → presetId.
 * Fallback when style absent: DEEPGRAM_STREAMING_PRESET env, then JSON `active`, then baseline.
 *
 * Keep in sync with lib/recall/deepgramStreamingPresets.ts.
 */

const presetsFile = require('../../lib/recall/deepgramStreamingPresets.json')

/** Single source of truth: Admin Transcription style → Deepgram preset id. */
const TRANSCRIPTION_STYLE_TO_PRESET = {
  standard: 'baseline',
  lightweight: 'punctuate',
}

function presetIdForTranscriptionStyle(style) {
  if (style === 'standard' || style === 'lightweight') {
    return TRANSCRIPTION_STYLE_TO_PRESET[style]
  }
  return null
}

function resolvePresetId(override) {
  const raw = String(
    override || process.env.DEEPGRAM_STREAMING_PRESET || presetsFile.active || 'baseline',
  )
    .trim()
    .toLowerCase()
  if (presetsFile.presets[raw]) return raw
  console.warn(
    `[deepgramStreamingPresets] unknown preset ${JSON.stringify(raw)}; falling back to baseline`,
  )
  return 'baseline'
}

function buildDeepgramStreamingConfig({ language, presetId } = {}) {
  const id = resolvePresetId(presetId)
  const preset = presetsFile.presets[id]
  return {
    presetId: id,
    label: preset.label,
    notes: preset.notes,
    deepgram_streaming: {
      model: 'nova-3',
      language: language || 'en',
      ...preset.options,
    },
  }
}

module.exports = {
  TRANSCRIPTION_STYLE_TO_PRESET,
  presetIdForTranscriptionStyle,
  buildDeepgramStreamingConfig,
  resolvePresetId,
}
