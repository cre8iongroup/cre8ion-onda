/**
 * POST sample payloads at the running Next.js webhook to confirm shape handling.
 *
 * Usage (from repo root, with Next.dev + env):
 *   RECALL_WEBHOOK_SECRET=... SESSION_ID=spike-test \
 *     npx tsx scripts/verify-recall-webhook-shapes.ts
 *
 * Does NOT prove mic→SDK. Proves webhook accepts Onda + Recall envelopes.
 */

const secret = process.env.RECALL_WEBHOOK_SECRET
const base = process.env.ONDA_WEBHOOK_URL || 'http://localhost:3000/api/recall/webhook'
const sessionId = process.env.SESSION_ID || `spike-verify-${Date.now()}`

if (!secret) {
  console.error('RECALL_WEBHOOK_SECRET is required')
  process.exit(1)
}

async function post(label: string, url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-recall-secret': secret!,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  console.log(`\n[${label}] ${res.status} ${url}`)
  console.log(text)
  return res.ok
}

async function main() {
  const ondaOk = await post('onda-custom', base, {
    sessionId,
    text: 'Spike verify: Onda custom payload',
    speaker: 'Host',
    timestamp: Date.now(),
    isFinal: true,
    sequenceNumber: 1,
  })

  const recallUrl = `${base}${base.includes('?') ? '&' : '?'}sessionId=${encodeURIComponent(sessionId)}`
  const recallOk = await post('recall-transcript.data', recallUrl, {
    event: 'transcript.data',
    data: {
      data: {
        words: [{ text: 'Spike' }, { text: 'verify:' }, { text: 'Recall' }, { text: 'envelope' }],
        participant: { id: 1, name: 'Host' },
      },
    },
  })

  if (!ondaOk || !recallOk) {
    console.error('\nOne or more posts failed. Is Next running with Admin SDK + RECALL_WEBHOOK_SECRET?')
    process.exit(1)
  }

  console.log(`\nOK — check RTDB liveSessions/${sessionId}/chunks`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
