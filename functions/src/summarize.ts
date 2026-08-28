import * as functions from 'firebase-functions/v1'
import * as admin from 'firebase-admin'
import { runSummarizeForSession } from './lib/runSummarizeForSession'

if (!admin.apps.length) admin.initializeApp()
const firestore = admin.firestore()

const MAX_CUSTOM_INSTRUCTIONS_CHARS = 500

interface SummarizeRequest {
  showId: string
  sessionId: string
  customInstructions?: string
}

function mapSummarizeFailure(
  reason: 'no_transcripts' | 'insufficient_content' | 'claude_error' | 'parse_error' | 'missing_api_key',
): never {
  switch (reason) {
    case 'no_transcripts':
      throw new functions.https.HttpsError('not-found', 'No transcript data found for this session')
    case 'insufficient_content':
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Not enough transcript content to generate a summary yet.',
      )
    case 'missing_api_key':
    case 'claude_error':
    case 'parse_error':
    default:
      throw new functions.https.HttpsError('internal', 'Failed to generate summary.')
  }
}

/**
 * Callable Cloud Function — manual summary generation from the Reviewer panel.
 * Auth wrapper around runSummarizeForSession.
 */
export const summarizeSession = functions
  .runWith({ timeoutSeconds: 300 })
  .https.onCall(async (data: SummarizeRequest, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required')
    }

    const { showId, sessionId, customInstructions } = data
    if (!showId || !sessionId) {
      throw new functions.https.HttpsError('invalid-argument', 'showId and sessionId required')
    }

    const trimmedInstructions =
      typeof customInstructions === 'string' ? customInstructions.trim() : ''
    if (trimmedInstructions.length > MAX_CUSTOM_INSTRUCTIONS_CHARS) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `customInstructions must be at most ${MAX_CUSTOM_INSTRUCTIONS_CHARS} characters`,
      )
    }

    const userDoc = await firestore.collection('users').doc(context.auth.uid).get()
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('permission-denied', 'User not found')
    }

    const { baseRole, assignedShows } = userDoc.data() as {
      baseRole: string
      assignedShows?: string[]
    }

    if (!['admin', 'editor', 'reviewer'].includes(baseRole)) {
      throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions')
    }

    if (baseRole === 'reviewer') {
      const ids = Array.isArray(assignedShows) ? assignedShows : []
      if (ids.length === 0 || !ids.includes(showId)) {
        throw new functions.https.HttpsError('permission-denied', 'Not assigned to this show')
      }
    }

    const result = await runSummarizeForSession(showId, sessionId, {
      triggeredBy: context.auth.uid,
      customInstructions: trimmedInstructions || undefined,
      source: 'callable',
    })

    if (!result.ok) {
      mapSummarizeFailure(result.reason)
    }

    return { ok: true }
  })
