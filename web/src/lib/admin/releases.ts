/**
 * Release calendar editing (admin console): the products text format and the
 * zod schema for public.release_events. Pure, so the form, the server action
 * and the unit tests share it.
 */
import { z } from 'zod'

export const RELEASE_KINDS = [
  { key: 'set_release', label: 'Set release' },
  { key: 'product_release', label: 'Product release' },
  { key: 'prerelease', label: 'Prerelease' },
  { key: 'preorder_open', label: 'Pre-orders open' },
  { key: 'retailer_date', label: 'Retailer date' },
] as const
export const DATE_PRECISIONS = [
  { key: 'day', label: 'Exact day' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'tbc', label: 'TBC' },
] as const
export const CONFIDENCES = [
  { key: 'official', label: 'Official' },
  { key: 'retailer', label: 'Retailer listing' },
  { key: 'unconfirmed', label: 'Unconfirmed' },
] as const

export interface ProductLine {
  name: string
  type: string | null
  rrp_aud: number | null
}

/**
 * One product per line: "name | type | rrp", e.g.
 * "Prismatic Evolutions Elite Trainer Box | etb | 89.95". Type and RRP are
 * optional; "A$" and "$" are accepted on the price.
 */
export function parseProductLines(text: string): { products: ProductLine[]; errors: string[] } {
  const products: ProductLine[] = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const [name = '', type = '', rrp = ''] = line.split('|').map((s) => s.trim())
    if (name.length < 2) {
      errors.push(`Line ${i + 1}: add a product name.`)
      return
    }
    let price: number | null = null
    if (rrp) {
      const n = Number(rrp.replace(/^A?\$/i, '').replace(/,/g, ''))
      if (!Number.isFinite(n) || n <= 0 || n >= 100000) {
        errors.push(`Line ${i + 1}: “${rrp}” is not a price in dollars.`)
        return
      }
      price = Math.round(n * 100) / 100
    }
    products.push({ name: name.slice(0, 160), type: type ? type.toLowerCase().replace(/\s+/g, '-').slice(0, 40) : null, rrp_aud: price })
  })
  return { products, errors }
}

export function productsToLines(products: { name: string; type: string | null; rrpAud?: number | null; rrp_aud?: number | null }[]): string {
  return products
    .map((p) => {
      const rrp = p.rrpAud ?? p.rrp_aud ?? null
      return [p.name, p.type ?? '', rrp === null ? '' : String(rrp)].join(' | ').replace(/( \| )+$/, '')
    })
    .join('\n')
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null))

export const releaseSchema = z
  .object({
    id: z.uuid().nullable(),
    game: z.enum(['pokemon', 'one-piece']),
    lang: z.enum(['en', 'jp']),
    title: z.string().trim().min(3, 'Title needs at least 3 characters.').max(120),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug: lowercase letters, numbers and single hyphens.').max(120),
    kind: z.enum(['set_release', 'product_release', 'prerelease', 'preorder_open', 'retailer_date']),
    releaseDate: z.iso.date('Use a real date.').nullable(),
    datePrecision: z.enum(['day', 'month', 'quarter', 'tbc']),
    confidence: z.enum(['official', 'retailer', 'unconfirmed']),
    setId: z.uuid().nullable(),
    products: z.array(z.object({ name: z.string(), type: z.string().nullable(), rrp_aud: z.number().nullable() })).max(50),
    retailerSlugs: z.array(z.string().max(40)).max(30),
    summary: nullableText(300),
    bodyMd: nullableText(20000),
    sourceName: nullableText(120),
    sourceUrl: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^https:\/\/\S+$/.test(v), 'Source link must start with https://'),
    published: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.datePrecision !== 'tbc' && !v.releaseDate) ctx.addIssue({ code: 'custom', path: ['releaseDate'], message: 'Add a date, or set the precision to TBC.' })
  })
export type ReleaseInput = z.input<typeof releaseSchema>
