/**
 * eBay fallback on the Buy button (owner decision 2026-09-28: ON).
 *
 * When a card has no active listings on TCG Trade, we link to an eBay
 * Australia search for that exact card, language and grade. When the owner
 * enters eBay Partner Network details in the admin console
 * (ebay.affiliate_enabled + ebay.campaign_id), every card's link picks them
 * up automatically — no per-card work.
 *
 * EPN link parameters (eBay Australia):
 *   mkcid=1 (EPN), mkrid=<rotation id, AU 705-53470-19255-0>, campid=<campaign>,
 *   customid=<sub-id, we use "<prefix>-<card id>" to see which cards earn>,
 *   toolid=10001, mkevt=1
 */
export interface EbaySettings {
  enabled: boolean
  site: string // "ebay.com.au"
  affiliateEnabled: boolean
  campaignId: string | null
  customIdPrefix: string | null
  rotationId: string
}

export const DEFAULT_EBAY: EbaySettings = {
  enabled: true,
  site: 'ebay.com.au',
  affiliateEnabled: false,
  campaignId: null,
  customIdPrefix: 'tcgtrade',
  rotationId: '705-53470-19255-0',
}

export interface EbayCardQuery {
  cardId: string
  name: string
  number: string
  setName: string
  lang: 'en' | 'jp'
  game: 'pokemon' | 'one-piece'
  gradeKey: string | null // 'psa-10', 'raw', null = any
}

/** The search phrase: specific enough to find this exact card, language and grade. */
export function ebaySearchQuery(q: EbayCardQuery): string {
  const parts = [q.name, q.number.replace(/^0+(?=\d)/, ''), q.setName]
  if (q.lang === 'jp') parts.push('Japanese')
  if (q.gradeKey && q.gradeKey !== 'raw') parts.push(q.gradeKey.replace('-', ' ').toUpperCase())
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

/** A validated EPN campaign id is 10 digits. Anything else is ignored rather than producing a broken link. */
export function validCampaignId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^\d{10}$/.test(id)
}

export function ebaySearchUrl(q: EbayCardQuery, s: EbaySettings = DEFAULT_EBAY): string | null {
  if (!s.enabled) return null
  const url = new URL(`https://www.${s.site}/sch/i.html`)
  url.searchParams.set('_nkw', ebaySearchQuery(q))
  url.searchParams.set('_sop', '15') // lowest price + postage first
  url.searchParams.set('LH_PrefLoc', '1') // Australia only (locals first)
  if (s.affiliateEnabled && validCampaignId(s.campaignId)) {
    url.searchParams.set('mkcid', '1')
    url.searchParams.set('mkrid', s.rotationId)
    url.searchParams.set('siteid', '15') // eBay Australia
    url.searchParams.set('campid', s.campaignId)
    url.searchParams.set('customid', `${s.customIdPrefix ?? 'tcgtrade'}-${q.cardId}`.slice(0, 256))
    url.searchParams.set('toolid', '10001')
    url.searchParams.set('mkevt', '1')
  }
  return url.toString()
}

export function ebaySettingsFromRows(rows: { key: string; value: unknown }[]): EbaySettings {
  const get = (k: string) => rows.find((r) => r.key === k)?.value
  const s = { ...DEFAULT_EBAY }
  if (typeof get('ebay.enabled') === 'boolean') s.enabled = get('ebay.enabled') as boolean
  if (typeof get('ebay.site') === 'string') s.site = get('ebay.site') as string
  if (typeof get('ebay.affiliate_enabled') === 'boolean') s.affiliateEnabled = get('ebay.affiliate_enabled') as boolean
  const camp = get('ebay.campaign_id')
  if (typeof camp === 'string' || typeof camp === 'number') s.campaignId = String(camp)
  if (typeof get('ebay.custom_id') === 'string') s.customIdPrefix = get('ebay.custom_id') as string
  if (typeof get('ebay.rotation_id') === 'string') s.rotationId = get('ebay.rotation_id') as string
  return s
}
