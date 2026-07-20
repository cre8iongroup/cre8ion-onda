'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import type { OutputLayoutDoc, WithId } from '@/types'
import CreateLayoutModal from './CreateLayoutModal'

const LANG_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
}

function langLabel(code: string): string {
  return LANG_LABELS[code] || code
}

function bgPreview(layout: OutputLayoutDoc): string {
  switch (layout.backgroundType) {
    case 'black':
      return '#000000'
    case 'white':
      return '#FFFFFF'
    case 'chromaKey':
      return '#00FF00'
    case 'custom':
      return layout.backgroundColor || '#333333'
    default:
      return '#000000'
  }
}

export default function LayoutsDashboard() {
  const { user, capabilities } = useAuthContext()
  const [layouts, setLayouts] = useState<WithId<OutputLayoutDoc>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const canManage = Boolean(capabilities?.canManageOutputLayouts)

  useEffect(() => {
    const fs = getClientFirestore()
    const q = query(collection(fs, 'outputLayouts'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLayouts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as OutputLayoutDoc) })))
        setError(null)
        setLoading(false)
      },
      (err) => {
        console.error('LayoutsDashboard: failed to load layouts', err)
        setError(err.message || 'Failed to load output layouts.')
        setLoading(false)
      }
    )
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 4000)
    return () => window.clearTimeout(t)
  }, [flash])

  const openCreate = useCallback(() => {
    if (!canManage) {
      setError('You do not have permission to manage output layouts.')
      return
    }
    setModalOpen(true)
  }, [canManage])

  return (
    <div className="panel-content">
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 'var(--space-8)', gap: 'var(--space-4)', flexWrap: 'wrap' }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>
            Output Layouts
          </h1>
          <p>Templates for attendee captions and output feeds.</p>
        </div>
        {canManage && (
          <button
            id="btn-create-layout"
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
          >
            + Create Layout
          </button>
        )}
      </div>

      {flash && (
        <div className="alert alert-success" role="status" style={{ marginBottom: 'var(--space-6)' }}>
          {flash}
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading layouts" />
        </div>
      ) : layouts.length === 0 ? (
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
          <div style={{ fontSize: '3rem' }}>🖥️</div>
          <h2 style={{ fontSize: 'var(--text-lg)' }}>No layouts yet</h2>
          <p style={{ maxWidth: 380 }}>
            Create an output layout template to control caption arrangement, languages, and
            background for live feeds.
          </p>
          <button
            id="btn-create-layout-empty"
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-2)' }}
            onClick={openCreate}
            disabled={!canManage}
          >
            + Create Layout
          </button>
          {!canManage && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Your account cannot manage output layouts.
            </p>
          )}
        </div>
      ) : (
        <div className="show-list">
          {layouts.map((layout) => (
            <article key={layout.id} id={`layout-${layout.id}`} className="card show-list-item">
              <div className="flex items-center justify-between gap-4" style={{ flexWrap: 'wrap' }}>
                <div className="flex gap-4" style={{ alignItems: 'center' }}>
                  <div
                    aria-hidden
                    style={{
                      width: 48,
                      height: 36,
                      borderRadius: 6,
                      border: '1px solid var(--color-border)',
                      background: bgPreview(layout),
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
                      {layout.name}
                    </h2>
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {langLabel(layout.primaryLanguage)}
                      {layout.secondaryLanguage
                        ? ` + ${langLabel(layout.secondaryLanguage)}`
                        : ''}
                      {' · '}
                      {layout.layout === 'sideBySide' ? 'Side by side' : 'Stacked'}
                      {' · '}
                      {layout.fontSize}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                      {layout.backgroundType}
                      {layout.showSpeakerLabels ? ' · speaker labels' : ''}
                    </p>
                  </div>
                </div>
                <span className="badge badge-muted">{layout.textColor}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <CreateLayoutModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        createdBy={user?.uid || ''}
        canCreate={canManage}
        onCreated={() => setFlash('Layout created.')}
      />
    </div>
  )
}
