'use client'

import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { WhyOndaStoryCopy } from '@/components/whyOndaCopy'

export type WhyOndaModalProps = {
  open: boolean
  onClose: () => void
}

/**
 * Shared “Why Onda?” brand story modal.
 * Usable from Admin, Operator, and later Attendee / Output surfaces.
 *
 * Portaled to document.body so position:fixed + z-index are not trapped by
 * ancestor stacking contexts (e.g. .panel-sidebar { position: sticky }).
 */
export function WhyOndaModal({ open, onClose }: WhyOndaModalProps) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // open is only set by user interaction, so document is always available here.
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="modal-backdrop why-onda-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal-panel why-onda-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="why-onda-hero">
          <button
            type="button"
            className="btn btn-ghost btn-sm why-onda-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
          <h2 id={titleId} className="why-onda-hero-word">
            Why Onda?
          </h2>
        </div>

        <div className="why-onda-body">
          <WhyOndaStoryCopy />
        </div>
      </div>
    </div>,
    document.body,
  )
}

export type WhyOndaLinkProps = {
  className?: string
  id?: string
  children?: React.ReactNode
}

/** Footer / inline trigger that opens {@link WhyOndaModal}. */
export function WhyOndaLink({ className, id, children }: WhyOndaLinkProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        id={id}
        className={className ?? 'why-onda-link'}
        onClick={() => setOpen(true)}
      >
        {children ?? 'why Onda?'}
      </button>
      <WhyOndaModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export default WhyOndaModal
