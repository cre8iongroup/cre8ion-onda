'use client'

import { parseAiSummary } from '@/lib/review/parseAiSummary'
import AiSummaryGenerateControls from '@/components/review/AiSummaryGenerateControls'
import type { ReviewState, SessionDoc, TranscriptChunk, WithId } from '@/types'

type Props = {
  showId: string
  sessionId: string
  session: SessionDoc
  reviewState: ReviewState
  aiSummary: string | undefined
  chunks: WithId<TranscriptChunk>[]
  canGenerate: boolean
}

function AiSummaryDisplay({ aiSummary }: { aiSummary: string }) {
  const parsed = parseAiSummary(aiSummary)
  if (!parsed.ok) return null

  const { summary } = parsed

  return (
    <>
      <section style={{ marginBottom: 'var(--space-5)' }}>
        <h4 className="text-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>
          Executive summary
        </h4>
        <p style={{ lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{summary.executiveSummary}</p>
      </section>

      {summary.keyTopics.length > 0 ? (
        <section style={{ marginBottom: 'var(--space-5)' }}>
          <h4 className="text-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            Key topics
          </h4>
          <ul style={{ paddingLeft: '1.25rem', lineHeight: 1.6 }}>
            {summary.keyTopics.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.actionItems.length > 0 ? (
        <section style={{ marginBottom: 'var(--space-5)' }}>
          <h4 className="text-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            Action items
          </h4>
          <ul style={{ paddingLeft: '1.25rem', lineHeight: 1.6 }}>
            {summary.actionItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.quotes.length > 0 ? (
        <section>
          <h4 className="text-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            Notable quotes
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {summary.quotes.map((quote, i) => (
              <blockquote
                key={`${i}-${quote.text.slice(0, 24)}`}
                style={{
                  margin: 0,
                  padding: 'var(--space-3) var(--space-4)',
                  borderLeft: '3px solid var(--color-accent)',
                  background: 'var(--color-surface-raised, rgba(0,0,0,0.04))',
                  fontStyle: 'italic',
                }}
              >
                {quote.speaker ? (
                  <footer
                    className="text-sm"
                    style={{ fontStyle: 'normal', marginBottom: 'var(--space-1)', opacity: 0.75 }}
                  >
                    {quote.speaker}
                  </footer>
                ) : null}
                “{quote.text}”
              </blockquote>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}

export default function AiSummaryPanel({
  showId,
  sessionId,
  session,
  reviewState,
  aiSummary,
  chunks,
  canGenerate,
}: Props) {
  const parsed = parseAiSummary(aiSummary)

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <AiSummaryGenerateControls
        showId={showId}
        sessionId={sessionId}
        reviewState={reviewState}
        aiSummary={aiSummary}
        chunks={chunks}
        canGenerate={canGenerate}
      />
      {parsed.ok ? (
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <AiSummaryDisplay aiSummary={aiSummary!} />
        </div>
      ) : null}
    </div>
  )
}
