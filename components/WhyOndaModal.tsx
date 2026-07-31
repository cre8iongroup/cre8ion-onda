'use client'

import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

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
            Onda
          </h2>
        </div>

        <div className="why-onda-body">
          <p>
            In Spanish, <em>onda</em> means wave.
          </p>
          <p>
            Not the kind that crashes and recedes — the kind that travels. Sound moves in waves.
            Story moves in waves. A voice carries what was given to it, adds what it has learned,
            and sends it forward.
          </p>
          <p>
            Long before words were written down, they were spoken. Carried person to person,
            generation to generation, across mountains, rivers, and time. The oral traditions of
            Latin America understood something the modern world is still learning: a story doesn&apos;t
            belong to the person telling it. It belongs to everyone it has ever passed through, and
            everyone it has yet to reach.
          </p>
          <p>
            Every story is a wave. Each ripple bears witness as it folds into the raw potential of
            a vast and unexplored ocean.
          </p>
          <p>
            <em>Buena onda</em>
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export type WhyOndaLinkProps = {
  className?: string
  id?: string
}

/** Footer / inline trigger that opens {@link WhyOndaModal}. */
export function WhyOndaLink({ className, id }: WhyOndaLinkProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        id={id}
        className={className ?? 'why-onda-link'}
        onClick={() => setOpen(true)}
      >
        why Onda?
      </button>
      <WhyOndaModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export default WhyOndaModal
