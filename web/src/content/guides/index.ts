import { guide as buyAtRrp } from './buy-pokemon-cards-at-rrp-australia'
import { guide as alerts } from './drop-alerts-and-sightings-explained'
import { guide as grading } from './grading-cards-australia'
import { guide as fakes } from './how-to-spot-fake-pokemon-cards'
import { guide as jpVsEn } from './japanese-vs-english-pokemon-cards'
import { guide as onePiece } from './one-piece-card-game-australia'
import { guide as restocks } from './pokemon-restocks-australia-retailers'
import { guide as selling } from './selling-cards-safely-australia'
import type { Guide } from './types'

export type { Guide } from './types'

/** Hub order: buying first (highest search demand), then collecting, selling, alerts. */
export const GUIDES: Guide[] = [buyAtRrp, restocks, onePiece, jpVsEn, fakes, grading, selling, alerts]

export const TOPIC_LABEL: Record<Guide['topic'], string> = {
  buying: 'Buying',
  collecting: 'Collecting',
  selling: 'Selling',
  alerts: 'Alerts',
}

export function getGuide(slug: string): Guide | null {
  return GUIDES.find((g) => g.slug === slug) ?? null
}
