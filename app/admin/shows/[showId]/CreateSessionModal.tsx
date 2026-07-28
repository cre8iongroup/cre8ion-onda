'use client'

import { useEffect, useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { addDoc, collection, Timestamp } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import type { SessionDoc } from '@/types'

const createSessionSchema = z.object({
  title: z.string().trim().min(2, 'Session title is required'),
  friendlyName: z.string().trim().min(2, 'Friendly name is required'),
  location: z.string().trim().min(1, 'Location is required'),
  scheduledStart: z.string().min(1, 'Start time is required'),
  scheduledEnd: z.string().min(1, 'End time is required'),
}).refine(
  (data) => new Date(data.scheduledEnd) > new Date(data.scheduledStart),
  { message: 'End time must be after start time', path: ['scheduledEnd'] }
)

type CreateSessionFormValues = z.infer<typeof createSessionSchema>

interface CreateSessionModalProps {
  open: boolean
  showId: string
  createdBy: string
  canCreate: boolean
  defaultLanguages: string[]
  onClose: () => void
  onCreated: (sessionId: string) => void
}

export default function CreateSessionModal({
  open,
  showId,
  createdBy,
  canCreate,
  defaultLanguages,
  onClose,
  onCreated,
}: CreateSessionModalProps) {
  const titleId = useId()
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateSessionFormValues>({
    resolver: zodResolver(createSessionSchema),
    defaultValues: {
      title: '',
      friendlyName: '',
      location: '',
      scheduledStart: '',
      scheduledEnd: '',
    },
  })

  const { ref: titleRef, ...titleRegister } = register('title')

  useEffect(() => {
    if (!open) return
    reset({
      title: '',
      friendlyName: '',
      location: '',
      scheduledStart: '',
      scheduledEnd: '',
    })
    const t = window.setTimeout(() => titleInputRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [open, reset])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, isSubmitting, onClose])

  if (!open) return null

  async function onSubmit(values: CreateSessionFormValues) {
    if (!canCreate) {
      setError('root', { message: 'You do not have permission to create sessions.' })
      return
    }

    try {
      const payload: SessionDoc = {
        title: values.title.trim(),
        friendlyName: values.friendlyName.trim(),
        location: values.location.trim(),
        scheduledStart: Timestamp.fromDate(new Date(values.scheduledStart)),
        scheduledEnd: Timestamp.fromDate(new Date(values.scheduledEnd)),
        languages: defaultLanguages.length ? defaultLanguages : ['en'],
        isDraft: true,
        feedState: 'standby',
        approvalState: {},
        createdAt: Timestamp.now(),
        createdBy,
      }

      const fs = getClientFirestore()
      const ref = await addDoc(collection(fs, 'shows', showId, 'sessions'), payload)
      onCreated(ref.id)
      onClose()
    } catch (err: any) {
      console.error('CreateSessionModal: failed to create session', err)
      setError('root', {
        message: err?.message || 'Failed to create session. Please try again.',
      })
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose()
      }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <h2 id={titleId} style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
              Create Session
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Sessions are individual rooms or stages within this show.
            </p>
          </div>
          <button
            type="button"
            id="btn-create-session-close"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form className="form-group" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="field">
            <label htmlFor="session-title" className="label">Session title</label>
            <input
              id="session-title"
              className={`input ${errors.title ? 'error' : ''}`}
              placeholder="Opening Keynote"
              disabled={isSubmitting}
              {...titleRegister}
              ref={(el) => {
                titleRef(el)
                titleInputRef.current = el
              }}
            />
            {errors.title && <p className="field-error">{errors.title.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="session-friendly" className="label">Friendly name</label>
            <input
              id="session-friendly"
              className={`input ${errors.friendlyName ? 'error' : ''}`}
              placeholder="Main Stage"
              disabled={isSubmitting}
              {...register('friendlyName')}
            />
            {errors.friendlyName && <p className="field-error">{errors.friendlyName.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="session-location" className="label">Location / room</label>
            <input
              id="session-location"
              className={`input ${errors.location ? 'error' : ''}`}
              placeholder="W206"
              disabled={isSubmitting}
              {...register('location')}
            />
            {errors.location && <p className="field-error">{errors.location.message}</p>}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="session-start" className="label">Scheduled start</label>
              <input
                id="session-start"
                type="datetime-local"
                className={`input ${errors.scheduledStart ? 'error' : ''}`}
                disabled={isSubmitting}
                {...register('scheduledStart')}
              />
              {errors.scheduledStart && <p className="field-error">{errors.scheduledStart.message}</p>}
            </div>
            <div className="field">
              <label htmlFor="session-end" className="label">Scheduled end</label>
              <input
                id="session-end"
                type="datetime-local"
                className={`input ${errors.scheduledEnd ? 'error' : ''}`}
                disabled={isSubmitting}
                {...register('scheduledEnd')}
              />
              {errors.scheduledEnd && <p className="field-error">{errors.scheduledEnd.message}</p>}
            </div>
          </div>

          {errors.root && (
            <div className="alert alert-error" role="alert">
              {errors.root.message}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              id="btn-create-session-cancel"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-create-session-submit"
              className="btn btn-primary"
              disabled={isSubmitting || !canCreate}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Creating…
                </>
              ) : (
                'Create Session'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
