import { Inter, Newsreader } from 'next/font/google'

// Newsreader speaks (headings, editorial); Inter measures (numbers, tables, UI).
// Normal style, weights 300/400 only (never bold): keeps the serif under ~40KB.
export const serif = Newsreader({ subsets: ['latin'], weight: ['300', '400'], style: ['normal'], variable: '--font-newsreader', display: 'swap' })
// 'optional': if Inter isn't cached within ~100ms the metric-matched system fallback is used, so text never re-flows (keeps LCP fast).
export const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'optional' })
