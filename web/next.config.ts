import type { NextConfig } from 'next'

// One URL convention: trailing slash (brief 7.1). Next's automatic redirect
// would be a 308; src/proxy.ts issues the 301 the brief asks for instead.
const nextConfig: NextConfig = {
  // Pin the workspace root to this app (the repo root has no lockfile).
  turbopack: { root: import.meta.dirname },
  outputFileTracingRoot: import.meta.dirname,
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' }],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
