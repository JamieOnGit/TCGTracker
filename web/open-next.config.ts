import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// Deploys the Next.js app to Cloudflare Workers (same platform family as
// beforeyoufly.com.au, keeping hosting costs low). ISR cache in R2 can be
// added later via incrementalCache.
export default defineCloudflareConfig({})
