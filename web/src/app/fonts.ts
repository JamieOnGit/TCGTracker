import { Inter, Newsreader } from 'next/font/google'

// Newsreader speaks (headings, editorial); Inter measures (numbers, tables, UI).
export const serif = Newsreader({ subsets: ['latin'], axes: ['opsz'], style: ['normal', 'italic'], variable: '--font-newsreader', display: 'swap' })
export const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
