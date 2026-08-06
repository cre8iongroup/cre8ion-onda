import type { Metadata } from 'next'
import { WhyOndaStoryCopy } from '@/components/whyOndaCopy'

export const metadata: Metadata = {
  title: 'What is cre8ion Onda?',
  description:
    'Custom translation software for multi-room shows — live captioning, real-time translation, and AI-generated notes, built by show producers.',
  robots: { index: true, follow: true },
}

/** Product lead-gen page for event producers who find Onda via an attendee portal. */
export default function WhatIsOndaPage() {
  return (
    <main className="product-landing">
      <div className="product-landing-inner">
        <p className="product-landing-eyebrow">cre8ion Onda</p>

        <header className="product-landing-hero">
          <h1 className="product-landing-title">
            Custom translation software, built by show producers.
          </h1>
          <p className="product-landing-lede">
            cre8ion Onda delivers live captioning, real-time translation, and AI-generated notes
            for multi-room shows — built by a production company, for the shows we run ourselves.
          </p>
          <p className="product-landing-lede product-landing-lede--follow">
            Every show with multiple languages runs into the same wall: only so much screen real
            estate on stage, and a vendor bill that scales with every hour of programming. We hit
            that wall producing our own shows — so we built our way through it. Onda pairs
            on-screen captioning with a mobile-friendly companion, so if the stage only has room
            for two languages, anyone in the room can pull up French, Portuguese, or whatever they
            need, right on their phone.
          </p>
        </header>

        <section className="product-landing-section" aria-labelledby="product-alpfa-heading">
          <h2 id="product-alpfa-heading">ALPFA — the flagship</h2>
          <p>
            Onda is premiering at the ALPFA National Convention — one of the largest gatherings of
            Latino professionals in the country — powering live captions, multilingual translation,
            and session notes across every stage and room.
          </p>
        </section>

        <section
          className="product-landing-section product-landing-section--story"
          aria-labelledby="product-why-heading"
        >
          <h2 id="product-why-heading">Why we called it Onda</h2>
          <div className="product-landing-story">
            <WhyOndaStoryCopy />
          </div>
        </section>

        <section className="product-landing-section" aria-labelledby="product-cost-heading">
          <h2 id="product-cost-heading">Built to cost less</h2>
          <p>
            Because we built this ourselves instead of licensing someone else&apos;s infrastructure,
            we&apos;re able to offer the same coverage at a fraction of the traditional cost — and put
            those savings back into the show.
          </p>
        </section>

        <section className="product-landing-cta-block" aria-labelledby="product-cta-heading">
          <h2 id="product-cta-heading" className="product-landing-cta-heading">
            Want Onda at your next show?
          </h2>
          <p className="product-landing-cta-wrap">
            <a
              className="product-landing-cta"
              href="mailto:connect@cre8iongroup.com?subject=I%20want%20to%20learn%20more%20about%20cre8ion%20Onda"
            >
              Talk to cre8ion
            </a>
          </p>
        </section>
      </div>
    </main>
  )
}
