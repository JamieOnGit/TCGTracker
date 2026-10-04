import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

describe('production (Cloudflare) guards', () => {
  it('no route is build-time-only: dynamicParams = false 404s every page on Cloudflare without a page cache', () => {
    const offenders = files(join(__dirname, '../../src/app')).filter((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .some((line) => /^\s*export\s+const\s+dynamicParams\s*=\s*false/.test(line)),
    )
    expect(offenders).toEqual([])
  })
})
