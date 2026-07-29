/**
 * Explicit ordered nav for /docs — not directory auto-scanning.
 * Add a matching content/docs/{slug}.md when adding a page here.
 */

export type DocsNavItem = {
  slug: string
  title: string
}

export type DocsNavSection = {
  title: string
  items: DocsNavItem[]
}

export const DOCS_NAV: DocsNavSection[] = [
  {
    title: 'Setup & Technical',
    items: [{ slug: 'getting-started', title: 'Getting started' }],
  },
  {
    title: 'Admin & Editor',
    items: [{ slug: 'admin-overview', title: 'Admin overview' }],
  },
  {
    title: 'Review Process',
    items: [{ slug: 'review-workflow', title: 'Review workflow' }],
  },
]

/** Flat list of all slugs in nav order (for generateStaticParams / lookup). */
export function allDocSlugs(): string[] {
  return DOCS_NAV.flatMap((section) => section.items.map((item) => item.slug))
}

export function findDocNavItem(
  slug: string,
): { section: DocsNavSection; item: DocsNavItem } | null {
  for (const section of DOCS_NAV) {
    const item = section.items.find((i) => i.slug === slug)
    if (item) return { section, item }
  }
  return null
}
