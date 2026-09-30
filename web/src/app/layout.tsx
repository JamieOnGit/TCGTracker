import type { Metadata, Viewport } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { SiteFooter, SiteHeader, TabBar } from '@/components/SiteChrome'
import { organization, website } from '@/lib/seo/jsonld'
import { siteName, siteUrl } from '@/lib/seo/urls'
import { sans, serif } from './fonts'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  applicationName: siteName(),
  formatDetection: { telephone: false },
  other: { 'geo.region': 'AU' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B0D14',
}

// Midnight Holo (dark) is the default; applies a saved light choice before first paint (no flash).
const themeScript = `try{if(localStorage.getItem('theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={`${serif.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <div className="holo-rule" aria-hidden="true" />
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        <TabBar />
        <JsonLd data={[organization(), website()]} />
      </body>
    </html>
  )
}
