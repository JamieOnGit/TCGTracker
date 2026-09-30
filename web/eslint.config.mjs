import next from 'eslint-config-next'
import nextTs from 'eslint-config-next/typescript'

const config = [
  ...next,
  ...nextTs,
  { ignores: ['.next/**', '.next-*/**', '.open-next/**', '.wrangler/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
]

export default config
