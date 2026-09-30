import { describe, expect, it } from 'vitest'
import { can, canAccess, sectionsFor } from '@/lib/admin/access'

describe('admin section access', () => {
  it('admins see every section', () => {
    expect(sectionsFor('admin').map((s) => s.key)).toContain('settings')
    expect(sectionsFor('admin')).toHaveLength(13)
  })
  it('moderators get listings, reports, users and sightings only (plus the overview)', () => {
    expect(sectionsFor('moderator').map((s) => s.key)).toEqual(['overview', 'listings', 'reports', 'users', 'sightings'])
    expect(canAccess('moderator', 'settings')).toBe(false)
    expect(canAccess('moderator', 'mapping')).toBe(false)
  })
  it('editors get news and releases only (plus the overview)', () => {
    expect(sectionsFor('editor').map((s) => s.key)).toEqual(['overview', 'news', 'releases'])
    expect(canAccess('editor', 'listings')).toBe(false)
  })
  it('members and anonymous visitors get nothing', () => {
    expect(sectionsFor('user')).toEqual([])
    expect(sectionsFor(null)).toEqual([])
    expect(canAccess('user', 'overview')).toBe(false)
  })
  it('only admins change roles, tiers and quotas; moderators may suspend', () => {
    expect(can.changeRole('moderator')).toBe(false)
    expect(can.overrideTierOrQuota('moderator')).toBe(false)
    expect(can.suspendOrBan('moderator')).toBe(true)
    expect(can.changeRole('admin')).toBe(true)
  })
})
