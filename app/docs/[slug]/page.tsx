import { notFound } from 'next/navigation'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import { allDocSlugs, findDocNavItem } from '@/lib/docs/nav'
import { readDocMarkdown } from '@/lib/docs/loadDoc'

type PageProps = {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return allDocSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params
  const hit = findDocNavItem(slug)
  return {
    title: hit?.item.title ?? 'Docs',
  }
}

export default async function DocsSlugPage({ params }: PageProps) {
  const { slug } = await params
  if (!findDocNavItem(slug)) notFound()

  const markdown = await readDocMarkdown(slug)
  if (markdown == null) notFound()

  return (
    <article className="docs-article">
      {/* Full markdown — in-repo authored content, not user input. */}
      <Markdown remarkPlugins={[remarkBreaks]}>{markdown}</Markdown>
    </article>
  )
}
