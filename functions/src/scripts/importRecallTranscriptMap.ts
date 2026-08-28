/**
 * Map a Recall transcript download body onto Onda TranscriptChunk fields.
 *
 * Expected (documented) shape — JSON transcript download_url:
 *   https://docs.recall.ai/docs/download-schemas#json-transcript-download-url
 *
 *   [
 *     {
 *       participant: { id, name, ... },
 *       language_code: string,
 *       words: [{ text, start_timestamp: { absolute, relative }, end_timestamp }]
 *     },
 *     ...
 *   ]
 *
 * That is 1:1 with live webhook chunks (one utterance → one Firestore doc).
 * Anything else is treated as unrecognized — the CLI prints the raw shape
 * and refuses --write rather than guessing a more complex mapping.
 */

export type MappedChunk = {
  text: string
  speakerLabel: string | null
  sequenceNumber: number
  timestampMs: number
  isFinalized: true
  translations: Record<string, never>
}

export type TranscriptShapeSummary = {
  parsedType: string
  arrayLength: number | null
  firstItemKeys: string[] | null
  firstItemWordCount: number | null
  firstWordKeys: string[] | null
  sampleJson: string
}

export type MapSuccess = {
  ok: true
  format: 'recall_utterance_array'
  chunks: MappedChunk[]
  skippedEmptyUtterances: number
}

export type MapFailure = {
  ok: false
  format: 'unrecognized'
  reason: string
}

export type MapResult = MapSuccess | MapFailure

type RecallWord = {
  text?: unknown
  word?: unknown
  start_timestamp?: { absolute?: unknown; relative?: unknown }
}

type RecallUtterance = {
  participant?: { id?: unknown; name?: unknown }
  language_code?: unknown
  words?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function wordText(word: RecallWord): string {
  if (typeof word.text === 'string' && word.text.trim()) return word.text.trim()
  if (typeof word.word === 'string' && word.word.trim()) return word.word.trim()
  return ''
}

function isUtteranceLike(item: unknown): item is RecallUtterance {
  if (!isPlainObject(item)) return false
  return Array.isArray(item.words)
}

/**
 * Unwrap one documented wrapper if present (`{ data: [...] }`).
 * Does not unwrap provider_data or Deepgram channel payloads.
 */
export function unwrapTranscriptBody(raw: unknown): unknown {
  if (isPlainObject(raw) && Array.isArray(raw.data) && raw.data.every(isUtteranceLike)) {
    return raw.data
  }
  return raw
}

export function summarizeTranscriptShape(raw: unknown): TranscriptShapeSummary {
  const parsedType = Array.isArray(raw) ? 'array' : raw === null ? 'null' : typeof raw
  const arrayLength = Array.isArray(raw) ? raw.length : null

  let firstItemKeys: string[] | null = null
  let firstItemWordCount: number | null = null
  let firstWordKeys: string[] | null = null
  let sampleTarget: unknown = raw

  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0]
    if (isPlainObject(first)) {
      firstItemKeys = Object.keys(first)
      if (Array.isArray(first.words)) {
        firstItemWordCount = first.words.length
        const firstWord = first.words[0]
        if (isPlainObject(firstWord)) firstWordKeys = Object.keys(firstWord)
      }
      sampleTarget = {
        ...first,
        words: Array.isArray(first.words)
          ? (first.words as unknown[]).slice(0, 3)
          : first.words,
      }
    } else {
      sampleTarget = first
    }
  } else if (isPlainObject(raw)) {
    firstItemKeys = Object.keys(raw)
    sampleTarget = Object.fromEntries(
      Object.entries(raw).slice(0, 12).map(([k, v]) => {
        if (Array.isArray(v)) return [k, `[array length ${v.length}]`]
        if (isPlainObject(v)) return [k, `{keys: ${Object.keys(v).join(', ')}}`]
        return [k, v]
      }),
    )
  }

  let sampleJson: string
  try {
    sampleJson = JSON.stringify(sampleTarget, null, 2)
  } catch {
    sampleJson = String(sampleTarget)
  }
  if (sampleJson.length > 4000) {
    sampleJson = `${sampleJson.slice(0, 4000)}\n… (truncated)`
  }

  return {
    parsedType,
    arrayLength,
    firstItemKeys,
    firstItemWordCount,
    firstWordKeys,
    sampleJson,
  }
}

function utteranceTimestampMs(
  words: RecallWord[],
  fallbackBaseMs: number,
): number {
  const first = words[0]
  const abs = first?.start_timestamp?.absolute
  if (typeof abs === 'string') {
    const parsed = Date.parse(abs)
    if (!Number.isNaN(parsed)) return parsed
  }
  const rel = first?.start_timestamp?.relative
  if (typeof rel === 'number' && Number.isFinite(rel)) {
    return Math.round(fallbackBaseMs + rel * 1000)
  }
  return fallbackBaseMs
}

function speakerLabelFrom(utterance: RecallUtterance): string | null {
  const name = utterance.participant?.name
  if (typeof name === 'string' && name.trim()) return name.trim()
  return null
}

/**
 * Map Recall's documented utterance-array download onto TranscriptChunk fields.
 * Returns ok:false (do not guess) when the body is not that array.
 */
export function mapRecallTranscriptDownload(
  raw: unknown,
  opts?: { fallbackBaseMs?: number },
): MapResult {
  const body = unwrapTranscriptBody(raw)
  const fallbackBaseMs = opts?.fallbackBaseMs ?? Date.now()

  if (!Array.isArray(body)) {
    return {
      ok: false,
      format: 'unrecognized',
      reason:
        `Transcript download is ${body === null ? 'null' : typeof body}, not the documented ` +
        `utterance array ([{ participant, words }]). Refusing to guess a mapping.`,
    }
  }

  if (body.length === 0) {
    return {
      ok: true,
      format: 'recall_utterance_array',
      chunks: [],
      skippedEmptyUtterances: 0,
    }
  }

  const nonUtteranceIndex = body.findIndex((item) => !isUtteranceLike(item))
  if (nonUtteranceIndex !== -1) {
    const bad = body[nonUtteranceIndex]
    const badType = Array.isArray(bad) ? 'array' : bad === null ? 'null' : typeof bad
    const badKeys = isPlainObject(bad) ? Object.keys(bad).join(', ') : ''
    return {
      ok: false,
      format: 'unrecognized',
      reason:
        `Transcript download is an array, but item[${nonUtteranceIndex}] is not an utterance ` +
        `with a words[] array (type=${badType}${badKeys ? `, keys=${badKeys}` : ''}). ` +
        `This is not the documented Recall JSON transcript schema — refusing to guess.`,
    }
  }

  const chunks: MappedChunk[] = []
  let skippedEmptyUtterances = 0

  for (const item of body as RecallUtterance[]) {
    const words = (item.words as RecallWord[]) ?? []
    const text = words
      .map(wordText)
      .filter(Boolean)
      .join(' ')
      .trim()

    if (!text) {
      skippedEmptyUtterances += 1
      continue
    }

    chunks.push({
      text,
      speakerLabel: speakerLabelFrom(item),
      sequenceNumber: chunks.length,
      timestampMs: utteranceTimestampMs(words, fallbackBaseMs),
      isFinalized: true,
      translations: {},
    })
  }

  return {
    ok: true,
    format: 'recall_utterance_array',
    chunks,
    skippedEmptyUtterances,
  }
}
