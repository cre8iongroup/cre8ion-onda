import type { ReactNode } from 'react'

/**
 * Shared “Why Onda?” brand-story copy.
 * Single source of truth for WhyOndaModal and /what-is-onda.
 */
export const WHY_ONDA_STORY_PARAGRAPHS: ReactNode[] = [
  <>
    In Spanish, <em>onda</em> means wave.
  </>,
  <>
    Not the kind that crashes and recedes — the kind that travels. Sound moves in waves.
    Story moves in waves. A voice carries what was given to it, adds what it has learned,
    and sends it forward.
  </>,
  <>
    Long before words were written down, they were spoken. Carried person to person,
    generation to generation, across mountains, rivers, and time. The oral traditions of
    Latin America understood something the modern world is still learning: a story doesn&apos;t
    belong to the person telling it. It belongs to everyone it has ever passed through, and
    everyone it has yet to reach.
  </>,
  <>
    Every story is a wave. Each ripple bears witness as it folds into the raw potential of
    a vast and unexplored ocean.
  </>,
  <>
    <em>Buena onda</em>
  </>,
]

/** Renders {@link WHY_ONDA_STORY_PARAGRAPHS} as sequential paragraphs. */
export function WhyOndaStoryCopy() {
  return (
    <>
      {WHY_ONDA_STORY_PARAGRAPHS.map((content, index) => (
        <p key={index}>{content}</p>
      ))}
    </>
  )
}
