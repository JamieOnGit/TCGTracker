import { describe, expect, it } from 'vitest'
import { supabaseKeyHeaders } from '@/lib/supabase/headers'

describe('supabaseKeyHeaders', () => {
  it('sends new publishable/secret keys on apikey only', () => {
    expect(supabaseKeyHeaders('sb_publishable_abc')).toEqual({ apikey: 'sb_publishable_abc' })
    expect(supabaseKeyHeaders('sb_secret_xyz')).toEqual({ apikey: 'sb_secret_xyz' })
  })

  it('keeps the Bearer copy for legacy JWT keys', () => {
    expect(supabaseKeyHeaders('eyJhbGciOi.x.y')).toEqual({ apikey: 'eyJhbGciOi.x.y', Authorization: 'Bearer eyJhbGciOi.x.y' })
  })
})
