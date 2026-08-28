'use client'

import { useState } from 'react'
import { getMetadata, ref } from 'firebase/storage'
import { getClientStorage } from '@/lib/firebase/client'
import { runContentHealthChecks } from '@/lib/review/contentHealth'
import type { SessionDoc, TranscriptChunk, WithId } from '@/types'

type Props = {
  session: SessionDoc
  chunks: WithId<TranscriptChunk>[]
}

export default function ContentHealthPanel({ session, chunks }: Props) {
  const [busy, setBusy] = useState(false)
  const [findings, setFindings] = useState<
    ReturnType<typeof runContentHealthChecks>['findings'] | null
  >(null)
  const [error, setError] = useState<string | null>(null)

  async function runCheck() {
    setBusy(true)
    setError(null)
    try {
      let audioObjectExists: boolean | null = null
      if (session.audioStoragePath) {
        try {
          await getMetadata(ref(getClientStorage(), session.audioStoragePath))
          audioObjectExists = true
        } catch {
          audioObjectExists = false
        }
      }

      const result = runContentHealthChecks({
        session,
        chunks,
        audioObjectExists,
      })
      setFindings(result.findings)
    } catch (err: unknown) {
      console.error('ContentHealthPanel: check failed', err)
      setError(err instanceof Error ? err.message : 'Check failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <div
        className="flex items-center justify-between gap-4"
        style={{ flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}
      >
        <div>
          <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-1)' }}>
            Recoverable content
          </h3>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Read-only check — does not modify anything. Share results with Tech or Admin if recovery
            is needed.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => void runCheck()}
        >
          {busy ? 'Checking…' : 'Check for recoverable content'}
        </button>
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      {findings ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {findings.map((f) => (
            <li
              key={f.code}
              className="text-sm"
              style={{
                padding: 'var(--space-2) 0',
                borderBottom: '1px solid var(--color-border)',
                color:
                  f.severity === 'error'
                    ? 'var(--color-error, #c0392b)'
                    : f.severity === 'warn'
                      ? 'var(--color-warning, #b8860b)'
                      : 'var(--color-text-secondary)',
              }}
            >
              <strong style={{ textTransform: 'capitalize' }}>{f.severity}: </strong>
              {f.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
