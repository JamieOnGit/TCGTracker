/**
 * Grade keys across grading companies: 'psa-10', 'psa-9', 'bgs-9.5',
 * 'cgc-10', 'sgc-10' (from public.grade_key in SQL), plus 'raw' for the
 * ungraded card. Raw (Near Mint, from recent sales) is the main market price;
 * PSA is the population grade; BGS, CGC and SGC values are shown on card
 * pages for comparison. Client-safe.
 */
export const GRADERS = ['psa', 'bgs', 'cgc', 'sgc'] as const
export type Grader = (typeof GRADERS)[number]

export const GRADER_NAMES: Record<Grader, string> = { psa: 'PSA', bgs: 'BGS (Beckett)', cgc: 'CGC', sgc: 'SGC' }

/** The PSA grades every card page offers, whether or not there's data yet. */
export const PSA_GRADES = ['psa-10', 'psa-9', 'psa-8'] as const

const KEY = /^(psa|bgs|cgc|sgc)-(10|[1-9](?:\.5)?)$/

export function isGradeKey(key: unknown): key is string {
  return typeof key === 'string' && KEY.test(key)
}

/** A price view a card page can show: 'raw' (the ungraded card, the main market price) or a grade. */
export function isPriceKey(key: unknown): key is string {
  return key === 'raw' || isGradeKey(key)
}

export function graderOf(key: string): Grader | null {
  const m = KEY.exec(key)
  return m ? (m[1] as Grader) : null
}

const gradeNumber = (key: string) => Number(KEY.exec(key)?.[2] ?? 0)

/** Raw first, then PSA, BGS, CGC, SGC; highest grade first within each; anything else last. */
export function sortGradeKeys(keys: readonly string[]): string[] {
  const rank = (k: string) => {
    if (k === 'raw') return -1
    const g = graderOf(k)
    return g ? GRADERS.indexOf(g) : GRADERS.length
  }
  return [...new Set(keys)].sort((a, b) => rank(a) - rank(b) || gradeNumber(b) - gradeNumber(a) || a.localeCompare(b))
}

/** Price tabs for a card page: raw (the market price), the PSA grades, plus every other company's grade that has data. */
export function gradeOptions(available: readonly string[]): string[] {
  return sortGradeKeys(['raw', ...PSA_GRADES, ...available.filter(isGradeKey)])
}

/** 'psa-10' → 'PSA 10', 'bgs-9.5' → 'BGS 9.5', 'any-9' → 'Grade 9 (any grader)', 'raw' → 'Raw'. */
export function gradeLabel(key: string): string {
  if (key === 'raw') return 'Raw'
  if (key === 'all') return 'All grades'
  const any = /^any-(.+)$/.exec(key)
  if (any) return `Grade ${any[1]} (any grader)`
  return key.toUpperCase().replace('-', ' ')
}
