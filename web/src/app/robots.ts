import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/seo/urls'

/** Allow content; keep crawlers out of account, messaging, admin, write APIs and internal search (brief 7.3). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/account/', '/messages/', '/admin/', '/login/', '/report/', '/search/', '/webhooks/', '/*?*q='],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
