import type { Metadata, Viewport } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { SiteFooter, SiteHeader, TabBar } from '@/components/SiteChrome'
import { organization, website } from '@/lib/seo/jsonld'
import { siteName, siteUrl } from '@/lib/seo/urls'
import { display, sans } from './fonts'
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
  themeColor: '#FFFFFF', // matches the white Daylight header
}

// Daylight (light) is the default for everyone, whatever the OS setting; <html> ships with data-theme="light".
// A saved dark choice is applied before first paint, so there is no flash.
const themeScript = `try{if(localStorage.getItem('theme')==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" data-theme="light" className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        <TabBar />
        <JsonLd data={[organization(), website()]} />
      </body>
    </html>
  )
}
