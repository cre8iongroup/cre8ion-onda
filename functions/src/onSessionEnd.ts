import * as functions from 'firebase-functions/v1'
import * as admin from 'firebase-admin'

if (!admin.apps.length) admin.initializeApp()
const db = admin.database()
const firestore = admin.firestore()

/**
 * RTDB Trigger — fires when feedState changes at /liveSessions/{sessionId}/feedState
 *
 * When feedState transitions to 'ended':
 *   1. Reads all chunks from /liveSessions/{sessionId}/chunks
 *   2. Resolves showId from RTDB liveSessions/{sessionId}.showId
 *   3. Writes all chunks to Firestore at shows/{showId}/sessions/{sessionId}/transcripts/
 *      ordered by sequenceNumber
 *   4. Sets session feedState to 'ended'
 *   5. Deletes the /liveSessions/{sessionId} RTDB node (cleanup)
 *      Note: does NOT touch outputLive/{roomId} — that tree is independent of session lifecycle.
 *   6. Writes an audit log entry
 */
export const onSessionEnd = functions.database
  .ref('/liveSessions/{sessionId}/feedState')
  .onWrite(async (change, context) => {
    const { sessionId } = context.params
    const newState = change.after.val()

    if (newState !== 'ended') return null

    functions.logger.info('onSessionEnd: session ended, migrating to Firestore', { sessionId })

    try {
      // ── 1. Read all RTDB chunks
      const chunksSnap = await db.ref(`/liveSessions/${sessionId}/chunks`).get()
      const rawChunks = chunksSnap.val() as Record<string, any> | null

      if (!rawChunks) {
        functions.logger.warn('onSessionEnd: no chunks found in RTDB', { sessionId })
      }

      // ── 2. Resolve show via RTDB liveSessions.showId (not broken collectionGroup documentId)
      const liveSnap = await db.ref(`/liveSessions/${sessionId}`).get()
      const liveMeta = liveSnap.val() as { showId?: string } | null
      const showId =
        typeof liveMeta?.showId === 'string' && liveMeta.showId.trim()
          ? liveMeta.showId.trim()
          : null

      if (!showId) {
        functions.logger.error('onSessionEnd: no showId on live session', { sessionId })
        return null
      }

      const sessionRef = firestore.doc(`shows/${showId}/sessions/${sessionId}`)
      const sessionSnap = await sessionRef.get()
      if (!sessionSnap.exists) {
        functions.logger.error('onSessionEnd: session not found in Firestore', {
          sessionId,
          showId,
        })
        return null
      }

      // ── 3. Batch write chunks to Firestore transcripts subcollection
      if (rawChunks) {
        const chunks = Object.values(rawChunks) as any[]
        // Sort by sequenceNumber for deterministic ordering
        chunks.sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))

        // Firestore batch limit is 500 — chunk writes if needed
        const BATCH_SIZE = 400
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
          const batch = firestore.batch()
          const slice = chunks.slice(i, i + BATCH_SIZE)

          for (const chunk of slice) {
            const transcriptRef = sessionRef.collection('transcripts').doc()
            batch.set(transcriptRef, {
              text: chunk.text ?? '',
              speakerLabel: chunk.speakerLabel ?? null,
              timestamp: admin.firestore.Timestamp.fromMillis(chunk.timestamp ?? Date.now()),
              sequenceNumber: chunk.sequenceNumber ?? 0,
              translations: chunk.translations ?? {},
              isFinalized: chunk.isFinalized ?? true,
            })
          }
          await batch.commit()
        }

        functions.logger.info('onSessionEnd: transcripts written to Firestore', {
          sessionId,
          chunkCount: chunks.length,
        })
      }

      // ── 4. Update session feedState to 'ended'
      await sessionRef.update({
        feedState: 'ended',
      })

      // ── 5. Clean up RTDB ephemeral node
      await db.ref(`/liveSessions/${sessionId}`).remove()
      functions.logger.info('onSessionEnd: RTDB node cleaned up', { sessionId })

      // ── 6. Write audit log
      await firestore.collection('auditLog').add({
        action: 'SESSION_FEED_STOPPED',
        performedBy: 'system',
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
        showId,
        sessionId,
        metadata: { chunkCount: rawChunks ? Object.keys(rawChunks).length : 0 },
      })

      return null
    } catch (err) {
      functions.logger.error('onSessionEnd: migration failed', err)
      throw err
    }
  })
