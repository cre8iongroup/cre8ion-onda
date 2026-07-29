/**
 * Deepgram streaming presets (Electron mirror of lib/recall/deepgramStreamingPresets.*).
 *
 * Primary: show.transcriptionStyle → TRANSCRIPTION_STYLE_TO_PRESET → presetId.
 * Fallback when style absent: DEEPGRAM_STREAMING_PRESET env, then JSON `active`, then baseline.
 *
 * Keep in sync with lib/recall/deepgramStreamingPresets.ts.
 *
 * Asset resolution:
 * - Packaged: electron-builder copies ../lib/recall/*.json → app.asar/lib/recall/
 * - Dev: monorepo shared file at ../../lib/recall/
 */

const fs = require('fs')
const path = require('path')

function loadPresetsFile() {
  const candidates = [
    path.join(__dirname, 'recall', 'deepgramStreamingPresets.json'),
    path.join(__dirname, '..', '..', 'lib', 'recall', 'deepgramStreamingPresets.json'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'))
    }
  }
  throw new Error(
    'Cannot find deepgramStreamingPresets.json (packaged lib/recall or monorepo lib/recall)',
  )
}

const presetsFile = loadPresetsFile()

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
