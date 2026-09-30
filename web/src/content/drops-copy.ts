/**
 * Evergreen copy for the drops pages (/drops/<retailer>/ and /drops/<state>/),
 * so each page has unique, useful text around the live feed. Written by hand;
 * keep claims general and verifiable (no invented restock days or allocations).
 */
export interface PageCopy {
  /** 1–3 short paragraphs shown under the page intro. Plain text. */
  intro: string[]
  /** Rendered as a visible FAQ section and as FAQPage JSON-LD. */
  faqs: { q: string; a: string }[]
}

/** Keyed by retailer slug (jb-hi-fi, kmart, big-w, target-au, eb-games, premium-bandai-au). */
export const RETAILER_COPY: Record<string, PageCopy> = {}

/** Keyed by state code (ACT, NSW, NT, QLD, SA, TAS, VIC, WA). */
export const STATE_COPY: Record<string, PageCopy> = {}
