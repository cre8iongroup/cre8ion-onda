import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import Anthropic from '@anthropic-ai/sdk'

if (!admin.apps.length) admin.initializeApp()
const firestore = admin.firestore()

interface SummarizeRequest {
  showId: string
  sessionId: string
}

interface ClaudeSummaryOutput {
  executiveSummary: string
  keyTopics: string[]
  actionItems: string[]
  quotes: Array<{ speaker?: string; text: string }>
}

const SYSTEM_PROMPT = `You are a professional conference session summarizer. 
Given a raw live-event transcript, produce a structured JSON summary with these exact fields:
{
  "executiveSummary": "2-4 paragraph prose summary of the session",
  "keyTopics": ["topic 1", "topic 2", ...],
  "actionItems": ["action 1", "action 2", ...],
  "quotes": [
    { "speaker": "optional speaker name", "text": "notable quote" },
    ...
  ]
}

Rules:
- executiveSummary: narrative prose, 2-4 paragraphs, no bullet points
- keyTopics: 3-8 key themes or subjects covered
- actionItems: concrete follow-ups or calls to action mentioned (may be empty array)
- quotes: 2-5 notable quotes, verbatim or near-verbatim from the transcript
- Speaker labels may be present as "Speaker 1:", "Speaker 2:", etc. — use them if helpful
- Output ONLY valid JSON — no markdown fences, no preamble
`

/**
 * Callable Cloud Function — triggered by admin panel "Generate Summary" button.
 *
 * Reads all Firestore transcript chunks for a session (sorted by sequenceNumber),
 * sends to Claude, and writes the structured summary back to the session document.
 * Sends to Claude, and writes the structured summary back to the session document.
 * Reviewer/posting pipeline status is a future field — do not write lifecycleStatus.
 */
export const summarizeSession = functions.https.onCall(async (data: SummarizeRequest, context) => {
  // ── 1. Auth check — must be authenticated with admin or editor role
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required')
  }

  const { showId, sessionId } = data
  if (!showId || !sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'showId and sessionId required')
  }

  // ── 2. Verify caller has permission (check user doc baseRole)
  const userDoc = await firestore.collection('users').doc(context.auth.uid).get()
  if (!userDoc.exists) {
    throw new functions.https.HttpsError('permission-denied', 'User not found')
  }
  const { baseRole } = userDoc.data() as { baseRole: string }
  if (!['admin', 'editor'].includes(baseRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions')
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new functions.https.HttpsError('internal', 'Claude API key not configured')
  }

  // ── 3. Load transcript chunks from Firestore
  const transcriptsSnap = await firestore
    .collection(`shows/${showId}/sessions/${sessionId}/transcripts`)
    .orderBy('sequenceNumber', 'asc')
    .get()

  if (transcriptsSnap.empty) {
    throw new functions.https.HttpsError('not-found', 'No transcript data found for this session')
  }

  const lines: string[] = []
  for (const doc of transcriptsSnap.docs) {
    const chunk = doc.data()
    const speakerPrefix = chunk.speakerLabel ? `${chunk.speakerLabel}: ` : ''
    lines.push(`${speakerPrefix}${chunk.text}`)
  }
  const fullTranscript = lines.join('\n')

  functions.logger.info('summarizeSession: calling Claude', { sessionId, chunkCount: lines.length })

  // ── 4. Call Claude API
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Please summarize this conference session transcript:\n\n${fullTranscript}`,
      },
    ],
  })

  const rawContent = response.content[0]
  if (rawContent.type !== 'text') {
    throw new functions.https.HttpsError('internal', 'Unexpected Claude response format')
  }

  // ── 5. Parse Claude JSON output
  let summary: ClaudeSummaryOutput
  try {
    summary = JSON.parse(rawContent.text)
  } catch {
    functions.logger.error('summarizeSession: failed to parse Claude JSON', { raw: rawContent.text })
    throw new functions.https.HttpsError('internal', 'Failed to parse summary from Claude')
  }

  // ── 6. Write to Firestore session document
  const sessionRef = firestore.doc(`shows/${showId}/sessions/${sessionId}`)
  await sessionRef.update({
    aiSummary: JSON.stringify(summary),
    aiSummaryGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
    aiSummaryTriggeredBy: context.auth.uid,
    // TODO(reviewer-pipeline): future Reviewer/posting status field — not feedState
  })

  // ── 7. Audit log
  await firestore.collection('auditLog').add({
    action: 'SUMMARY_TRIGGERED',
    performedBy: context.auth.uid,
    performedAt: admin.firestore.FieldValue.serverTimestamp(),
    showId,
    sessionId,
    metadata: { chunkCount: lines.length },
  })

  functions.logger.info('summarizeSession: complete', { sessionId })
  return { ok: true }
})
