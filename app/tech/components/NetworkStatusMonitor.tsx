'use client'

import { useEffect, useState } from 'react'
import { getClientDatabase } from '@/lib/firebase/client'
import { onValue, ref } from 'firebase/database'

export interface NetworkStatusSnapshot {
  online: boolean
  rtdbConnected: boolean | null
  lastChunkAgeMs: number | null
  latencyMs: number | null
}

interface NetworkStatusMonitorProps {
  sessionId?: string
  lastChunkAt?: number | null
  compact?: boolean
}

export default function NetworkStatusMonitor({
  sessionId,
  lastChunkAt = null,
  compact = false,
}: NetworkStatusMonitorProps) {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [rtdbConnected, setRtdbConnected] = useState<boolean | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    function onOnline() {
      setOnline(true)
    }
    function onOffline() {
      setOnline(false)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const db = getClientDatabase()
    const connectedRef = ref(db, '.info/connected')
    return onValue(connectedRef, (snap) => {
      setRtdbConnected(snap.val() === true)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    async function probe() {
      const start = performance.now()
      try {
        const db = getClientDatabase()
        // Server time offset probe — lightweight RTDB round-trip
        await new Promise<void>((resolve, reject) => {
          const offsetRef = ref(db, '.info/serverTimeOffset')
          const unsub = onValue(
            offsetRef,
            () => {
              unsub()
              resolve()
            },
            (err) => {
              unsub()
              reject(err)
            }
          )
        })
        if (!cancelled) setLatencyMs(Math.round(performance.now() - start))
      } catch {
        if (!cancelled) setLatencyMs(null)
      }
    }
    probe()
    const id = window.setInterval(probe, 8000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const lastChunkAgeMs =
    lastChunkAt != null ? Math.max(0, now - lastChunkAt) : null

  function pill(ok: boolean | null, label: string, detail: string) {
    const cls =
      ok === null ? 'badge-muted' : ok ? 'badge-success' : 'badge-live'
    return (
      <div className={`net-pill ${cls}`}>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
    )
  }

  return (
    <div className={`network-monitor${compact ? ' compact' : ''}`} id="tech-network-monitor">
      {!compact && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
            Network status
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Live connectivity for this operator station
            {sessionId ? ` · session ${sessionId.slice(0, 8)}…` : ''}.
          </p>
        </div>
      )}

      <div className="network-grid">
        {pill(online, 'Browser', online ? 'Online' : 'Offline — check network')}
        {pill(
          rtdbConnected,
          'Realtime DB',
          rtdbConnected === null ? 'Checking…' : rtdbConnected ? 'Connected' : 'Disconnected'
        )}
        {pill(
          latencyMs == null ? null : latencyMs < 1500,
          'Firebase latency',
          latencyMs == null ? 'Measuring…' : `${latencyMs} ms`
        )}
        {pill(
          lastChunkAgeMs == null ? null : lastChunkAgeMs < 15000,
          'Transcript bridge',
          lastChunkAgeMs == null
            ? 'No chunks yet'
            : lastChunkAgeMs < 15000
              ? `Last chunk ${Math.round(lastChunkAgeMs / 1000)}s ago`
              : `Stale — ${Math.round(lastChunkAgeMs / 1000)}s since last chunk`
        )}
      </div>
    </div>
  )
}
