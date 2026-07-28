'use client'

import { useEffect, useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { addDoc, collection, Timestamp } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { provisionTechAuthUser } from '@/lib/tech/provisionTechUser'
import type { ShowDoc } from '@/types'

const createShowSchema = z.object({
  name: z.string().trim().min(2, 'Show name is required'),
  clientName: z.string().trim().min(2, 'Client name is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  portalSlug: z
    .string()
    .trim()
    .min(2, 'Portal slug is required')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens'),
  techCredential: z.string().trim().min(8, 'Tech credential must be at least 8 characters'),
}).refine(
  (data) => new Date(data.endDate) >= new Date(data.startDate),
  { message: 'End date must be on or after start date', path: ['endDate'] }
)

export type CreateShowFormValues = z.infer<typeof createShowSchema>

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

interface CreateShowModalProps {
  open: boolean
  onClose: () => void
  onCreated: (showId: string) => void
  createdBy: string
  canCreate: boolean
}

export default function CreateShowModal({
  open,
  onClose,
  onCreated,
  createdBy,
  canCreate,
}: CreateShowModalProps) {
  const titleId = useId()
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const slugTouched = useRef(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateShowFormValues>({
    resolver: zodResolver(createShowSchema),
    defaultValues: {
      name: '',
      clientName: '',
      startDate: '',
      endDate: '',
      portalSlug: '',
      techCredential: '',
    },
  })

  const { ref: nameRef, ...nameRegister } = register('name')
  const nameValue = watch('name')

  useEffect(() => {
    if (!open) return
    slugTouched.current = false
    reset({
      name: '',
      clientName: '',
      startDate: '',
      endDate: '',
      portalSlug: '',
      techCredential: '',
    })
    const t = window.setTimeout(() => nameInputRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [open, reset])

  useEffect(() => {
    if (!open || slugTouched.current) return
    const next = slugify(nameValue || '')
    setValue('portalSlug', next, { shouldValidate: false })
  }, [nameValue, open, setValue])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, isSubmitting, onClose])

  if (!open) return null

  async function onSubmit(values: CreateShowFormValues) {
    if (!canCreate) {
      setError('root', { message: 'You do not have permission to create shows.' })
      return
    }

    try {
      const start = new Date(`${values.startDate}T00:00:00`)
      const end = new Date(`${values.endDate}T23:59:59`)

      const payload: ShowDoc = {
        name: values.name.trim(),
        clientName: values.clientName.trim(),
        startDate: Timestamp.fromDate(start),
        endDate: Timestamp.fromDate(end),
        glossary: [],
        branding: {
          primaryColor: '#5b3aee',
          secondaryColor: '#00d4aa',
          logoURL: '',
          endSessionBehavior: 'message',
          endSessionMessage: 'Thank you for attending.',
          portalURL: values.portalSlug.trim(),
        },
        defaultLanguages: ['en', 'es'],
        portalPublished: false,
        rooms: [],
        techCredential: values.techCredential.trim(),
        createdAt: Timestamp.now(),
        createdBy,
      }

      const fs = getClientFirestore()
      const ref = await addDoc(collection(fs, 'shows'), payload)

      try {
        const provisioned = await provisionTechAuthUser({
          showId: ref.id,
          portalSlug: values.portalSlug.trim(),
          techCredential: values.techCredential.trim(),
          createdBy,
        })
        if (provisioned.existed) {
          console.warn('CreateShowModal: tech Auth user already existed for slug; password not rotated')
        }
      } catch (provisionErr) {
        console.error('CreateShowModal: tech user provision failed', provisionErr)
        setError('root', {
          message:
            'Show created, but tech login could not be provisioned. Set the tech credential again from show settings.',
        })
        onCreated(ref.id)
        return
      }

      onCreated(ref.id)
      onClose()
    } catch (err: any) {
      console.error('CreateShowModal: failed to create show', err)
      setError('root', {
        message: err?.message || 'Failed to create show. Please try again.',
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
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId} style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
              Create Show
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              A show holds sessions, branding, and glossary for one client event.
            </p>
          </div>
          <button
            type="button"
            id="btn-create-show-close"
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
            <label htmlFor="show-name" className="label">Show name</label>
            <input
              id="show-name"
              className={`input ${errors.name ? 'error' : ''}`}
              placeholder="ALPFA National Convention 2026"
              disabled={isSubmitting}
              {...nameRegister}
              ref={(el) => {
                nameRef(el)
                nameInputRef.current = el
              }}
            />
            {errors.name && <p className="field-error">{errors.name.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="show-client" className="label">Client name</label>
            <input
              id="show-client"
              className={`input ${errors.clientName ? 'error' : ''}`}
              placeholder="ALPFA"
              disabled={isSubmitting}
              {...register('clientName')}
            />
            {errors.clientName && <p className="field-error">{errors.clientName.message}</p>}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="show-start" className="label">Start date</label>
              <input
                id="show-start"
                type="date"
                className={`input ${errors.startDate ? 'error' : ''}`}
                disabled={isSubmitting}
                {...register('startDate')}
              />
              {errors.startDate && <p className="field-error">{errors.startDate.message}</p>}
            </div>
            <div className="field">
              <label htmlFor="show-end" className="label">End date</label>
              <input
                id="show-end"
                type="date"
                className={`input ${errors.endDate ? 'error' : ''}`}
                disabled={isSubmitting}
                {...register('endDate')}
              />
              {errors.endDate && <p className="field-error">{errors.endDate.message}</p>}
            </div>
          </div>

          <div className="field">
            <label htmlFor="show-portal" className="label">Portal slug</label>
            <input
              id="show-portal"
              className={`input ${errors.portalSlug ? 'error' : ''}`}
              placeholder="alpfa-2026"
              disabled={isSubmitting}
              {...register('portalSlug', {
                onChange: () => {
                  slugTouched.current = true
                },
              })}
            />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Used for <code>/portal/[slug]</code>
            </p>
            {errors.portalSlug && <p className="field-error">{errors.portalSlug.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="show-tech-credential" className="label">Tech panel credential</label>
            <input
              id="show-tech-credential"
              type="password"
              className={`input ${errors.techCredential ? 'error' : ''}`}
              placeholder="Shared password for tech operators"
              autoComplete="new-password"
              disabled={isSubmitting}
              {...register('techCredential')}
            />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Operators sign in at <code>/tech/login</code> with this show&apos;s portal slug + credential.
            </p>
            {errors.techCredential && <p className="field-error">{errors.techCredential.message}</p>}
          </div>

          {errors.root && (
            <div className="alert alert-error" role="alert">
              {errors.root.message}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              id="btn-create-show-cancel"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-create-show-submit"
              className="btn btn-primary"
              disabled={isSubmitting || !canCreate}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Creating…
                </>
              ) : (
                'Create Show'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
