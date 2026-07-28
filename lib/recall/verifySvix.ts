/**
 * Svix / Standard Webhooks signature verification for Recall workspace webhooks.
 *
 * Uses the official `svix` package — do not hand-roll HMAC checks.
 * Secret env: RECALL_SVIX_SIGNING_SECRET (from Recall dashboard → webhook endpoint).
 *
 * Header names (either brand is valid — the `svix` Webhook.verify() accepts both):
 *   - Recall docs / unbranded Standard Webhooks:
 *       webhook-id, webhook-timestamp, webhook-signature
 *       (HTTP may capitalize as Webhook-Id / Webhook-Timestamp / Webhook-Signature)
 *   - Svix-branded:
 *       svix-id, svix-timestamp, svix-signature
 *
 * Do NOT pre-reject on hardcoded `svix-*` only — that caused live Recall deliveries
 * to 401 with "Missing required Svix headers" even when webhook-* were present.
 */
import { Webhook } from 'svix'

export class SvixVerificationError extends Error {
  code: 'missing_secret' | 'missing_headers' | 'invalid_signature'

  constructor(code: SvixVerificationError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/** Any header bag we can flatten into a Record for Webhook.verify(). */
export type SvixHeaderInput =
  | Headers
  | Record<string, string | string[] | null | undefined>

/**
 * Flatten incoming headers to a lowercase string map for `Webhook.verify()`.
 * The official svix package then resolves svix-* ↔ webhook-* itself.
 */
export function flattenHeadersForSvix(headers: SvixHeaderInput): Record<string, string> {
  const out: Record<string, string> = {}

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value
    })
    return out
  }

  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value == null) continue
    const v = Array.isArray(value) ? value[0] : value
    if (typeof v !== 'string' || !v) continue
    out[key.toLowerCase()] = v
  }
  return out
}

/** Sorted list of header names only (never values) — safe to log. */
export function listIncomingHeaderNames(headers: SvixHeaderInput): string[] {
  return Object.keys(flattenHeadersForSvix(headers)).sort()
}

/**
 * Verify a raw request body against Standard Webhooks / Svix signature headers.
 * Returns the parsed JSON payload on success.
 *
 * Pass the full request headers — do not strip down to svix-* beforehand.
 */
export function verifyRecallSvixPayload(
  rawBody: string,
  headers: SvixHeaderInput,
  signingSecret = process.env.RECALL_SVIX_SIGNING_SECRET,
): unknown {
  const secret = signingSecret?.trim()
  if (!secret) {
    throw new SvixVerificationError(
      'missing_secret',
      'RECALL_SVIX_SIGNING_SECRET is not configured',
    )
  }

  const headerRecord = flattenHeadersForSvix(headers)

  try {
    const wh = new Webhook(secret)
    // Official package accepts either svix-* or webhook-* (see Webhook.verify).
    return wh.verify(rawBody, headerRecord)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // standardwebhooks throws when required headers are empty/missing after normalize
    const looksMissing =
      /missing|empty|required/i.test(message) ||
      (!headerRecord['svix-id'] &&
        !headerRecord['webhook-id'] &&
        !headerRecord['svix-timestamp'] &&
        !headerRecord['webhook-timestamp'] &&
        !headerRecord['svix-signature'] &&
        !headerRecord['webhook-signature'])

    if (looksMissing) {
      throw new SvixVerificationError(
        'missing_headers',
        'Missing required webhook verification headers ' +
          '(webhook-id/timestamp/signature or svix-id/timestamp/signature)',
      )
    }

    throw new SvixVerificationError(
      'invalid_signature',
      `Svix signature verification failed: ${message}`,
    )
  }
}
