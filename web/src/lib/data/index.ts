import 'server-only'
import { cache } from 'react'
import { demoRepository } from './demo'
import { supabaseRepository } from './supabase'
import { supabaseConfigured } from '@/lib/supabase/server'
import type { Repository } from './types'

/** The data source for this request: Supabase when configured, else labelled demo data. */
export const getRepo = cache((): Repository => (supabaseConfigured() ? supabaseRepository() : demoRepository))

export type * from './types'
export { AU_STATES, AU_STATE_NAMES } from './types'
