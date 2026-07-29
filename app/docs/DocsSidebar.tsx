'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DOCS_NAV } from '@/lib/docs/nav'

/** Client sidebar so the active slug can be highlighted without a server round-trip. */
export default function DocsSidebar() {
  const pathname = usePathname()

  return (
    <aside className="docs-sidebar" aria-label="Documentation">
      {DOCS_NAV.map((section) => (
        <div key={section.title} className="docs-nav-section">
          <div className="docs-nav-section-title">{section.title}</div>
          <ul>
            {section.items.map((item) => {
              const href = `/docs/${item.slug}`
              const active = pathname === href
              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    className={active ? 'docs-nav-link is-active' : 'docs-nav-link'}
                    aria-current={active ? 'page' : undefined}
                  >
                    {item.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </aside>
  )
}
