import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Shows — Admin',
  description: 'Manage events and sessions',
}

export default function AdminDashboard() {
  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>Shows</h1>
        <p>All events managed through Onda.</p>
      </div>

      {/* Shows will be loaded here in Phase 3 */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-16)',
          textAlign: 'center',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ fontSize: '3rem' }}>🎬</div>
        <h2 style={{ fontSize: 'var(--text-lg)' }}>No shows yet</h2>
        <p style={{ maxWidth: 360 }}>
          Create your first show to get started. Shows hold all sessions, branding, and glossary
          for a single client event.
        </p>
        <button id="btn-create-show-empty" className="btn btn-primary" style={{ marginTop: 'var(--space-2)' }}>
          + Create Show
        </button>
      </div>
    </div>
  )
}
