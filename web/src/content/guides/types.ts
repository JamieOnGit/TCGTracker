/**
 * Evergreen guides (/guides/{slug}/). Each guide is a TypeScript module holding
 * Markdown, so it ships in the bundle: the site runs on Cloudflare Workers,
 * where there is no filesystem to read .md files from at request time.
 *
 * Accuracy rules for writers: no invented facts, statistics, restock days,
 * prices, fees or dates. Where something changes (fees, shipping, policies)
 * say so and link the official source.
 */
export interface Guide {
  slug: string
  /** H1 and the base of the <title>. */
  title: string
  /** Optional search-focused <title> (brand suffix is added). Defaults to title. */
  seoTitle?: string
  /** Meta description, ~140–160 characters. */
  description: string
  /** One-line summary for the guides hub. */
  dek: string
  published: string // YYYY-MM-DD
  updated: string // YYYY-MM-DD; bump when the content materially changes
  topic: 'buying' | 'collecting' | 'selling' | 'alerts'
  /** Internal links shown in "Related" (use canonical paths). */
  related: { label: string; href: string }[]
  /** Visible FAQ at the end of the guide (also FAQPage JSON-LD). */
  faqs: { q: string; a: string }[]
  /** Markdown body (## and ### headings, lists, links, bold). */
  body: string
}
