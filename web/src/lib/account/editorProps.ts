import 'server-only'
import type { EditorProps } from '@/components/account/ListingEditor'
import type { Account, CardOption, EditableListing } from './data'
import { audFromCents, parseGradeKey } from './format'

export function editorProps(acct: Account, initial: EditableListing | null, prefillCard: CardOption | null, gradeKey: string | null): EditorProps {
  const g = parseGradeKey(gradeKey)
  return {
    userId: acct.userId,
    initial,
    prefill: {
      card: prefillCard,
      grader: g?.kind === 'graded' ? g.grader : null,
      grade: g?.kind === 'graded' ? g.grade : null,
      raw: g?.kind === 'raw',
    },
    quota: { used: acct.quota.used, limit: acct.quota.limit, resetsAt: acct.quota.resetsAt?.toISOString() ?? null, tier: acct.tier, timeZone: acct.timezone },
    defaults: { locationState: acct.locationState, postcode: acct.postcode },
    rules: { minPhotos: acct.rules.minPhotos, freeQuota: acct.rules.freeQuota, premiumQuota: acct.rules.premiumQuota, premiumPrice: audFromCents(acct.rules.premiumMonthlyCents) },
  }
}
