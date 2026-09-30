import type { MetadataRoute } from 'next'

/**
 * Web app manifest (/manifest.webmanifest). Needed for "Add to Home Screen",
 * which iPhone requires before a site may send web push (iOS 16.4+).
 * Colours are the Midnight Holo background; icons live in /public.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TCGTracker',
    short_name: 'TCGTracker',
    description: 'Pokémon and One Piece TCG market cap, marketplace and retail drop alerts for Australia.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0B0D14',
    theme_color: '#0B0D14',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
