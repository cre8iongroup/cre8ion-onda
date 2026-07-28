/**
 * Hardware-level mic input meter tap (renderer-only).
 *
 * Uses getUserMedia + AnalyserNode — independent of Recall Desktop SDK capture.
 * Intended for Slice 2B concurrency validation and the eventual operator meter.
 *
 * Guardrails baked in for macOS shared-device coexistence:
 * - echoCancellation: false (avoids exclusive Voice-Processing I/O unit)
 * - noiseSuppression / autoGainControl: false (don't fight Recall's DSP)
 */

/** @typedef {{ level: number, peak: number, rms: number, at: number }} MeterSample */

/**
 * @param {object} [opts]
 * @param {(sample: MeterSample) => void} [opts.onSample]
 * @param {(err: Error) => void} [opts.onError]
 * @param {MediaTrackConstraints} [opts.audioConstraints]
 */
export function createInputMeterTap(opts = {}) {
  const onSample = opts.onSample || (() => {})
  const onError = opts.onError || (() => {})
  const audioConstraints = opts.audioConstraints || {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }

  /** @type {MediaStream | null} */
  let stream = null
  /** @type {AudioContext | null} */
  let audioContext = null
  /** @type {AnalyserNode | null} */
  let analyser = null
  /** @type {MediaStreamAudioSourceNode | null} */
  let source = null
  /** @type {Uint8Array | null} */
  let timeDomain = null
  let rafId = 0
  let running = false
  let sampleCount = 0
  let windowStart = 0
  let updatesPerSec = 0
  let lastSampleAt = 0
  let peakHold = 0
  let deviceLabel = ''
  let trackState = 'none'

  function readTrackState() {
    const track = stream?.getAudioTracks()?.[0]
    if (!track) {
      trackState = 'none'
      return
    }
    trackState = `${track.readyState}${track.muted ? '+muted' : ''}${track.enabled ? '' : '+disabled'}`
    deviceLabel = track.label || deviceLabel
  }

  function tick() {
    if (!running || !analyser || !timeDomain) return
    analyser.getByteTimeDomainData(timeDomain)

    let sumSq = 0
    let peak = 0
    for (let i = 0; i < timeDomain.length; i += 1) {
      const v = (timeDomain[i] - 128) / 128
      const abs = Math.abs(v)
      if (abs > peak) peak = abs
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / timeDomain.length)
    // Map RMS → 0–100 with light headroom (speech typically << 1.0)
    const level = Math.min(100, Math.round(rms * 280))
    peakHold = Math.max(peakHold * 0.96, peak * 100)
    const at = performance.now()
    lastSampleAt = at
    sampleCount += 1
    if (at - windowStart >= 1000) {
      updatesPerSec = sampleCount
      sampleCount = 0
      windowStart = at
      readTrackState()
    }

    onSample({
      level,
      peak: Math.min(100, Math.round(peakHold)),
      rms: Number(rms.toFixed(4)),
      at,
    })
    rafId = requestAnimationFrame(tick)
  }

  async function start() {
    if (running) return getSnapshot()
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      const track = stream.getAudioTracks()[0]
      deviceLabel = track?.label || 'Default microphone'
      readTrackState()

      const AC = window.AudioContext || window.webkitAudioContext
      audioContext = new AC()
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.8
      source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      // Intentionally NOT connected to destination — meter only, no monitoring loop
      timeDomain = new Uint8Array(analyser.fftSize)

      running = true
      windowStart = performance.now()
      sampleCount = 0
      updatesPerSec = 0
      rafId = requestAnimationFrame(tick)
      return getSnapshot()
    } catch (err) {
      await stop()
      const error = err instanceof Error ? err : new Error(String(err))
      onError(error)
      throw error
    }
  }

  async function stop() {
    running = false
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    try {
      source?.disconnect()
    } catch {
      /* ignore */
    }
    source = null
    analyser = null
    timeDomain = null
    if (audioContext) {
      try {
        await audioContext.close()
      } catch {
        /* ignore */
      }
    }
    audioContext = null
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
    }
    stream = null
    trackState = 'none'
    return getSnapshot()
  }

  function getSnapshot() {
    const stalled =
      running && lastSampleAt > 0 && performance.now() - lastSampleAt > 750
    return {
      running,
      deviceLabel,
      trackState,
      updatesPerSec,
      lastSampleAt,
      stalled,
      echoCancellation: Boolean(audioConstraints.echoCancellation),
      noiseSuppression: Boolean(audioConstraints.noiseSuppression),
      autoGainControl: Boolean(audioConstraints.autoGainControl),
    }
  }

  return { start, stop, getSnapshot }
}
