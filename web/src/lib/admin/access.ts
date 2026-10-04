/**
 * Which admin sections each staff role may use (brief 10: admin → all,
 * moderator → listings, reports and member sightings (plus suspending users), editor → news and the release calendar).
 * Pure so the nav, the layout gate and the unit tests share one table.
 * RLS still decides what each role can actually read or write.
 */
export type StaffRole = 'admin' | 'moderator' | 'editor'
export type Role = StaffRole | 'user'

export type SectionKey =
  | 'overview'
  | 'listings'
  | 'reports'
  | 'users'
  | 'mapping'
  | 'drops'
  | 'settings'
  | 'emails'
  | 'audit'
  | 'subscriptions'
  | 'news'
  | 'sightings'
  | 'releases'
  | 'images'

export interface Section {
  key: SectionKey
  label: string
  href: string
  roles: StaffRole[]
}

export const SECTIONS: Section[] = [
  { key: 'overview', label: 'Overview', href: '/admin/', roles: ['admin', 'moderator', 'editor'] },
  { key: 'listings', label: 'Listings', href: '/admin/listings/', roles: ['admin', 'moderator'] },
  { key: 'reports', label: 'Reports', href: '/admin/reports/', roles: ['admin', 'moderator'] },
  { key: 'users', label: 'Users', href: '/admin/users/', roles: ['admin', 'moderator'] },
  { key: 'sightings', label: 'Sightings', href: '/admin/sightings/', roles: ['admin', 'moderator'] },
  { key: 'mapping', label: 'Card mapping', href: '/admin/mapping/', roles: ['admin'] },
  { key: 'images', label: 'Images', href: '/admin/images/', roles: ['admin'] },
  { key: 'drops', label: 'Drops', href: '/admin/drops/', roles: ['admin'] },
  { key: 'emails', label: 'Emails', href: '/admin/emails/', roles: ['admin'] },
  { key: 'subscriptions', label: 'Subscriptions', href: '/admin/subscriptions/', roles: ['admin'] },
  { key: 'settings', label: 'Settings', href: '/admin/settings/', roles: ['admin'] },
  { key: 'audit', label: 'Audit log', href: '/admin/audit/', roles: ['admin'] },
  { key: 'news', label: 'News', href: '/admin/news/', roles: ['admin', 'editor'] },
  { key: 'releases', label: 'Releases', href: '/admin/releases/', roles: ['admin', 'editor'] },
]

export function isStaff(role: string | null | undefined): role is StaffRole {
  return role === 'admin' || role === 'moderator' || role === 'editor'
}

export function canAccess(role: string | null | undefined, key: SectionKey): boolean {
  if (!isStaff(role)) return false
  return SECTIONS.find((s) => s.key === key)?.roles.includes(role) ?? false
}

export function sectionsFor(role: string | null | undefined): Section[] {
  return isStaff(role) ? SECTIONS.filter((s) => s.roles.includes(role)) : []
}

/** Finer-grained permissions inside a section (mirrors guard_profile_private). */
export const can = {
  changeRole: (role: Role) => role === 'admin',
  overrideTierOrQuota: (role: Role) => role === 'admin',
  suspendOrBan: (role: Role) => role === 'admin' || role === 'moderator',
  reassignCard: (role: Role) => role === 'admin' || role === 'moderator',
}
