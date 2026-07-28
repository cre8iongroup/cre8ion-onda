/**
 * Node assert for caption partial coalesce (no Electron needed).
 * Run: node electron-spike/scripts/verify-caption-lines.js
 */
const assert = require('assert')
const {
  buildCaptionDisplayLines,
  isChunkFinalized,
} = require('../renderer-src/lib/captionLines.js')

assert.strictEqual(isChunkFinalized({ isFinalized: true }), true)
assert.strictEqual(isChunkFinalized({ isFinal: true }), true)
assert.strictEqual(isChunkFinalized({ isFinalized: false }), false)

const partialsThenFinal = buildCaptionDisplayLines([
  { id: 'a', text: 'Hello', timestamp: 1, sequenceNumber: 1, isFinalized: false },
  { id: 'b', text: 'Hello world', timestamp: 2, sequenceNumber: 2, isFinalized: false },
  { id: 'c', text: 'Hello world.', timestamp: 3, sequenceNumber: 3, isFinalized: true },
  { id: 'd', text: 'Next', timestamp: 4, sequenceNumber: 4, isFinalized: false },
])

assert.strictEqual(partialsThenFinal.length, 2)
assert.strictEqual(partialsThenFinal[0].text, 'Hello world.')
assert.strictEqual(partialsThenFinal[0].finalized, true)
assert.strictEqual(partialsThenFinal[0].id, 'c')
assert.strictEqual(partialsThenFinal[1].text, 'Next')
assert.strictEqual(partialsThenFinal[1].finalized, false)
assert.strictEqual(partialsThenFinal[1].id, 'caption-in-progress')

const onlyPartials = buildCaptionDisplayLines([
  { id: 'a', text: 'Hi', timestamp: 1, isFinalized: false },
  { id: 'b', text: 'Hi there', timestamp: 2, isFinalized: false },
])
assert.strictEqual(onlyPartials.length, 1)
assert.strictEqual(onlyPartials[0].text, 'Hi there')
assert.strictEqual(onlyPartials[0].finalized, false)

const twoFinals = buildCaptionDisplayLines([
  { id: '1', text: 'One.', timestamp: 1, isFinalized: true, speakerLabel: 'A' },
  { id: '2', text: 'Two.', timestamp: 2, isFinalized: true, speakerLabel: 'B' },
])
assert.strictEqual(twoFinals.length, 2)
assert.strictEqual(twoFinals[0].speakerLabel, 'A')
assert.strictEqual(twoFinals[1].speakerLabel, 'B')

console.log('verify-caption-lines: ok')
