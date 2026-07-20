'use client'

import { Suspense, use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { doc, onSnapshot } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import type { SessionDoc, WithId } from '@/types'
import AudioDevicePicker from '../../components/AudioDevicePicker'
import GoLiveControl from '../../components/GoLiveControl'
import NetworkStatusMonitor from '../../components/NetworkStatusMonitor'
import PrivateTranscriptPreview from '../../components/PrivateTranscriptPreview'

function OperatorInner({ sessionId }: { sessionId: string }) {
  const searchParams = useSearchParams()
  const showIdParam = searchParams.get('showId')
  const { userDoc, capabilities } = useAuthContext()

  const assigned = Array.isArray(userDoc?.assignedShows) ? userDoc!.assignedShows : []
  const showId = showIdParam && assigned.includes(showIdParam) ? showIdParam : assigned[0] || null

  const [session, setSession] = useState<WithId<SessionDoc> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastChunkAt, setLastChunkAt] = useState<number | null>(null)
  const [audioDeviceId, setAudioDeviceId] = useState<string | null>(null)

  const canControl = Boolean(capabilities?.canControlLiveFeed)
  const canPreview = Boolean(capabilities?.canViewPrivatePreview)

  useEffect(() => {
    if (!showId) {
      setError('No assigned show for this tech account.')
      setLoading(false)
      return
    }

    const fs = getClientFirestore()
    return onSnapshot(
      doc(fs, 'shows', showId, 'sessions', sessionId),
      (snap) => {
        if (!snap.exists()) {
          setSession(null)
          setError('Session not found.')
        } else {
          setSession({ id: snap.id, ...(snap.data() as SessionDoc) })
          setError(null)
        }
        setLoading(false)
      },
      (err) => {
        console.error('TechOperator: session load failed', err)
        setError(err.message || 'Failed to load session.')
        setLoading(false)
      }
    )
  }, [showId, sessionId])

  const onLastChunkAt = useCallback((ts: number | null) => {
    setLastChunkAt(ts)
  }, [])

  if (loading) {
    return (
      <div className="panel-content">
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading session" />
        </div>
      </div>
    )
  }

  if (!showId || !session) {
    return (
      <div className="panel-content">
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error || 'Session unavailable.'}
        </div>
        <Link href="/tech" className="btn btn-ghost" id="link-back-tech-sessions">
          ← Back to sessions
        </Link>
      </div>
    )
  }

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/recall/webhook`
      : '/api/recall/webhook'

  return (
    <div className="panel-content tech-operator">
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Link
          href="/tech"
          id="link-back-tech-sessions"
          className="text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          ← Sessions
        </Link>
      </div>

      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 'var(--space-6)', gap: 'var(--space-4)', flexWrap: 'wrap' }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-1)' }}>
            {session.title}
          </h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {session.friendlyName}
            {session.location ? ` · ${session.location}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <span className={`badge ${session.feedState === 'live' ? 'badge-live' : 'badge-standby'}`}>
            feed: {session.feedState}
          </span>
          <span className="badge badge-muted">{session.lifecycleStatus}</span>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error}
        </div>
      )}

      <div className="tech-operator-grid">
        <div className="tech-operator-main">
          {canPreview ? (
            <PrivateTranscriptPreview sessionId={sessionId} onLastChunkAt={onLastChunkAt} />
          ) : (
            <div className="alert alert-warning">Private preview not permitted for this account.</div>
          )}
        </div>

        <div className="tech-operator-side">
          <GoLiveControl
            showId={showId}
            sessionId={sessionId}
            feedState={session.feedState}
            canControl={canControl}
            onError={setError}
          />

          <AudioDevicePicker onDeviceChange={setAudioDeviceId} />

          <div className="card" style={{ padding: 'var(--space-5)' }} id="tech-recall-bridge">
            <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>
              Recall.AI bridge
            </h3>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
              The Recall Desktop SDK runs outside the browser (Electron/native). Configure it to POST
              transcript chunks to the webhook below with header <code>x-recall-secret</code>. No Recall
              API keys are stored in this panel.
            </p>
            <div className="field">
              <label className="label">Webhook URL</label>
              <input id="tech-webhook-url" className="input" readOnly value={webhookUrl} />
            </div>
            <div className="field" style={{ marginTop: 'var(--space-3)' }}>
              <label className="label">sessionId (payload)</label>
              <input id="tech-session-id" className="input" readOnly value={sessionId} />
            </div>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-3)' }}>
              Audio device selected:{' '}
              <code>{audioDeviceId ? `${audioDeviceId.slice(0, 12)}…` : 'none'}</code>
            </p>
          </div>

          <NetworkStatusMonitor sessionId={sessionId} lastChunkAt={lastChunkAt} compact />
        </div>
      </div>
    </div>
  )
}

function OperatorPage({ sessionId }: { sessionId: string }) {
  return (
    <Suspense
      fallback={
        <div className="panel-content">
          <span className="spinner" aria-label="Loading" />
        </div>
      }
    >
      <OperatorInner sessionId={sessionId} />
    </Suspense>
  )
}

export default function TechSessionOperatorPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = use(params)
  return <OperatorPage sessionId={sessionId} />
}
