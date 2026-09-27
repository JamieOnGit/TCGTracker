import type { Metadata, Viewport } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'
import { organization, website } from '@/lib/seo/jsonld'
import { siteName, siteUrl } from '@/lib/seo/urls'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  applicationName: siteName(),
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1116' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>
        <a href="#main" className="sr-only">Skip to content</a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        <JsonLd data={[organization(), website()]} />
      </body>
    </html>
  )
}
