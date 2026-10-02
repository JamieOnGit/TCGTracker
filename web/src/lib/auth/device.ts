/** "Chrome on Windows", from a User-Agent header. Best effort, for a human to recognise their own device. */
export function describeDevice(ua: string | null | undefined): string {
  const s = ua ?? ''
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /Firefox\//.test(s)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(s)
          ? 'Chrome'
          : /Safari\//.test(s)
            ? 'Safari'
            : null
  const os = /iPhone/.test(s)
    ? 'iPhone'
    : /iPad/.test(s)
      ? 'iPad'
      : /Android/.test(s)
        ? 'Android'
        : /Windows/.test(s)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(s)
            ? 'Mac'
            : /CrOS/.test(s)
              ? 'Chromebook'
              : /Linux/.test(s)
                ? 'Linux'
                : null
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? 'a web browser'
}

/** "just now", "3 minutes ago" */
export function minutesAgo(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (m < 1) return 'just now'
  return m === 1 ? '1 minute ago' : `${m} minutes ago`
}
