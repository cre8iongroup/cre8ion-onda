/**
 * Load Show glossary text-correction rules for a live session.
 * Cached briefly so partial transcript webhooks don't hammer Firestore.
 */

import { FieldPath } from 'firebase-admin/firestore'
import { getAdminFirestore } from '@/lib/firebase/admin'
import {
  textCorrectionsFromGlossary,
  type TextCorrectionRule,
} from '@/lib/recall/applyTextCorrections'

type CacheEntry = {
  expiresAt: number
  rules: TextCorrectionRule[]
}

const CACHE_TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()

export async function loadTextCorrectionsForSession(
  sessionId: string,
): Promise<TextCorrectionRule[]> {
  if (!sessionId) return []

  const now = Date.now()
  const hit = cache.get(sessionId)
  if (hit && hit.expiresAt > now) return hit.rules

  try {
    const firestore = getAdminFirestore()
    const sessionsQuery = await firestore
      .collectionGroup('sessions')
      .where(FieldPath.documentId(), '==', sessionId)
      .limit(1)
      .get()

    if (sessionsQuery.empty) {
      cache.set(sessionId, { expiresAt: now + CACHE_TTL_MS, rules: [] })
      return []
    }

    const showRef = sessionsQuery.docs[0].ref.parent.parent
    if (!showRef) {
      cache.set(sessionId, { expiresAt: now + CACHE_TTL_MS, rules: [] })
      return []
    }

    const showSnap = await showRef.get()
    const glossary = showSnap.data()?.glossary
    const rules = textCorrectionsFromGlossary(
      Array.isArray(glossary) ? glossary : [],
    )
    cache.set(sessionId, { expiresAt: now + CACHE_TTL_MS, rules })
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
