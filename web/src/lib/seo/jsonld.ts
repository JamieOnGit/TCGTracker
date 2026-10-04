/**
 * Structured data builders (brief 7.3). Each returns a plain object rendered by
 * <JsonLd>. Keep them honest: only mark up what is visible on the page.
 */
import { absoluteUrl, DEFAULT_OG_IMAGE, siteName, siteUrl } from './urls'

/** Structured data needs absolute image URLs; our own images are site-relative. */
const imageUrl = (src: string) => (src.startsWith('/') ? absoluteUrl(src) : src)

type Thing = Record<string, unknown>
const CTX = 'https://schema.org'

export function organization(): Thing {
  return {
    '@context': CTX,
    '@type': 'Organization',
    '@id': `${siteUrl()}/#organization`,
    name: siteName(),
    url: siteUrl() + '/',
    logo: absoluteUrl('/icon-512.png'),
    areaServed: 'AU',
  }
}

export function website(): Thing {
  return {
    '@context': CTX,
    '@type': 'WebSite',
    '@id': `${siteUrl()}/#website`,
    name: siteName(),
    url: siteUrl() + '/',
    inLanguage: 'en-AU',
    publisher: { '@id': `${siteUrl()}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl()}/search/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  }
}

export interface Crumb {
  name: string
  path: string
}

export function breadcrumbs(items: Crumb[]): Thing {
  return {
    '@context': CTX,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  }
}

export function cardProduct(input: {
  name: string
  path: string
  image?: string | null
  cardId: string
  sku: string
  brand: string
  offers: { lowAud: number; highAud: number; count: number } | null
  /** Market values per grade ('PSA 10 value'), as additionalProperty; never as offers (they aren't for sale here). */
  values?: { name: string; aud: number }[]
}): Thing {
  return {
    '@context': CTX,
    '@type': 'Product',
    name: input.name,
    url: absoluteUrl(input.path),
    productID: input.cardId,
    sku: input.sku,
    brand: { '@type': 'Brand', name: input.brand },
    ...(input.image ? { image: imageUrl(input.image) } : {}),
    ...(input.values?.length
      ? { additionalProperty: input.values.map((v) => ({ '@type': 'PropertyValue', name: v.name, value: v.aud.toFixed(2), unitText: 'AUD' })) }
      : {}),
    ...(input.offers && input.offers.count > 0
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'AUD',
            lowPrice: input.offers.lowAud.toFixed(2),
            highPrice: input.offers.highAud.toFixed(2),
            offerCount: input.offers.count,
          },
        }
      : {}),
  }
}

export function listingProduct(input: {
  name: string
  path: string
  priceAud: number
  sold: boolean
  sellerName: string
  image?: string | null
  condition: 'used' | 'new'
}): Thing {
  return {
    '@context': CTX,
    '@type': 'Product',
    name: input.name,
    url: absoluteUrl(input.path),
    ...(input.image ? { image: imageUrl(input.image) } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'AUD',
      price: input.priceAud.toFixed(2),
      availability: input.sold ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      itemCondition: input.condition === 'new' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
      seller: { '@type': 'Person', name: input.sellerName },
      url: absoluteUrl(input.path),
    },
  }
}

export function dataset(input: { name: string; description: string; path: string; dateModified: string; downloadUrl?: string }): Thing {
  return {
    '@context': CTX,
    '@type': 'Dataset',
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path),
    dateModified: input.dateModified,
    creator: { '@id': `${siteUrl()}/#organization` },
    isAccessibleForFree: true,
    measurementTechnique: 'Market price from recent sales (ungraded, Near Mint) and graded population × floor price, in AUD. See /methodology/.',
    spatialCoverage: 'Australia',
    ...(input.downloadUrl
      ? { distribution: [{ '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: absoluteUrl(input.downloadUrl) }] }
      : {}),
  }
}

export function newsArticle(input: { headline: string; path: string; datePublished: string; dateModified: string; image?: string; author?: string }): Thing {
  return {
    '@context': CTX,
    '@type': 'NewsArticle',
    headline: input.headline,
    mainEntityOfPage: absoluteUrl(input.path),
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    image: [input.image ?? absoluteUrl(DEFAULT_OG_IMAGE)],
    author: input.author ? { '@type': 'Person', name: input.author } : { '@id': `${siteUrl()}/#organization` },
    publisher: { '@id': `${siteUrl()}/#organization` },
  }
}

/** Article (evergreen guides): author and publisher are the site organisation. */
export function article(input: { headline: string; description: string; path: string; datePublished: string; dateModified: string }): Thing {
  return {
    '@context': CTX,
    '@type': 'Article',
    headline: input.headline,
    description: input.description,
    mainEntityOfPage: absoluteUrl(input.path),
    url: absoluteUrl(input.path),
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    inLanguage: 'en-AU',
    author: { '@type': 'Organization', '@id': `${siteUrl()}/#organization`, name: siteName(), url: siteUrl() + '/' },
    publisher: { '@type': 'Organization', '@id': `${siteUrl()}/#organization`, name: siteName(), logo: { '@type': 'ImageObject', url: absoluteUrl('/icon-512.png') } },
  }
}

/** FAQPage: only for questions and answers that are visible on the page. */
export function faqPage(faqs: { q: string; a: string }[]): Thing {
  return {
    '@context': CTX,
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }
}

/**
 * Event for a release date in Australia. startDate only when the day is known
 * (a month or quarter isn't a date); past releases stay EventScheduled, which is
 * what schema.org expects for events that went ahead.
 */
export function releaseEvent(input: {
  name: string
  description: string
  path: string
  startDate: string | null
  organizer: string
  image?: string | null
}): Thing {
  return {
    '@context': CTX,
    '@type': 'Event',
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path),
    ...(input.startDate ? { startDate: input.startDate, endDate: input.startDate } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/MixedEventAttendanceMode',
    location: { '@type': 'Place', name: 'Australian retailers', address: { '@type': 'PostalAddress', addressCountry: 'AU' } },
    organizer: { '@type': 'Organization', name: input.organizer },
    ...(input.image ? { image: [imageUrl(input.image)] } : {}),
    inLanguage: 'en-AU',
  }
}

/** ItemList of URLs for hub pages (guides, release calendars). */
export function itemList(items: { name: string; path: string }[]): Thing {
  return {
    '@context': CTX,
    '@type': 'ItemList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: absoluteUrl(it.path) })),
  }
}

/**
 * Product for a sealed product page: AggregateOffer over the stores we watch
 * (prices as shown in the store table), each offer with its own availability.
 */
export function sealedProductLd(input: {
  name: string
  path: string
  brand: string
  category: string
  image?: string | null
  offers: { seller: string; url: string; priceAud: number | null; availability: string }[]
}): Thing {
  const priced = input.offers.filter((o): o is typeof o & { priceAud: number } => o.priceAud !== null)
  const best = (['InStock', 'PreOrder'] as const).find((a) => priced.some((o) => o.availability.endsWith(a)))
  return {
    '@context': CTX,
    '@type': 'Product',
    name: input.name,
    url: absoluteUrl(input.path),
    brand: { '@type': 'Brand', name: input.brand },
    category: input.category,
    ...(input.image ? { image: imageUrl(input.image) } : {}),
    ...(priced.length
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'AUD',
            lowPrice: Math.min(...priced.map((o) => o.priceAud)).toFixed(2),
            highPrice: Math.max(...priced.map((o) => o.priceAud)).toFixed(2),
            offerCount: priced.length,
            availability: `https://schema.org/${best ?? 'OutOfStock'}`,
            offers: priced.map((o) => ({
              '@type': 'Offer',
              priceCurrency: 'AUD',
              price: o.priceAud.toFixed(2),
              availability: o.availability,
              url: o.url,
              seller: { '@type': 'Organization', name: o.seller },
            })),
          },
        }
      : {}),
  }
}
