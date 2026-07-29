import { readFile } from 'fs/promises'
import path from 'path'
import { allDocSlugs } from './nav'

const DOCS_CONTENT_DIR = path.join(process.cwd(), 'content', 'docs')

export async function readDocMarkdown(slug: string): Promise<string | null> {
  if (!allDocSlugs().includes(slug)) return null
  // Prevent path traversal — only allow known nav slugs, and basename only.
  const safe = path.basename(slug)
  if (safe !== slug) return null
  try {
    return await readFile(path.join(DOCS_CONTENT_DIR, `${safe}.md`), 'utf8')
  } catch {
    return null
  }
}
