/**
 * Offline unit check for normalizeToOndaPayload (no Electron / Recall needed).
 */
const assert = require('assert')
const { normalizeToOndaPayload, extractRecallTranscript } = require('../lib/normalizeTranscript')

const onda = normalizeToOndaPayload(
  {
    sessionId: 's1',
    text: 'hello from onda',
    speaker: 'Host',
    timestamp: 1000,
    isFinal: true,
    sequenceNumber: 3,
  },
  's1',
)
assert.strictEqual(onda.text, 'hello from onda')
assert.strictEqual(onda.sequenceNumber, 3)

const recallEvt = {
  event: 'transcript.data',
  data: {
    data: {
      words: [{ text: 'Hello' }, { text: 'world' }],
      participant: { id: 1, name: 'Host' },
    },
  },
}

const fromRecall = normalizeToOndaPayload(recallEvt, 'spike-session', { sequenceNumber: 1 })
assert.ok(fromRecall)
assert.strictEqual(fromRecall.text, 'Hello world')
assert.strictEqual(fromRecall.speaker, 'Host')
assert.strictEqual(fromRecall.isFinal, true)
assert.strictEqual(fromRecall.sessionId, 'spike-session')

const partial = normalizeToOndaPayload(
  { event: 'transcript.partial_data', data: { data: { words: [{ text: 'Hi' }] } } },
  'spike-session',
)
assert.strictEqual(partial.isFinal, false)

const extracted = extractRecallTranscript(recallEvt)
assert.strictEqual(extracted.text, 'Hello world')

console.log('verify-normalize: OK')
