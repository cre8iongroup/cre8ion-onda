/**
 * Deepgram streaming presets (Electron mirror of lib/recall/deepgramStreamingPresets.*).
 *
 * Primary: show.transcriptionStyle → TRANSCRIPTION_STYLE_TO_PRESET → presetId.
 * Optional: show.deepgramKeyterms → deepgram_streaming.keyterm (string[]).
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

/** Trim, drop empties, de-dupe (case-sensitive — Deepgram treats terms as-is). */
function normalizeDeepgramKeyterms(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const term = item.trim()
    if (!term || seen.has(term)) continue
    seen.add(term)
    out.push(term)
  }
  return out
}

function buildDeepgramStreamingConfig({ language, presetId, keyterms } = {}) {
  const id = resolvePresetId(presetId)
  const preset = presetsFile.presets[id]
  const normalizedKeyterms = normalizeDeepgramKeyterms(keyterms)
  const deepgram_streaming = {
    model: 'nova-3',
    language: language || 'en',
    ...preset.options,
  }
  if (normalizedKeyterms.length > 0) {
    // Recall deepgram_async types keyterm as string[]; deepgram_streaming leaves it
    // untyped. Deepgram's native streaming API wants repeated ?keyterm= query params
    // (SDKs explode arrays). We send a JSON array — same shape that works for async.
    // If live streaming shows no boost while async does, the gap is likely Recall's
    // forwarding into the Deepgram WebSocket URL, not this merge path.
    deepgram_streaming.keyterm = normalizedKeyterms
  }
  return {
    presetId: id,
    label: preset.label,
    notes: preset.notes,
    deepgram_streaming,
  }
}

module.exports = {
  TRANSCRIPTION_STYLE_TO_PRESET,
  presetIdForTranscriptionStyle,
  normalizeDeepgramKeyterms,
  buildDeepgramStreamingConfig,
  resolvePresetId,
}
