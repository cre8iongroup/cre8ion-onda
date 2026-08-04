/**
 * Quick local verification of caption language mapping rules.
 * Run: npx tsx scripts/verify-caption-language.ts
 */
import {
  mapChunksForCaptionLanguage,
  normalizeCaptionLanguages,
  resolveCaptionTextForLanguage,
} from '../lib/attendee/captionLanguage'
import { buildCaptionDisplayLines } from '../lib/attendee/captionLines'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const partial = {
  id: 'p1',
  text: 'Hello wor',
  isFinalized: false,
  timestamp: 1,
  sequenceNumber: 1,
  translations: {},
}

const finalEn = {
  id: 'f1',
  text: 'Hello world',
  isFinalized: true,
  timestamp: 2,
  sequenceNumber: 2,
  translations: { es: 'Hola mundo', pt: 'Olá mundo' },
}

const finalMissingFr = {
  id: 'f2',
  text: 'Goodbye',
  isFinalized: true,
  timestamp: 3,
  sequenceNumber: 3,
  translations: { es: 'Adiós' },
}

assert(resolveCaptionTextForLanguage(partial, 'en') === 'Hello wor', 'en partial')
assert(resolveCaptionTextForLanguage(partial, 'es') === null, 'es hides partial')
assert(resolveCaptionTextForLanguage(finalEn, 'es') === 'Hola mundo', 'es final')
assert(resolveCaptionTextForLanguage(finalMissingFr, 'fr') === null, 'fr missing skip')
assert(resolveCaptionTextForLanguage(finalMissingFr, 'en') === 'Goodbye', 'en always')

const enLines = buildCaptionDisplayLines(
  mapChunksForCaptionLanguage([partial, finalEn, finalMissingFr], 'en'),
)
// captionLines clears in-progress when a later final arrives
assert(enLines.length === 2, `en lines expected 2 got ${enLines.length}`)
assert(enLines.every((l) => l.finalized), 'en all finalized when trailing finals exist')
assert(enLines[0].text === 'Hello world', 'en final')
assert(enLines[1].text === 'Goodbye', 'en goodbye')

const enLive = buildCaptionDisplayLines(mapChunksForCaptionLanguage([partial], 'en'))
assert(enLive.length === 1 && !enLive[0].finalized && enLive[0].text === 'Hello wor', 'en live partial')

const esLines = buildCaptionDisplayLines(
  mapChunksForCaptionLanguage([partial, finalEn, finalMissingFr], 'es'),
)
assert(esLines.length === 2, `es lines expected 2 got ${esLines.length}`)
assert(esLines.every((l) => l.finalized), 'es only finals')
assert(esLines[0].text === 'Hola mundo', 'es text')
assert(esLines[1].text === 'Adiós', 'es goodbye')

const frLines = buildCaptionDisplayLines(
  mapChunksForCaptionLanguage([partial, finalEn, finalMissingFr], 'fr'),
)
assert(frLines.length === 0, 'fr none until translations')

assert(normalizeCaptionLanguages(['es', 'pt']).join(',') === 'en,es,pt', 'normalize adds en')
assert(normalizeCaptionLanguages([]).join(',') === 'en', 'normalize empty')

console.log('verify-caption-language: ok')
