import * as Sentry from '@sentry/nextjs'

// Error monitoring (brief 11/15). Inert until SENTRY_DSN is set.
export async function register() {
  if (!process.env.SENTRY_DSN) return
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.05, environment: process.env.VERCEL_ENV ?? 'development' })
}

export const onRequestError = Sentry.captureRequestError
