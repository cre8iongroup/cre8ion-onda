import * as functions from 'firebase-functions/v1'
import * as admin from 'firebase-admin'
import { runSummarizeForSession } from './lib/runSummarizeForSession'

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
 *   4. Auto-summarizes when transcript content is sufficient (best-effort)
 *   5. Sets session feedState to 'ended'
 *   6. Deletes the /liveSessions/{sessionId} RTDB node (cleanup)
 *   7. Writes an audit log entry
 */
export const onSessionEnd = functions
  .runWith({ timeoutSeconds: 300 })
  .database.ref('/liveSessions/{sessionId}/feedState')
  .onWrite(async (change, context) => {
    const { sessionId } = context.params
    const newState = change.after.val()

    if (newState !== 'ended') return null

    functions.logger.info('onSessionEnd: session ended, migrating to Firestore', { sessionId })

    try {
      const chunksSnap = await db.ref(`/liveSessions/${sessionId}/chunks`).get()
      const rawChunks = chunksSnap.val() as Record<string, any> | null

      if (!rawChunks) {
        functions.logger.warn('onSessionEnd: no chunks found in RTDB', { sessionId })
      }

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

      let migratedChunkCount = 0

      if (rawChunks) {
        const chunks = Object.values(rawChunks) as any[]
        chunks.sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
        migratedChunkCount = chunks.length

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

        if (migratedChunkCount > 0) {
          const summarizeResult = await runSummarizeForSession(showId, sessionId, {
            triggeredBy: 'system:auto-migration',
            skipIfInsufficientContent: true,
            source: 'auto-migration',
          })

          if (!summarizeResult.ok) {
            if (summarizeResult.reason === 'insufficient_content') {
              functions.logger.info('onSessionEnd: auto-summarize skipped — insufficient content', {
                sessionId,
                showId,
              })
            } else {
              functions.logger.warn('onSessionEnd: auto-summarize failed', {
                sessionId,
                showId,
                reason: summarizeResult.reason,
              })
            }
          }
        }
      }

      await sessionRef.update({
        feedState: 'ended',
      })

      await db.ref(`/liveSessions/${sessionId}`).remove()
      functions.logger.info('onSessionEnd: RTDB node cleaned up', { sessionId })

      await firestore.collection('auditLog').add({
        action: 'SESSION_FEED_STOPPED',
        performedBy: 'system',
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
        showId,
        sessionId,
        metadata: { chunkCount: migratedChunkCount },
      })

      return null
    } catch (err) {
      functions.logger.error('onSessionEnd: migration failed', err)
      throw err
    }
  })
