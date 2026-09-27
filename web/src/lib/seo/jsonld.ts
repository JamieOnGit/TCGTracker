/**
 * Structured data builders (brief 7.3). Each returns a plain object rendered by
 * <JsonLd>. Keep them honest: only mark up what is visible on the page.
 */
import { absoluteUrl, siteName, siteUrl } from './urls'

type Thing = Record<string, unknown>
const CTX = 'https://schema.org'

export function organization(): Thing {
  return {
    '@context': CTX,
    '@type': 'Organization',
    '@id': `${siteUrl()}/#organization`,
    name: siteName(),
    url: siteUrl() + '/',
    logo: absoluteUrl('/icon.png'),
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
}): Thing {
  return {
    '@context': CTX,
    '@type': 'Product',
    name: input.name,
    url: absoluteUrl(input.path),
    productID: input.cardId,
    sku: input.sku,
    brand: { '@type': 'Brand', name: input.brand },
    ...(input.image ? { image: input.image } : {}),
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
    ...(input.image ? { image: input.image } : {}),
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
    measurementTechnique: 'Graded population × floor price, in AUD. See /methodology/.',
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
    ...(input.image ? { image: [input.image] } : {}),
    author: input.author ? { '@type': 'Person', name: input.author } : { '@id': `${siteUrl()}/#organization` },
    publisher: { '@id': `${siteUrl()}/#organization` },
  }
}
