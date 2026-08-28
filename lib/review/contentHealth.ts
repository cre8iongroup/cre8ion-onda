import type { SessionDoc, TranscriptChunk, WithId } from '@/types'

export type ContentHealthFinding = {
  code: string
  severity: 'info' | 'warn' | 'error'
  message: string
}

export type ContentHealthResult = {
  findings: ContentHealthFinding[]
}

type RunOpts = {
  session: SessionDoc
  chunks: WithId<TranscriptChunk>[]
  audioObjectExists: boolean | null
}

function sortedChunks(chunks: WithId<TranscriptChunk>[]) {
  return [...chunks].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
}

/** Read-only content checks — does not modify Firestore or Storage. */
export function runContentHealthChecks(opts: RunOpts): ContentHealthResult {
  const { session, chunks, audioObjectExists } = opts
  const findings: ContentHealthFinding[] = []
  const sorted = sortedChunks(chunks)

  if (sorted.length === 0) {
    findings.push({
      code: 'no_transcripts',
      severity: session.feedState === 'ended' ? 'error' : 'warn',
      message:
        session.feedState === 'ended'
          ? 'Session ended but no transcript chunks exist in Firestore.'
          : 'No transcript chunks in Firestore yet.',
    })
  } else {
    findings.push({
      code: 'transcript_count',
      severity: 'info',
      message: `${sorted.length} transcript chunk(s) in Firestore.`,
    })

    const seqs = sorted.map((c) => c.sequenceNumber ?? 0)
    const gaps: number[] = []
    for (let i = 1; i < seqs.length; i++) {
      const prev = seqs[i - 1]
      const cur = seqs[i]
      if (cur > prev + 1) {
        for (let missing = prev + 1; missing < cur; missing++) gaps.push(missing)
      }
    }
    if (gaps.length > 0) {
      findings.push({
        code: 'sequence_gaps',
        severity: 'warn',
        message: `Sequence number gap(s) detected: ${gaps.slice(0, 8).join(', ')}${
          gaps.length > 8 ? '…' : ''
        }`,
      })
    }
  }

  if (session.recordingId && !session.audioStoragePath) {
    findings.push({
      code: 'audio_path_missing',
      severity: 'warn',
      message: 'Recording ID is set but audioStoragePath is missing (audio ingest may have failed).',
    })
  }

  if (session.audioStoragePath) {
    if (audioObjectExists === false) {
      findings.push({
        code: 'audio_storage_missing',
        severity: 'error',
        message: `Storage object not found at ${session.audioStoragePath}`,
      })
    } else if (audioObjectExists === true) {
      findings.push({
        code: 'audio_present',
        severity: 'info',
        message: 'Session audio file exists in Storage.',
      })
    }
  } else if (!session.recordingId) {
    findings.push({
      code: 'no_recording',
      severity: 'info',
      message: 'No recording ID on this session.',
    })
  }

  if (session.feedState === 'ended' && !session.aiSummary?.trim()) {
    findings.push({
      code: 'summary_missing',
      severity: 'warn',
      message: 'Session ended but no AI summary is stored on the session document.',
    })
  }

  return { findings }
}
