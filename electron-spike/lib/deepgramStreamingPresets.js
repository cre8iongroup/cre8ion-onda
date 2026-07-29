/**
 * Deepgram streaming A/B presets (Electron mirror of lib/recall/deepgramStreamingPresets.*).
 *
 * Switch for a listening test (pick ONE):
 *   1. Edit `active` in ../../lib/recall/deepgramStreamingPresets.json
 *   2. Or set DEEPGRAM_STREAMING_PRESET in electron-spike/.env (overrides JSON)
 *
 * Restart Operator after changing. Keep this file's require path in sync with Next.
 */

const presetsFile = require('../../lib/recall/deepgramStreamingPresets.json')

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
  buildDeepgramStreamingConfig,
  resolvePresetId,
}
