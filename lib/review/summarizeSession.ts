import { httpsCallable } from 'firebase/functions'
import { getClientFunctions } from '@/lib/firebase/client'

const MAX_CUSTOM_INSTRUCTIONS_CHARS = 500

export class SummarizeSessionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function callSummarizeSession(opts: {
  showId: string
  sessionId: string
  customInstructions?: string
}): Promise<void> {
  const trimmed = opts.customInstructions?.trim() ?? ''
  if (trimmed.length > MAX_CUSTOM_INSTRUCTIONS_CHARS) {
    throw new SummarizeSessionError(
      'invalid-argument',
      `Instructions must be at most ${MAX_CUSTOM_INSTRUCTIONS_CHARS} characters.`,
    )
  }

  const fn = httpsCallable(getClientFunctions(), 'summarizeSession')
  try {
    await fn({
      showId: opts.showId,
      sessionId: opts.sessionId,
      ...(trimmed ? { customInstructions: trimmed } : {}),
    })
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown'

    if (code.includes('failed-precondition')) {
      throw new SummarizeSessionError(
        'failed-precondition',
        'Not enough transcript content to generate a summary yet.',
      )
    }
    if (code.includes('not-found')) {
      throw new SummarizeSessionError(
        'not-found',
        'No transcript data was found for this session.',
      )
    }
    if (code.includes('permission-denied')) {
      throw new SummarizeSessionError(
        'permission-denied',
        'You do not have permission to generate a summary for this session.',
      )
    }
    if (code.includes('invalid-argument')) {
      throw new SummarizeSessionError(
        'invalid-argument',
        err instanceof Error ? err.message : 'Invalid request.',
      )
    }

    throw new SummarizeSessionError('internal', 'The summary could not be generated right now.')
  }
}
