/**
 * A small, dependency-free Markdown subset for guides and release notes:
 * headings (## to ####; a stray # is demoted to ## because the page owns the
 * H1), paragraphs, bullet and numbered lists, blockquotes, **bold**, *italic*,
 * `code` and [links](/path/). It parses to a tree that <Markdown> renders as
 * React elements, so text is always escaped and raw HTML is never passed
 * through (it simply shows as text). Links are limited to site paths, #anchors,
 * http(s) and mailto.
 */
import { slugify } from '@/lib/seo/urls'

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; external: boolean; children: Inline[] }

export type Block =
  | { type: 'heading'; level: 2 | 3 | 4; id: string; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; children: Inline[] }

/** Returns the href if it is safe to link to, otherwise null. */
export function safeHref(href: string): string | null {
  const h = href.trim()
  if (h.startsWith('/') && !h.startsWith('//')) return h
  if (h.startsWith('#')) return h
  if (/^https?:\/\/[^\s]+$/i.test(h)) return h
  if (/^mailto:[^\s]+$/i.test(h)) return h
  return null
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ type: 'text', value: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    if (rest.startsWith('**')) {
      const j = src.indexOf('**', i + 2)
      if (j > i + 2) {
        flush()
        out.push({ type: 'strong', children: parseInline(src.slice(i + 2, j)) })
        i = j + 2
        continue
      }
    }
    if (rest[0] === '*' && rest[1] && rest[1] !== ' ' && rest[1] !== '*') {
      const j = src.indexOf('*', i + 1)
      if (j > i + 1 && src[j - 1] !== ' ') {
        flush()
        out.push({ type: 'em', children: parseInline(src.slice(i + 1, j)) })
        i = j + 1
        continue
      }
    }
    if (rest[0] === '`') {
      const j = src.indexOf('`', i + 1)
      if (j > i + 1) {
        flush()
        out.push({ type: 'code', value: src.slice(i + 1, j) })
        i = j + 1
        continue
      }
    }
    if (rest[0] === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)
      if (m) {
        const href = safeHref(m[2]!)
        flush()
        if (href) out.push({ type: 'link', href, external: /^https?:/i.test(href), children: parseInline(m[1]!) })
        else out.push({ type: 'text', value: m[1]! })
        i += m[0].length
        continue
      }
    }
    buf += src[i]
    i++
  }
  flush()
  return out
}

export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.value : inlineText(n.children))).join('')
}

const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  const ids = new Map<string, number>()
  const uniqueId = (text: string) => {
    const base = slugify(text) || 'section'
    const n = ids.get(base) ?? 0
    ids.set(base, n + 1)
    return n ? `${base}-${n + 1}` : base
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      const level = Math.min(Math.max(h[1]!.length, 2), 4) as 2 | 3 | 4
      const children = parseInline(h[2]!)
      blocks.push({ type: 'heading', level, id: uniqueId(inlineText(children)), children })
      i++
      continue
    }
    const listMatch = BULLET.exec(line) ?? NUMBERED.exec(line)
    if (listMatch) {
      const ordered = !BULLET.test(line)
      const re = ordered ? NUMBERED : BULLET
      const items: string[] = []
      while (i < lines.length && lines[i]!.trim()) {
        const m = re.exec(lines[i]!)
        if (m) items.push(m[1]!)
        else if (/^\s+\S/.test(lines[i]!) && items.length) items[items.length - 1] += ' ' + lines[i]!.trim() // wrapped item
        else break
        i++
      }
      blocks.push({ type: 'list', ordered, items: items.map(parseInline) })
      continue
    }
    if (line.startsWith('>')) {
      const text: string[] = []
      while (i < lines.length && lines[i]!.startsWith('>')) text.push(lines[i++]!.replace(/^>\s?/, ''))
      blocks.push({ type: 'quote', children: parseInline(text.join(' ').trim()) })
      continue
    }
    const text: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^#{1,6}\s/.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBERED.test(lines[i]!) && !lines[i]!.startsWith('>')) {
      text.push(lines[i++]!.trim())
    }
    blocks.push({ type: 'paragraph', children: parseInline(text.join(' ')) })
  }
  return blocks
}

/** H2s for a table of contents. */
export function outline(blocks: Block[]): { id: string; text: string }[] {
  return blocks.flatMap((b) => (b.type === 'heading' && b.level === 2 ? [{ id: b.id, text: inlineText(b.children) }] : []))
}
