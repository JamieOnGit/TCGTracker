'use client'
import { useActionState, useId, useState, startTransition } from 'react'
import { saveEbayAffiliate } from '@/lib/actions/admin'
import type { ActionResult } from '@/lib/actions/result'
import { ebaySearchUrl, validCampaignId, type EbayCardQuery, type EbaySettings } from '@/lib/domain/ebay'
import { ResultNote } from './ActionButton'

/** eBay Partner Network settings with a live preview of a real card's link. */
export function EbayPanel({ initial, sample }: { initial: EbaySettings; sample: EbayCardQuery }) {
  const uid = useId()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [affiliate, setAffiliate] = useState(initial.affiliateEnabled)
  const [campaign, setCampaign] = useState(initial.campaignId ?? '')
  const [customId, setCustomId] = useState(initial.customIdPrefix ?? 'tcgtracker')
  const [state, run, pending] = useActionState(async (_p: ActionResult | null, fd: FormData) => saveEbayAffiliate(fd), null)

  const campaignOk = campaign === '' || validCampaignId(campaign)
  const url = ebaySearchUrl(sample, { ...initial, enabled, affiliateEnabled: affiliate, campaignId: campaign || null, customIdPrefix: customId || 'tcgtracker' })
  const tracking = Boolean(url && affiliate && validCampaignId(campaign))

  return (
    <section className="admin-panel" aria-labelledby={`${uid}-h`} id="ebay">
      <h2 id={`${uid}-h`} className="admin-h2">eBay affiliate</h2>
      <p className="muted text-sm">When a card has no TCGTracker listings, its Buy button links to an eBay Australia search for that exact card, language and grade. These details apply to every card link at once.</p>
      <form
        className="admin-form mt-4"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          startTransition(() => run(fd))
        }}
      >
        <label className="check">
          <input type="checkbox" name="ebay_enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Show the eBay fallback link
        </label>
        <label className="check">
          <input type="checkbox" name="affiliate_enabled" checked={affiliate} onChange={(e) => setAffiliate(e.target.checked)} />
          Add affiliate tracking (eBay Partner Network)
        </label>
        <div className="admin-grid-2">
          <div className="field">
            <label htmlFor={`${uid}-c`}>EPN Campaign ID</label>
            <input
              id={`${uid}-c`}
              name="campaign_id"
              className="input num"
              inputMode="numeric"
              pattern="\d{10}"
              maxLength={10}
              value={campaign}
              onChange={(e) => setCampaign(e.target.value.replace(/\D/g, ''))}
              aria-invalid={!campaignOk}
              aria-describedby={`${uid}-ch`}
              placeholder="5338xxxxxx"
            />
            <span id={`${uid}-ch`} className={campaignOk ? 'hint' : 'field-error'}>{campaignOk ? '10 digits.' : 'A Campaign ID is exactly 10 digits.'}</span>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-p`}>Custom ID prefix</label>
            <input id={`${uid}-p`} name="custom_id" className="input" value={customId} maxLength={40} onChange={(e) => setCustomId(e.target.value)} aria-describedby={`${uid}-ph`} />
            <span id={`${uid}-ph`} className="hint">The card id is appended (e.g. {customId || 'tcgtracker'}-&lt;card&gt;) so EPN reports show which cards earn.</span>
          </div>
        </div>

        <div className="ebay-preview" aria-live="polite">
          <p className="eyebrow">Live preview · {sample.name} #{sample.number} ({sample.lang.toUpperCase()}{sample.gradeKey ? `, ${sample.gradeKey.toUpperCase().replace('-', ' ')}` : ''})</p>
          {url ? (
            <>
              <p className="mt-2 text-sm">
                {tracking ? <span className="badge badge-live">Tracking on</span> : <span className="badge badge-lang">No tracking</span>}
              </p>
              <code className="ebay-url" data-testid="ebay-preview">{url}</code>
              <a className="prose-link text-xs" href={url} target="_blank" rel="noopener noreferrer nofollow">Open preview link ↗</a>
            </>
          ) : (
            <p className="muted mt-2 text-sm">The eBay fallback is off: cards with no listings show only “Alert me” and “Sell”.</p>
          )}
        </div>

        <div className="admin-form-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !campaignOk}>{pending ? 'Saving…' : 'Save eBay settings'}</button>
          <ResultNote res={state} />
        </div>
      </form>
      <details className="mt-4 text-sm">
        <summary className="prose-link">How to get a Campaign ID</summary>
        <ol className="admin-steps">
          <li>Sign in (or join) at <a className="prose-link" href="https://partnernetwork.ebay.com.au/" target="_blank" rel="noopener noreferrer">partnernetwork.ebay.com.au</a> with the business eBay account.</li>
          <li>Open <strong>Campaigns</strong> and create one, e.g. “TCGTracker Buy button”.</li>
          <li>Copy its 10-digit <strong>Campaign ID</strong> into the field above, switch tracking on and save.</li>
          <li>Check the preview link opens eBay Australia, then watch clicks arrive in EPN reports (usually within a day).</li>
        </ol>
      </details>
    </section>
  )
}
