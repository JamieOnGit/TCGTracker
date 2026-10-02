import { describe, expect, it } from 'vitest'
import { describeDevice, minutesAgo } from '@/lib/auth/device'

describe('describeDevice', () => {
  it('names common browsers and systems', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Chrome on Windows')
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Safari on Mac')
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge on Windows')
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1')).toBe('Chrome on iPhone')
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox on Linux')
  })
  it('falls back when unknown', () => {
    expect(describeDevice(null)).toBe('a web browser')
    expect(describeDevice('curl/8.0')).toBe('a web browser')
  })
})

describe('minutesAgo', () => {
  const now = Date.parse('2026-10-02T12:00:00Z')
  it('rounds to minutes', () => {
    expect(minutesAgo('2026-10-02T11:59:50Z', now)).toBe('just now')
    expect(minutesAgo('2026-10-02T11:59:00Z', now)).toBe('1 minute ago')
    expect(minutesAgo('2026-10-02T11:55:00Z', now)).toBe('5 minutes ago')
  })
})
