/**
 * Load Show glossary text-correction rules for a live session.
 * Cached briefly so partial transcript webhooks don't hammer Firestore.
 *
 * Session → show resolution: read `showId` from RTDB `liveSessions/{sessionId}`
 * (written at sound-check start). Do NOT use collectionGroup + FieldPath.documentId()
 * with a bare session id — that filter expects a full document path and never
 * matches `shows/{showId}/sessions/{sessionId}` (empty rules / thrown invalid query).
 */

import { getAdminFirestore, getRtdbJson } from '@/lib/firebase/admin'
import { rtdbLiveSessionPath } from '@/lib/rtdbPaths'
import {
  textCorrectionsFromGlossary,
  type TextCorrectionRule,
} from '@/lib/recall/applyTextCorrections'

type CacheEntry = {
  expiresAt: number
  rules: TextCorrectionRule[]
  showId: string
}

const CACHE_TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()

export async function loadTextCorrectionsForSession(
  sessionId: string,
): Promise<TextCorrectionRule[]> {
  if (!sessionId) return []

  const now = Date.now()
  const hit = cache.get(sessionId)
  if (hit && hit.expiresAt > now) {
    console.info('[loadTextCorrectionsForSession] cache hit', {
      sessionId,
      showId: hit.showId,
      ruleCount: hit.rules.length,
    })
    return hit.rules
  }

  try {
    const liveMeta = await getRtdbJson<{ showId?: string }>(rtdbLiveSessionPath(sessionId))
    const showId =
      typeof liveMeta?.showId === 'string' && liveMeta.showId.trim()
        ? liveMeta.showId.trim()
        : null

    if (!showId) {
      // Do not cache — liveSessions may not be written yet on the first chunk.
      console.warn('[loadTextCorrectionsForSession] no showId on live session', {
        sessionId,
        liveMetaKeys: liveMeta && typeof liveMeta === 'object' ? Object.keys(liveMeta) : [],
      })
      return []
    }

    const firestore = getAdminFirestore()
    const showSnap = await firestore.doc(`shows/${showId}`).get()
    if (!showSnap.exists) {
      console.warn('[loadTextCorrectionsForSession] show doc missing', { sessionId, showId })
      return []
    }

    const glossary = showSnap.data()?.glossary
    const glossaryEntries = Array.isArray(glossary) ? glossary : []
    const rules = textCorrectionsFromGlossary(glossaryEntries)

    console.info('[loadTextCorrectionsForSession] loaded', {
      sessionId,
      showId,
      glossaryEntryCount: glossaryEntries.length,
      ruleCount: rules.length,
      rules: rules.map((r) => `${r.from}→${r.to}`),
      sampleTerms: glossaryEntries
        .slice(0, 5)
        .map((e: { term?: unknown; alsoHeardAs?: unknown }) => ({
          term: typeof e?.term === 'string' ? e.term : null,
          alsoHeardAs: Array.isArray(e?.alsoHeardAs) ? e.alsoHeardAs : [],
        })),
    })

    cache.set(sessionId, { expiresAt: now + CACHE_TTL_MS, rules, showId })
    return rules
  } catch (err) {
    console.warn('[loadTextCorrectionsForSession] failed', {
      sessionId,
      message: err instanceof Error ? err.message : String(err),
    })
    return hit?.rules ?? []
  }
}

/** Test helper — clear session correction cache. */
export function __clearTextCorrectionCache() {
  cache.clear()
}
