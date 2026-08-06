'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { addDoc, collection, Timestamp } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import {
  DEFAULT_OUTPUT_BACKGROUND,
  DEFAULT_OUTPUT_FONT_SIZE_PX,
  OUTPUT_BUILDER_WINDOW_COUNT,
  OUTPUT_CHROMA_GREEN,
  sanitizeOutputWindows,
} from '@/lib/output/defaults'
import type { OutputLayoutDoc } from '@/types'

const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' },
]

const BG_SWATCHES = [
  { value: '#000000', label: 'Black' },
  { value: '#FFFFFF', label: 'White' },
  { value: OUTPUT_CHROMA_GREEN, label: 'Chroma key' },
]

const windowSchema = z.object({
  language: z.string(), // '' = unset; converted to null on submit
  fontSize: z.number().min(12).max(200),
  backgroundColor: z.string().trim().min(1, 'Background is required'),
  textColor: z.string().optional(),
})

const createPresetSchema = z.object({
  name: z.string().trim().min(2, 'Preset name is required'),
  windows: z.array(windowSchema).min(1),
})

type CreatePresetFormValues = z.infer<typeof createPresetSchema>

interface CreateLayoutModalProps {
  open: boolean
  onClose: () => void
  onCreated: (layoutId: string) => void
  createdBy: string
  canCreate: boolean
}

function emptyWindow(language: string): CreatePresetFormValues['windows'][number] {
  return {
    language,
    fontSize: DEFAULT_OUTPUT_FONT_SIZE_PX,
    backgroundColor: DEFAULT_OUTPUT_BACKGROUND,
    textColor: '',
  }
}

function defaultFormValues(): CreatePresetFormValues {
  return {
    name: '',
    windows: [
      emptyWindow('en'),
      ...Array.from({ length: OUTPUT_BUILDER_WINDOW_COUNT - 1 }, () => emptyWindow('')),
    ],
  }
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
  const [rootError, setRootError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreatePresetFormValues>({
    resolver: zodResolver(createPresetSchema),
    defaultValues: defaultFormValues(),
  })

  const { ref: nameRegisterRef, ...nameRegister } = register('name')
  const windows = watch('windows')

  useEffect(() => {
    if (!open) return
    reset(defaultFormValues())
    setRootError(null)
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

  async function onSubmit(values: CreatePresetFormValues) {
    if (!canCreate) {
      setRootError('You do not have permission to manage output presets.')
      return
    }

    try {
      const sanitized = sanitizeOutputWindows(
        values.windows.map((w) => ({
          language: w.language && w.language.trim() ? w.language.trim() : null,
          fontSize: w.fontSize,
          backgroundColor: w.backgroundColor,
          ...(w.textColor && w.textColor.trim() ? { textColor: w.textColor.trim() } : {}),
        })),
      )

      const payload: OutputLayoutDoc = {
        name: values.name.trim(),
        windows: sanitized,
        createdBy,
        createdAt: Timestamp.now(),
      }

      const fs = getClientFirestore()
      const ref = await addDoc(collection(fs, 'outputLayouts'), payload)
      onCreated(ref.id)
      onClose()
    } catch (err: unknown) {
      console.error('CreateLayoutModal: failed to create preset', err)
      setRootError(err instanceof Error ? err.message : 'Failed to create preset. Please try again.')
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
              Create Output Preset
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Starting-point window configs applied once in the Output Builder.
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
            <label htmlFor="preset-name" className="label">Name</label>
            <input
              id="preset-name"
              className={`input ${errors.name ? 'error' : ''}`}
              placeholder="Two Window - Basic"
              disabled={isSubmitting}
              {...nameRegister}
              ref={(el) => {
                nameRegisterRef(el)
                nameRef.current = el
              }}
            />
            {errors.name && <p className="field-error">{errors.name.message}</p>}
          </div>

          {(windows || []).map((_, index) => (
            <fieldset
              key={index}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: 'var(--space-4)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <legend className="label" style={{ padding: '0 var(--space-2)' }}>
                Window {index + 1}
              </legend>

              <div className="field-row">
                <div className="field">
                  <label htmlFor={`preset-lang-${index}`} className="label">Language</label>
                  <select
                    id={`preset-lang-${index}`}
                    className="input"
                    disabled={isSubmitting}
                    {...register(`windows.${index}.language`)}
                  >
                    <option value="">Unset</option>
                    {LANGS.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`preset-font-${index}`} className="label">Font size (px)</label>
                  <input
                    id={`preset-font-${index}`}
                    type="number"
                    min={12}
                    max={200}
                    className={`input ${errors.windows?.[index]?.fontSize ? 'error' : ''}`}
                    disabled={isSubmitting}
                    {...register(`windows.${index}.fontSize`, { valueAsNumber: true })}
                  />
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor={`preset-bg-${index}`} className="label">Background</label>
                  <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                    {BG_SWATCHES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={isSubmitting}
                        onClick={() => setValue(`windows.${index}.backgroundColor`, s.value, { shouldDirty: true })}
                        title={s.label}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: 'inline-block',
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            background: s.value,
                            border: '1px solid var(--color-border)',
                            marginRight: 6,
                            verticalAlign: 'middle',
                          }}
                        />
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <input
                    id={`preset-bg-${index}`}
                    className={`input ${errors.windows?.[index]?.backgroundColor ? 'error' : ''}`}
                    placeholder="#000000"
                    disabled={isSubmitting}
                    {...register(`windows.${index}.backgroundColor`)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`preset-text-${index}`} className="label">Text color (optional)</label>
                  <input
                    id={`preset-text-${index}`}
                    className="input"
                    placeholder="Inherit from brand if empty"
                    disabled={isSubmitting}
                    {...register(`windows.${index}.textColor`)}
                  />
                </div>
              </div>
            </fieldset>
          ))}

          {rootError && (
            <div className="alert alert-error" role="alert">
              {rootError}
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
                'Create Preset'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
