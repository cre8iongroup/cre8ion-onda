'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { useAuthContext } from '@/context/AuthContext'
import type { SessionDoc, ShowDoc, WithId } from '@/types'
import CreateSessionModal from './CreateSessionModal'
import LegalNoticePanel from './LegalNoticePanel'
import OperatorSettingsPanel from './OperatorSettingsPanel'
import RoomsPanel, { collectSessionRoomIds } from './RoomsPanel'
import SessionsPanel from './SessionsPanel'
import TechCredentialPanel from './TechCredentialPanel'
import BrandingPanel from './BrandingPanel'
import ShowLinksPanel from './ShowLinksPanel'
import PublishPanel from './PublishPanel'
import TimezonePanel from './TimezonePanel'
import LanguagesPanel from './LanguagesPanel'
import GlossaryPanel from './GlossaryPanel'
import QrCodesTab from './QrCodesTab'
import SessionReviewList from '@/components/review/SessionReviewList'
import { showPublicUrl } from '@/lib/attendee/urls'
import { canHideSession } from '@/lib/sessionStatus'

type ShowTab = 'overview' | 'glossary' | 'branding' | 'rooms' | 'sessions' | 'review' | 'qr' | 'tech'

function formatDateRange(start?: Timestamp, end?: Timestamp): string {
  if (!start || !end) return 'Dates TBD'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  return `${start.toDate().toLocaleDateString(undefined, opts)} – ${end.toDate().toLocaleDateString(undefined, opts)}`
}

export default function ShowDetail({ showId }: { showId: string }) {
  const { user, userDoc, capabilities } = useAuthContext()
  const [show, setShow] = useState<WithId<ShowDoc> | null>(null)
  const [sessions, setSessions] = useState<WithId<SessionDoc>[]>([])
  const [loadingShow, setLoadingShow] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [draftBusyId, setDraftBusyId] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [resetBusyId, setResetBusyId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ShowTab | null>(null)

  const canEditShows = Boolean(capabilities?.canEditShows || capabilities?.canCreateShows)
  const canManageBranding = Boolean(capabilities?.canManageBranding)
  const canDownloadQr = Boolean(capabilities?.canDownloadQr)
  const canManageTech = Boolean(capabilities?.canManageTech)
  const canGenerateQr = canEditShows

  const tabs = useMemo(() => {
    const list: Array<{ id: ShowTab; label: string }> = []
    if (canEditShows) list.push({ id: 'overview', label: 'Overview' })
    if (canEditShows) list.push({ id: 'glossary', label: 'Glossary' })
    if (canManageBranding) list.push({ id: 'branding', label: 'Branding' })
    if (canEditShows) list.push({ id: 'rooms', label: 'Rooms' })
    if (canEditShows) list.push({ id: 'sessions', label: 'Sessions' })
    // Future gating point: add `&& show.notesEnabled` (or similar entitlement) here
    // when a show-level notes toggle ships — no tab restructure needed.
    if (canEditShows) list.push({ id: 'review', label: 'Review' })
    if (canDownloadQr) list.push({ id: 'qr', label: 'QR codes' })
    if (canManageTech) list.push({ id: 'tech', label: 'Tech' })
    return list
  }, [canEditShows, canManageBranding, canDownloadQr, canManageTech])

  useEffect(() => {
    if (tabs.length === 0) {
      setActiveTab(null)
      return
    }
    setActiveTab((prev) => {
      if (prev && tabs.some((t) => t.id === prev)) return prev
      return tabs[0].id
    })
  }, [tabs])

  const rooms = show?.rooms ?? []
  const sessionRoomIds = collectSessionRoomIds(sessions)

  async function toggleDraft(session: WithId<SessionDoc>) {
    setDraftError(null)
    const nextDraft = !session.isDraft
    if (nextDraft && !canHideSession(session.feedState)) {
      setDraftError(
        `“${session.friendlyName || session.title}”: End the session before hiding it.`,
      )
      return
    }
    setDraftBusyId(session.id)
    try {
      const fs = getClientFirestore()
      await updateDoc(doc(fs, 'shows', showId, 'sessions', session.id), {
        isDraft: nextDraft,
      })
      setFlash(
        nextDraft
          ? 'Session hidden from Onda Operator and attendees.'
          : 'Session visible to Onda Operator and attendees.',
      )
    } catch (err: any) {
      console.error('ShowDetail: isDraft toggle failed', err)
      setDraftError(err?.message || 'Failed to update draft visibility.')
    } finally {
      setDraftBusyId(null)
    }
  }

  async function resetSession(session: WithId<SessionDoc>) {
    setDraftError(null)
    const label = session.friendlyName || session.title || session.id
    const confirmed = window.confirm(
      `Reset “${label}”? This will return it to Standby and attempt to stop any active recording. In-progress live state will be discarded.`,
    )
    if (!confirmed) return

    if (!user) {
      setDraftError('You must be signed in to reset a session.')
      return
    }

    setResetBusyId(session.id)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/admin/sessions/reset', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ showId, sessionId: session.id }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        previousFeedState?: string
        recallStop?: { outcome?: string; reason?: string }
      }
      if (!res.ok) {
        throw new Error(json.error || `Reset failed (${res.status})`)
      }
      const recallNote =
        json.recallStop?.reason === 'desktop_sdk_stop_only'
          ? ' Recall stop skipped (Desktop SDK only).'
          : json.recallStop?.outcome === 'failed'
            ? ` Recall probe failed (${json.recallStop.reason}).`
            : json.recallStop?.reason === 'no_recording_bound'
              ? ' No recording was bound.'
              : ''
      setFlash(
        `“${label}” reset to Standby (was ${json.previousFeedState || session.feedState}).${recallNote}`,
      )
    } catch (err: any) {
      console.error('ShowDetail: session reset failed', err)
      setDraftError(err?.message || 'Failed to reset session.')
    } finally {
      setResetBusyId(null)
    }
  }

  useEffect(() => {
    const fs = getClientFirestore()
    const unsub = onSnapshot(
      doc(fs, 'shows', showId),
      (snap) => {
        if (!snap.exists()) {
          setShow(null)
          setError('Show not found.')
        } else {
          setShow({ id: snap.id, ...(snap.data() as ShowDoc) })
          setError(null)
        }
        setLoadingShow(false)
      },
      (err) => {
        console.error('ShowDetail: failed to load show', err)
        setError(err.message || 'Failed to load show.')
        setLoadingShow(false)
      },
    )
    return () => unsub()
  }, [showId])

  useEffect(() => {
    const fs = getClientFirestore()
    const q = query(
      collection(fs, 'shows', showId, 'sessions'),
      orderBy('scheduledStart', 'asc'),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) })))
        setLoadingSessions(false)
      },
      (err) => {
        console.error('ShowDetail: failed to load sessions', err)
        setError(err.message || 'Failed to load sessions.')
        setLoadingSessions(false)
      },
    )
    return () => unsub()
  }, [showId])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 4000)
    return () => window.clearTimeout(t)
  }, [flash])

  const openCreate = useCallback(() => {
    if (!canEditShows) {
      setError('You do not have permission to create sessions.')
      return
    }
    setError(null)
    setModalOpen(true)
  }, [canEditShows])

  if (loadingShow) {
    return (
      <div className="panel-content">
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading show" />
        </div>
      </div>
    )
  }

  if (!show) {
    return (
      <div className="panel-content">
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {error || 'Show not found.'}
        </div>
        <Link href="/admin" className="btn btn-ghost">
          ← Back to Shows
        </Link>
      </div>
    )
  }

  if (tabs.length === 0) {
    return (
      <div className="panel-content">
        <div className="alert alert-error" role="alert">
          You do not have any capabilities on this show.
        </div>
        <Link href="/admin" className="btn btn-ghost">
          ← Back to Shows
        </Link>
      </div>
    )
  }

  return (
    <div className="panel-content">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Link
          href="/admin"
          id="link-back-to-shows"
          className="text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          ← Shows
        </Link>
      </div>

      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 'var(--space-6)', gap: 'var(--space-4)', flexWrap: 'wrap' }}
      >
        <div>
          <div className="flex items-center gap-4" style={{ marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>{show.name}</h1>
            <span className={`badge ${show.portalPublished ? 'badge-success' : 'badge-muted'}`}>
              {show.portalPublished ? 'Published' : 'Draft'}
            </span>
          </div>
          <p style={{ color: 'var(--color-text-secondary)' }}>{show.clientName}</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
            {formatDateRange(show.startDate, show.endDate)}
            {' · '}
            {show.branding?.portalURL ? (
              <a
                className="admin-public-link"
                href={showPublicUrl(show.branding.portalURL)}
                target="_blank"
                rel="noopener noreferrer"
              >
                /show/{show.branding.portalURL}
              </a>
            ) : (
              '/show/—'
            )}
          </p>
        </div>
        {canEditShows && activeTab === 'sessions' ? (
          <button
            id="btn-create-session"
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
          >
            + Create Session
          </button>
        ) : null}
      </div>

      <nav
        aria-label="Show sections"
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          marginBottom: 'var(--space-8)',
          borderBottom: '1px solid var(--color-border)',
          paddingBottom: 0,
        }}
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className="btn btn-ghost btn-sm"
              onClick={() => setActiveTab(tab.id)}
              style={{
                borderRadius: '8px 8px 0 0',
                borderBottom: selected
                  ? '2px solid var(--color-primary)'
                  : '2px solid transparent',
                color: selected ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                fontWeight: selected ? 600 : 400,
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

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
      {draftError && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-6)' }}>
          {draftError}
        </div>
      )}

      {activeTab === 'overview' ? (
        <>
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Publish</h2>
            <PublishPanel
              showId={show.id}
              portalPublished={show.portalPublished}
              canEdit={canEditShows}
              onFlash={setFlash}
            />
          </section>
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Timezone</h2>
            <TimezonePanel
              showId={show.id}
              showTimezone={show.showTimezone}
              canEdit={canEditShows}
              onFlash={setFlash}
            />
          </section>
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>
              Caption languages
            </h2>
            <LanguagesPanel
              showId={show.id}
              defaultLanguages={show.defaultLanguages}
              canEdit={canEditShows}
              onFlash={setFlash}
            />
          </section>
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Show links</h2>
            <ShowLinksPanel
              showId={show.id}
              links={show.links}
              canEdit={canEditShows}
              onFlash={setFlash}
            />
          </section>
          <section>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>
              Legal notice
            </h2>
            <LegalNoticePanel
              showId={show.id}
              legalNotice={show.branding?.legalNotice}
              canEdit={canEditShows}
              onFlash={setFlash}
            />
          </section>
        </>
      ) : null}

      {activeTab === 'glossary' ? (
        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Glossary</h2>
          <GlossaryPanel
            showId={show.id}
            glossary={show.glossary}
            canEdit={canEditShows}
            onFlash={setFlash}
          />
        </section>
      ) : null}

      {activeTab === 'branding' ? (
        <BrandingPanel
          showId={show.id}
          branding={show.branding}
          canEdit={canManageBranding}
          onFlash={setFlash}
        />
      ) : null}

      {activeTab === 'rooms' ? (
        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Rooms</h2>
          <RoomsPanel
            showId={show.id}
            rooms={rooms}
            sessionRoomIds={sessionRoomIds}
            canEdit={canEditShows}
            onFlash={setFlash}
          />
        </section>
      ) : null}

      {activeTab === 'sessions' ? (
        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Sessions</h2>
          <SessionsPanel
            showId={show.id}
            rooms={rooms}
            sessions={sessions}
            loading={loadingSessions}
            canEdit={canEditShows}
            draftBusyId={draftBusyId}
            resetBusyId={resetBusyId}
            onToggleDraft={toggleDraft}
            onResetSession={resetSession}
          />
        </section>
      ) : null}

      {activeTab === 'review' ? (
        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Review</h2>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
            Post-event content review and publishing. Opens the reviewer detail view for each session.
          </p>
          <SessionReviewList
            showId={show.id}
            showTimezone={show.showTimezone || 'America/New_York'}
            sessions={sessions}
            reviewerEmail={userDoc?.email ?? user?.email ?? 'admin'}
            loading={loadingSessions}
            emptyMessage="No sessions on this show yet."
          />
        </section>
      ) : null}

      {activeTab === 'qr' ? (
        <QrCodesTab
          showId={show.id}
          rooms={rooms}
          sessions={sessions}
          canGenerate={canGenerateQr}
          canDownload={canDownloadQr}
        />
      ) : null}

      {activeTab === 'tech' ? (
        <>
          <section style={{ marginBottom: 'var(--space-10)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Tech access</h2>
            <TechCredentialPanel
              showId={show.id}
              portalSlug={show.branding?.portalURL || ''}
              hasCredential={Boolean(show.techCredential)}
              createdBy={user?.uid || ''}
              canEdit={canManageTech}
            />
          </section>
          <section>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>
              Operator settings
            </h2>
            <OperatorSettingsPanel
              showId={show.id}
              transcriptionStyle={show.transcriptionStyle}
              operatorInstructions={show.operatorInstructions}
              canEdit={canManageTech}
              onFlash={setFlash}
            />
          </section>
        </>
      ) : null}

      <CreateSessionModal
        open={modalOpen}
        showId={showId}
        createdBy={user?.uid || ''}
        canCreate={canEditShows}
        defaultLanguages={show.defaultLanguages || ['en']}
        rooms={rooms}
        onClose={() => setModalOpen(false)}
        onCreated={() => setFlash('Session created.')}
      />
    </div>
  )
}
