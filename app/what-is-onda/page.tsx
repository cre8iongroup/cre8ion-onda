import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'What is cre8ion Onda?',
  description:
    'Live transcription, AI session notes, and event navigation for conferences and conventions.',
  robots: { index: true, follow: true },
}

/**
 * Product lead-gen page for event producers who find Onda via an attendee portal.
 * Marketing copy is placeholder until client-approved final language is provided.
 */
export default function WhatIsOndaPage() {
  return (
    <main className="product-landing">
      <div className="product-landing-inner">
        <p className="product-landing-eyebrow">cre8ion Onda</p>
        <h1 className="product-landing-title">
          {/* PLACEHOLDER COPY — not final client-approved marketing */}
          Live captions, AI notes, and event navigation — built for producers
        </h1>
        <p className="product-landing-lede">
          {/* PLACEHOLDER COPY */}
          cre8ion Onda helps conferences and conventions deliver real-time multilingual
          transcription to every room, capture AI-assisted session notes, and give attendees a
          clear path through the event — from show home to live captions.
        </p>

        <section className="product-landing-section" aria-labelledby="product-what-heading">
          <h2 id="product-what-heading">What it does</h2>
          <ul>
            {/* PLACEHOLDER COPY */}
            <li>
              <strong>Live transcription</strong> — room-scoped caption windows for attendees and
              for video switchers / OBS.
            </li>
            <li>
              <strong>AI session notes</strong> — structured takeaways after sessions for review
              and publishing workflows.
            </li>
            <li>
              <strong>Event navigation</strong> — branded show home, rooms, and session schedule
              that attendees open from QR codes.
            </li>
          </ul>
        </section>

        <section className="product-landing-section" aria-labelledby="product-who-heading">
          <h2 id="product-who-heading">Who it&apos;s for</h2>
          <p>
            {/* PLACEHOLDER COPY */}
            Event producers, AV teams, and associations running multi-room conventions who need
            reliable live captions and a polished attendee experience — without bolting together
            disconnected tools.
          </p>
        </section>

        <p className="product-landing-cta-wrap">
          <a
            className="product-landing-cta"
            href="mailto:connect@cre8iongroup.com?subject=I%20want%20to%20learn%20more%20about%20cre8ion%20Onda"
          >
            Talk to cre8ion
          </a>
        </p>
      </div>
    </main>
  )
}
