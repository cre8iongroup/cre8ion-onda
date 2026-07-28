/**
 * Tunable network health thresholds for Onda Operator.
 * Retune against on-site convention Wi‑Fi without hunting magic numbers.
 */
export const NETWORK_HEALTH = {
  /** RTT ≤ this → green (while capturing / after webhooks seen) */
  greenRttMsMax: 500,
  /** RTT ≤ this (and > green) → yellow; above → red */
  yellowRttMsMax: 1500,
  /** Last successful webhook older than this while capturing → red */
  staleWhileCapturingMs: 45_000,
}

/**
 * @param {{ rttMs: number | null, lastOkAt: number | null, online: boolean, capturing: boolean }} opts
 * @returns {'green' | 'yellow' | 'red'}
 */
export function networkHealthColor({ rttMs, lastOkAt, online, capturing }) {
  if (!online) return 'red'
  if (!capturing) {
    return 'green'
  }
  const now = Date.now()
  if (lastOkAt == null) {
    // Capturing but no webhook yet — yellow until first OK, not instant red
    return 'yellow'
  }
  const age = now - lastOkAt
  if (age > NETWORK_HEALTH.staleWhileCapturingMs) return 'red'
  if (rttMs == null) return 'yellow'
  if (rttMs <= NETWORK_HEALTH.greenRttMsMax) return 'green'
  if (rttMs <= NETWORK_HEALTH.yellowRttMsMax) return 'yellow'
  return 'red'
}
