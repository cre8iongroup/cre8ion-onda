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
import { isOutputPresetDoc } from '@/lib/output/defaults'
import type { OutputLayoutDoc, WithId } from '@/types'
import CreateLayoutModal from './CreateLayoutModal'

const LANG_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
}

function langLabel(code: string | null): string {
  if (!code) return 'Unset'
  return LANG_LABELS[code] || code
}

function windowSummary(layout: OutputLayoutDoc): string {
  return layout.windows
    .map((w, i) => `W${i + 1}: ${langLabel(w.language)} · ${w.fontSize}px`)
    .join(' · ')
}

export default function LayoutsDashboard() {
  const { user, capabilities } = useAuthContext()
  const [layouts, setLayouts] = useState<WithId<OutputLayoutDoc>[]>([])
  const [legacyCount, setLegacyCount] = useState(0)
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
        const next: WithId<OutputLayoutDoc>[] = []
        let legacy = 0
        for (const d of snap.docs) {
          const data = d.data()
          if (isOutputPresetDoc(data)) {
            next.push({ id: d.id, ...(data as OutputLayoutDoc) })
          } else {
            legacy += 1
          }
        }
        setLayouts(next)
        setLegacyCount(legacy)
        setError(null)
        setLoading(false)
      },
      (err) => {
        console.error('LayoutsDashboard: failed to load presets', err)
        setError(err.message || 'Failed to load output presets.')
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
      setError('You do not have permission to manage output presets.')
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
            Output Presets
          </h1>
          <p>Starting-point window configs for the Output Builder. Applied once per room — never a live reference.</p>
        </div>
        {canManage && (
          <button
            id="btn-create-layout"
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
          >
            + Create Preset
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

      {legacyCount > 0 && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 'var(--space-6)' }}>
          {legacyCount} legacy preset{legacyCount === 1 ? '' : 's'} hidden (pre-windows[] schema). Left in Firestore; not migrated.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading presets" />
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
          <h2 style={{ fontSize: 'var(--text-lg)' }}>No presets yet</h2>
          <p style={{ maxWidth: 380 }}>
            Create an output preset to pre-fill a room&apos;s window languages, font size, and colors
            in the Output Builder.
          </p>
          <button
            id="btn-create-layout-empty"
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-2)' }}
            onClick={openCreate}
            disabled={!canManage}
          >
            + Create Preset
          </button>
          {!canManage && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Your account cannot manage output presets.
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
                      background: layout.windows[0]?.backgroundColor || '#000',
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
                      {layout.name}
                    </h2>
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {windowSummary(layout)}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                      {layout.windows.length} window{layout.windows.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
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
        onCreated={() => setFlash('Preset created.')}
      />
    </div>
  )
}
