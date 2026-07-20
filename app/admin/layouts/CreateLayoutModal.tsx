'use client'

import { useEffect, useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { addDoc, collection, Timestamp } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import type {
  BackgroundType,
  CaptionLayout,
  FontSize,
  OutputLayoutDoc,
} from '@/types'

const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' },
]

const createLayoutSchema = z.object({
  name: z.string().trim().min(2, 'Layout name is required'),
  primaryLanguage: z.string().min(1, 'Primary language is required'),
  secondaryLanguage: z.string().optional(),
  fontSize: z.enum(['small', 'medium', 'large', 'xlarge']),
  backgroundType: z.enum(['black', 'white', 'chromaKey', 'custom']),
  backgroundColor: z.string().optional(),
  layout: z.enum(['stacked', 'sideBySide']),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex color like #FFFFFF'),
  showSpeakerLabels: z.boolean(),
}).refine(
  (data) => {
    if (data.backgroundType !== 'custom') return true
    return Boolean(data.backgroundColor && /^#[0-9A-Fa-f]{6}$/.test(data.backgroundColor))
  },
  { message: 'Custom background requires a hex color', path: ['backgroundColor'] }
).refine(
  (data) => !data.secondaryLanguage || data.secondaryLanguage !== data.primaryLanguage,
  { message: 'Secondary language must differ from primary', path: ['secondaryLanguage'] }
)

type CreateLayoutFormValues = z.infer<typeof createLayoutSchema>

interface CreateLayoutModalProps {
  open: boolean
  onClose: () => void
  onCreated: (layoutId: string) => void
  createdBy: string
  canCreate: boolean
}

export default function CreateLayoutModal({
  open,
  onClose,
  onCreated,
  createdBy,
  canCreate,
}: CreateLayoutModalProps) {
  const titleId = useId()
  const nameRef = useRef<HTMLInputElement | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateLayoutFormValues>({
    resolver: zodResolver(createLayoutSchema),
    defaultValues: {
      name: '',
      primaryLanguage: 'en',
      secondaryLanguage: 'es',
      fontSize: 'large',
      backgroundType: 'black',
      backgroundColor: '#00FF00',
      layout: 'stacked',
      textColor: '#FFFFFF',
      showSpeakerLabels: false,
    },
  })

  const { ref: nameRegisterRef, ...nameRegister } = register('name')
  const backgroundType = watch('backgroundType')

  useEffect(() => {
    if (!open) return
    reset({
      name: '',
      primaryLanguage: 'en',
      secondaryLanguage: 'es',
      fontSize: 'large',
      backgroundType: 'black',
      backgroundColor: '#00FF00',
      layout: 'stacked',
      textColor: '#FFFFFF',
      showSpeakerLabels: false,
    })
    const t = window.setTimeout(() => nameRef.current?.focus(), 50)
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

  async function onSubmit(values: CreateLayoutFormValues) {
    if (!canCreate) {
      setError('root', { message: 'You do not have permission to manage layouts.' })
      return
    }

    try {
      const payload: OutputLayoutDoc = {
        name: values.name.trim(),
        primaryLanguage: values.primaryLanguage,
        secondaryLanguage: values.secondaryLanguage || undefined,
        fontSize: values.fontSize as FontSize,
        backgroundType: values.backgroundType as BackgroundType,
        backgroundColor:
          values.backgroundType === 'custom' ? values.backgroundColor : undefined,
        layout: values.layout as CaptionLayout,
        textColor: values.textColor.toUpperCase(),
        showSpeakerLabels: values.showSpeakerLabels,
        createdBy,
        createdAt: Timestamp.now(),
      }

      const fs = getClientFirestore()
      const ref = await addDoc(collection(fs, 'outputLayouts'), payload)
      onCreated(ref.id)
      onClose()
    } catch (err: any) {
      console.error('CreateLayoutModal: failed to create layout', err)
      setError('root', {
        message: err?.message || 'Failed to create layout. Please try again.',
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
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <h2 id={titleId} style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
              Create Output Layout
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Templates for attendee captions and output feeds.
            </p>
          </div>
          <button
            type="button"
            id="btn-create-layout-close"
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
            <label htmlFor="layout-name" className="label">Name</label>
            <input
              id="layout-name"
              className={`input ${errors.name ? 'error' : ''}`}
              placeholder="Main Stage Dual Caption"
              disabled={isSubmitting}
              {...nameRegister}
              ref={(el) => {
                nameRegisterRef(el)
                nameRef.current = el
              }}
            />
            {errors.name && <p className="field-error">{errors.name.message}</p>}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="layout-primary-lang" className="label">Primary language</label>
              <select
                id="layout-primary-lang"
                className={`input ${errors.primaryLanguage ? 'error' : ''}`}
                disabled={isSubmitting}
                {...register('primaryLanguage')}
              >
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              {errors.primaryLanguage && <p className="field-error">{errors.primaryLanguage.message}</p>}
            </div>
            <div className="field">
              <label htmlFor="layout-secondary-lang" className="label">Secondary language</label>
              <select
                id="layout-secondary-lang"
                className={`input ${errors.secondaryLanguage ? 'error' : ''}`}
                disabled={isSubmitting}
                {...register('secondaryLanguage')}
              >
                <option value="">None</option>
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              {errors.secondaryLanguage && <p className="field-error">{errors.secondaryLanguage.message}</p>}
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="layout-arrangement" className="label">Caption layout</label>
              <select
                id="layout-arrangement"
                className="input"
                disabled={isSubmitting}
                {...register('layout')}
              >
                <option value="stacked">Stacked</option>
                <option value="sideBySide">Side by side</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="layout-font-size" className="label">Font size</label>
              <select
                id="layout-font-size"
                className="input"
                disabled={isSubmitting}
                {...register('fontSize')}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
                <option value="xlarge">X-Large</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="layout-bg-type" className="label">Background</label>
              <select
                id="layout-bg-type"
                className="input"
                disabled={isSubmitting}
                {...register('backgroundType')}
              >
                <option value="black">Black</option>
                <option value="white">White</option>
                <option value="chromaKey">Chroma key</option>
                <option value="custom">Custom color</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="layout-text-color" className="label">Text color</label>
              <input
                id="layout-text-color"
                className={`input ${errors.textColor ? 'error' : ''}`}
                placeholder="#FFFFFF"
                disabled={isSubmitting}
                {...register('textColor')}
              />
              {errors.textColor && <p className="field-error">{errors.textColor.message}</p>}
            </div>
          </div>

          {backgroundType === 'custom' && (
            <div className="field">
              <label htmlFor="layout-bg-color" className="label">Background color</label>
              <input
                id="layout-bg-color"
                className={`input ${errors.backgroundColor ? 'error' : ''}`}
                placeholder="#00FF00"
                disabled={isSubmitting}
                {...register('backgroundColor')}
              />
              {errors.backgroundColor && <p className="field-error">{errors.backgroundColor.message}</p>}
            </div>
          )}

          <div className="field">
            <label className="checkbox-row">
              <input type="checkbox" disabled={isSubmitting} {...register('showSpeakerLabels')} />
              <span>Show speaker labels on output</span>
            </label>
          </div>

          {errors.root && (
            <div className="alert alert-error" role="alert">
              {errors.root.message}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              id="btn-create-layout-cancel"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-create-layout-submit"
              className="btn btn-primary"
              disabled={isSubmitting || !canCreate}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Creating…
                </>
              ) : (
                'Create Layout'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
