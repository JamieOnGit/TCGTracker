import { Inter, Plus_Jakarta_Sans } from 'next/font/google'

// Plus Jakarta Sans speaks (headings, wordmark, big numbers); Inter measures (body, tables, UI).
// Headings use 600/700 only, normal style: keeps the display face small (one latin subset).
export const display = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['600', '700'], style: ['normal'], variable: '--font-jakarta', display: 'swap' })
// 'optional': if Inter isn't cached within ~100ms the metric-matched system fallback is used, so text never re-flows (keeps LCP fast).
export const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'optional' })
