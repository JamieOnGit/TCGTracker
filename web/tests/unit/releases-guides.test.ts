import { describe, expect, it } from 'vitest'
import { RETAILER_COPY, STATE_COPY } from '@/content/drops-copy'
import { GUIDES } from '@/content/guides'
import type { ReleaseRow } from '@/lib/data/types'
import { AU_STATES } from '@/lib/data/types'
import { buildIcs, escapeText, foldLine } from '@/lib/ics'
import { inlineText, outline, parseInline, parseMarkdown, safeHref } from '@/lib/markdown'
import { formatReleaseDate, groupReleases, isUpcoming, periodEnd, releasePageTitle, todayAu } from '@/lib/releases'
import { releaseEvent } from '@/lib/seo/jsonld'

process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com.au'

function rel(p: Partial<ReleaseRow>): ReleaseRow {
  return {
    id: p.slug ?? 'x', game: 'pokemon', lang: 'en', slug: 'x', title: 'X', kind: 'set_release', releaseDate: null, datePrecision: 'day',
    confidence: 'official', set: null, products: [], retailerSlugs: [], summary: null, bodyMd: null, sourceName: null, sourceUrl: null, updatedAt: '2026-09-01T00:00:00Z',
    ...p,
  }
}

describe('release dates', () => {
  it('words each precision', () => {
    expect(formatReleaseDate({ releaseDate: '2026-11-06', datePrecision: 'day' })).toBe('6 November 2026')
    expect(formatReleaseDate({ releaseDate: '2026-11-01', datePrecision: 'month' })).toBe('November 2026')
    expect(formatReleaseDate({ releaseDate: '2026-10-01', datePrecision: 'quarter' })).toBe('Q4 2026')
    expect(formatReleaseDate({ releaseDate: null, datePrecision: 'tbc' })).toBe('TBC')
    expect(formatReleaseDate({ releaseDate: '2026-11-06', datePrecision: 'tbc' })).toBe('TBC')
  })
  it('knows the end of each period', () => {
    expect(periodEnd({ releaseDate: '2026-02-01', datePrecision: 'month' })).toBe('2026-02-28')
    expect(periodEnd({ releaseDate: '2026-11-15', datePrecision: 'quarter' })).toBe('2026-12-31')
    expect(periodEnd({ releaseDate: null, datePrecision: 'tbc' })).toBeNull()
  })
  it('uses the Australian calendar date', () => {
    // 20:00 UTC on 30 Sep is 06:00 on 1 Oct in Melbourne.
    expect(todayAu(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01')
  })
  it('keeps a month-precision release upcoming until the month ends', () => {
    expect(isUpcoming({ releaseDate: '2026-09-01', datePrecision: 'month' }, '2026-09-30')).toBe(true)
    expect(isUpcoming({ releaseDate: '2026-09-01', datePrecision: 'day' }, '2026-09-30')).toBe(false)
  })
  it('groups the hub: months, quarter after its months, recent, TBC', () => {
    const rows = [
      rel({ slug: 'a', releaseDate: '2026-10-10' }),
      rel({ slug: 'q', releaseDate: '2026-10-01', datePrecision: 'quarter' }),
      rel({ slug: 'b', releaseDate: '2026-11-01', datePrecision: 'month' }),
      rel({ slug: 'old', releaseDate: '2026-09-01' }),
      rel({ slug: 'ancient', releaseDate: '2026-05-01' }),
      rel({ slug: 't', releaseDate: null, datePrecision: 'tbc' }),
    ]
    const g = groupReleases(rows, '2026-09-30')
    expect(g.upcoming.map((x) => x.label)).toEqual(['October 2026', 'November 2026', 'Q4 2026'])
    expect(g.recent.map((r) => r.slug)).toEqual(['old'])
    expect(g.tbc.map((r) => r.slug)).toEqual(['t'])
  })
  it('titles pages for the search intent', () => {
    expect(releasePageTitle({ title: 'Mega Evolution', lang: 'jp', kind: 'set_release' })).toBe('Mega Evolution Release Date in Australia (JP)')
    expect(releasePageTitle({ title: 'Mega Evolution', lang: 'en', kind: 'preorder_open' })).toBe('Mega Evolution Pre-order Date in Australia (EN)')
  })
  it('Event JSON-LD only has a startDate when the day is known', () => {
    const base = { name: 'n', description: 'd', path: '/releases/pokemon/x/', organizer: 'The Pokémon Company' }
    expect(releaseEvent({ ...base, startDate: '2026-11-06' })).toMatchObject({ '@type': 'Event', startDate: '2026-11-06', eventStatus: 'https://schema.org/EventScheduled' })
    expect(releaseEvent({ ...base, startDate: null })).not.toHaveProperty('startDate')
  })
})

describe('ICS builder', () => {
  it('escapes TEXT values', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })
  it('folds long lines at 75 octets without splitting UTF-8 characters', () => {
    const line = 'SUMMARY:' + 'Pokémon '.repeat(20)
    const folded = foldLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const [i, p] of parts.entries()) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
      if (i > 0) expect(p.startsWith(' ')).toBe(true)
    }
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line)
  })
  it('writes all-day events with stable UIDs and CRLF endings', () => {
    const ics = buildIcs(
      { name: 'Test, calendar', events: [{ uid: 'abc@tcgtrade.com.au', date: '2026-12-31', summary: 'Set; one', url: 'https://example.com.au/releases/pokemon/x/', updatedAt: '2026-09-01T10:20:30Z' }] },
      new Date('2026-09-30T00:00:00Z'),
    )
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('X-WR-CALNAME:Test\\, calendar\r\n')
    expect(ics).toContain('UID:abc@tcgtrade.com.au\r\n')
    expect(ics).toContain('DTSTAMP:20260901T102030Z\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20270101\r\n')
    expect(ics).toContain('SUMMARY:Set\\; one\r\n')
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
  })
})

describe('markdown subset', () => {
  it('parses headings, paragraphs, lists and quotes', () => {
    const blocks = parseMarkdown('# Title\n\nPara one\ncontinues.\n\n## Section\n\n- a\n- **b**\n\n1. one\n2. two\n\n> quoted')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'list', 'quote'])
    expect(blocks[0]).toMatchObject({ level: 2, id: 'title' }) // a stray H1 is demoted
    expect(blocks[1]).toMatchObject({ children: [{ type: 'text', value: 'Para one continues.' }] })
    expect(blocks[4]).toMatchObject({ ordered: true })
    expect(outline(blocks).map((h) => h.id)).toEqual(['title', 'section'])
  })
  it('gives duplicate headings unique ids', () => {
    expect(outline(parseMarkdown('## FAQ\n\n## FAQ')).map((h) => h.id)).toEqual(['faq', 'faq-2'])
  })
  it('parses inline marks and links', () => {
    const nodes = parseInline('A **bold** and *em* with `code` and [a link](/drops/) and [ext](https://www.psacard.com/).')
    expect(nodes.map((n) => n.type)).toEqual(['text', 'strong', 'text', 'em', 'text', 'code', 'text', 'link', 'text', 'link', 'text'])
    expect(nodes[7]).toMatchObject({ href: '/drops/', external: false })
    expect(nodes[9]).toMatchObject({ href: 'https://www.psacard.com/', external: true })
  })
  it('never passes raw HTML or unsafe links through', () => {
    const nodes = parseInline('<script>alert(1)</script> [x](javascript:alert(1))')
    expect(nodes.every((n) => n.type === 'text')).toBe(true)
    expect(inlineText(nodes)).toContain('<script>')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('//evil.example')).toBeNull()
    expect(safeHref('mailto:hello@tcgtrade.com.au')).toBe('mailto:hello@tcgtrade.com.au')
  })
})

describe('guides content', () => {
  const INTERNAL = /^\/($|(drops|releases|guides|cards|market-cap|marketplace|premium|methodology|deals|account\/alerts\/drops)\/)/
  it('has unique slugs, titles and descriptions of a sensible length', () => {
    expect(new Set(GUIDES.map((g) => g.slug)).size).toBe(GUIDES.length)
    expect(new Set(GUIDES.map((g) => g.title)).size).toBe(GUIDES.length)
    for (const g of GUIDES) {
      expect(g.description.length, g.slug).toBeGreaterThanOrEqual(110)
      expect(g.description.length, g.slug).toBeLessThanOrEqual(200)
      expect(g.faqs.length, g.slug).toBeGreaterThanOrEqual(3)
      expect(g.updated >= g.published, g.slug).toBe(true)
    }
  })
  it('bodies are 700+ words with H2s and only canonical internal links', () => {
    const slugs = new Set(GUIDES.map((g) => g.slug))
    for (const g of GUIDES) {
      expect(g.body.split(/\s+/).length, g.slug).toBeGreaterThanOrEqual(700)
      expect(outline(parseMarkdown(g.body)).length, g.slug).toBeGreaterThanOrEqual(4)
      const links = [...g.body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!).concat(g.related.map((r) => r.href))
      for (const href of links) {
        expect(safeHref(href), `${g.slug}: ${href}`).not.toBeNull()
        if (href.startsWith('/')) {
          expect(href.endsWith('/'), `${g.slug}: ${href} needs a trailing slash`).toBe(true)
          expect(INTERNAL.test(href), `${g.slug}: ${href}`).toBe(true)
          const guide = /^\/guides\/([^/]+)\/$/.exec(href)?.[1]
          if (guide) expect(slugs.has(guide), `${g.slug}: unknown guide ${guide}`).toBe(true)
        }
      }
    }
  })
})

describe('drops copy', () => {
  it('covers every state and the main retailers with unique text', () => {
    for (const s of AU_STATES) expect(STATE_COPY[s], s).toBeDefined()
    for (const r of ['jb-hi-fi', 'kmart', 'big-w', 'target-au', 'eb-games', 'premium-bandai-au', 'toymate', 'myer', 'local-game-store']) expect(RETAILER_COPY[r], r).toBeDefined()
    const all = [...Object.values(STATE_COPY), ...Object.values(RETAILER_COPY)]
    const intros = all.flatMap((c) => c.intro)
    expect(new Set(intros).size).toBe(intros.length)
    const questions = all.flatMap((c) => c.faqs.map((f) => f.q))
    expect(new Set(questions).size).toBe(questions.length)
    for (const c of all) expect(c.faqs.length).toBeGreaterThanOrEqual(3)
  })
})
