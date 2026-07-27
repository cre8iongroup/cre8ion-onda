/**
 * Svix signature verification for Recall workspace webhooks.
 *
 * Uses the official `svix` package — do not hand-roll HMAC checks.
 * Secret env: RECALL_SVIX_SIGNING_SECRET (from Recall dashboard → webhook endpoint).
 */
import { Webhook } from 'svix'

export class SvixVerificationError extends Error {
  code: 'missing_secret' | 'missing_headers' | 'invalid_signature'

  constructor(code: SvixVerificationError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export type SvixHeaders = {
  'svix-id'?: string | null
  'svix-timestamp'?: string | null
  'svix-signature'?: string | null
}

/**
 * Verify a raw request body against Svix signature headers.
 * Returns the parsed JSON payload on success.
 */
export function verifyRecallSvixPayload(
  rawBody: string,
  headers: SvixHeaders,
  signingSecret = process.env.RECALL_SVIX_SIGNING_SECRET,
): unknown {
  const secret = signingSecret?.trim()
  if (!secret) {
    throw new SvixVerificationError(
      'missing_secret',
      'RECALL_SVIX_SIGNING_SECRET is not configured',
    )
  }

  const id = headers['svix-id']?.trim()
  const timestamp = headers['svix-timestamp']?.trim()
  const signature = headers['svix-signature']?.trim()

  if (!id || !timestamp || !signature) {
    throw new SvixVerificationError(
      'missing_headers',
      'Missing required Svix headers (svix-id, svix-timestamp, svix-signature)',
    )
  }

  try {
    const wh = new Webhook(secret)
    return wh.verify(rawBody, {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new SvixVerificationError(
      'invalid_signature',
      `Svix signature verification failed: ${message}`,
    )
  }
}
