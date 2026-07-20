'use client'

import NetworkStatusMonitor from '../components/NetworkStatusMonitor'

export default function TechNetworkPage() {
  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>Network</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Station connectivity before and during a live session.
        </p>
      </div>
      <NetworkStatusMonitor />
      <div className="card" style={{ marginTop: 'var(--space-6)', padding: 'var(--space-5)' }}>
        <h2 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>How to read this</h2>
        <ul className="text-sm" style={{ color: 'var(--color-text-secondary)', paddingLeft: '1.25rem' }}>
          <li style={{ marginBottom: 'var(--space-2)' }}>
            <strong>Browser</strong> — local online/offline from the Network Information API events.
          </li>
          <li style={{ marginBottom: 'var(--space-2)' }}>
            <strong>Realtime DB</strong> — Firebase <code>.info/connected</code> (WebSocket to RTDB).
          </li>
          <li style={{ marginBottom: 'var(--space-2)' }}>
            <strong>Firebase latency</strong> — round-trip probe via <code>.info/serverTimeOffset</code>.
          </li>
          <li>
            <strong>Transcript bridge</strong> — age of the last RTDB chunk (shown on the operator
            session view when a session is open).
          </li>
        </ul>
      </div>
    </div>
  )
}
