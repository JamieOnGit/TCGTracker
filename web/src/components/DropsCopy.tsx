import type { PageCopy } from '@/content/drops-copy'
import { faqPage } from '@/lib/seo/jsonld'
import { JsonLd } from './JsonLd'

/** Evergreen intro paragraphs for a drops page (from content/drops-copy.ts). */
export function CopyIntro({ copy }: { copy: PageCopy | undefined }) {
  if (!copy || copy.intro.length === 0) return null
  return (
    <div className="prose mt-6 max-w-[var(--measure)]">
      {copy.intro.map((p) => <p key={p}>{p}</p>)}
    </div>
  )
}

/** Visible FAQ + matching FAQPage JSON-LD (only what is on the page is marked up). */
export function Faq({ faqs, title = 'Questions' }: { faqs: PageCopy['faqs'] | undefined; title?: string }) {
  if (!faqs || faqs.length === 0) return null
  return (
    <section className="section" aria-labelledby="faq-h">
      <h2 id="faq-h">{title}</h2>
      <div className="mt-6">
        {faqs.map(({ q, a }) => (
          <details key={q} className="border-b py-4" style={{ borderColor: 'var(--line)' }}>
            <summary className="cursor-pointer text-base">{q}</summary>
            <p className="muted mt-3 max-w-[var(--measure)] text-sm">{a}</p>
          </details>
        ))}
      </div>
      <JsonLd data={faqPage(faqs)} />
    </section>
  )
}
