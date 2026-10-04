import 'server-only'
import { cache } from 'react'
import { demoRepository } from './demo'
import { supabaseRepository } from './supabase'
import { supabaseConfigured, supabaseForRequest, viewerTier, type ViewerTier } from '@/lib/supabase/server'
import type { Repository } from './types'

/** The data source for this request: Supabase when configured, else labelled demo data. */
export const getRepo = cache((): Repository => (supabaseConfigured() ? supabaseRepository() : demoRepository))

/**
 * The data source as this viewer may see it: Premium members read with their own
 * session, so RLS includes drops the moment they happen; everyone else gets the
 * public (delayed) repository. Use for pages whose content depends on the tier.
 */
export async function viewerRepo(): Promise<{ repo: Repository; tier: ViewerTier }> {
  const tier = await viewerTier()
  if (tier === 'premium' && supabaseConfigured()) return { repo: supabaseRepository(await supabaseForRequest()), tier }
  return { repo: getRepo(), tier }
}

export type * from './types'
export { AU_STATES, AU_STATE_NAMES } from './types'
