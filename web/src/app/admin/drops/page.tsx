import { ActionButton, ActionSwitch } from '@/components/admin/ActionButton'
import { ActionForm } from '@/components/admin/ActionForm'
import { AdminHeader, HealthDot } from '@/components/admin/bits'
import { fmtAud2 } from '@/components/Format'
import { addRrpForm, addWatchForm, deleteRrp, deleteWatch, sendManualAlert, setRetailerEnabled, setRetailerIntervals, setWatchEnabled } from '@/lib/actions/admin'
import { dropsData, retailers, settingValues } from '@/lib/admin/data'
import { fmtAgo, retailerHealth } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Drops' }

const EVENT_TYPES = ['IN_STOCK', 'PREORDER_OPEN', 'NEW_LISTING', 'PRICE_CHANGE', 'QUEUE_LIVE']
const WATCH_KINDS: [string, string][] = [['include_keyword', 'Include keyword'], ['exclude_keyword', 'Exclude keyword'], ['set_code', 'Set code'], ['sku', 'Priority SKU'], ['url', 'Priority URL']]
const RRP_LABEL: Record<string, string> = { AT_RRP: 'At RRP', BELOW_RRP: 'Below RRP', ABOVE_RRP: 'Above RRP', UNKNOWN: '—' }

export default async function AdminDrops() {
  const { sb } = await requireSection('drops')
  const [rets, d, settings] = await Promise.all([retailers(sb), dropsData(sb), settingValues(sb, ['drops.zero_product_alert_cycles'])])
  const threshold = typeof settings['drops.zero_product_alert_cycles'] === 'number' ? (settings['drops.zero_product_alert_cycles'] as number) : 5
  const stat = (ch: string, st: string) => d.stats.find((s) => s.channel === ch && s.status === st)?.n ?? 0

  return (
    <>
      <AdminHeader title="Drops" lead="Retailer adapters, alert delivery, the RRP table and the watchlist. Only switch a retailer on after its terms review is signed off." />

      <section className="admin-section" aria-labelledby="ret-h">
        <h2 id="ret-h" className="admin-h2">Retailers</h2>
        <div className="table-wrap mt-3">
          <table className="dt">
            <caption className="sr-only">Retailer adapters and their health</caption>
            <thead>
              <tr>
                <th scope="col">Retailer</th><th scope="col">Health</th><th scope="col">Enabled</th><th scope="col">Intervals (s)</th>
                <th scope="col">Last success</th><th scope="col">Last error</th><th scope="col" className="n">Errors</th><th scope="col" className="n">Empty cycles</th>
              </tr>
            </thead>
            <tbody>
              {rets.map((r) => (
                <tr key={r.id} data-retailer={r.slug}>
                  <th scope="row" className="nowrap">
                    <span className="font-medium">{r.name}</span>
                    <p className="muted text-xs">{r.adapter}</p>
                  </th>
                  <td><HealthDot health={retailerHealth(r, threshold)} /></td>
                  <td><ActionSwitch action={setRetailerEnabled.bind(null, r.slug)} checked={r.enabled} label={`${r.name} enabled`} /></td>
                  <td>
                    <ActionForm action={setRetailerIntervals.bind(null, r.slug)} submitLabel="Save" className="admin-inline" ariaLabel={`${r.name} polling intervals`}>
                      <label className="sr-only" htmlFor={`w-${r.slug}`}>Watch interval seconds</label>
                      <input id={`w-${r.slug}`} name="watch" type="number" min={30} className="input input-sm" defaultValue={r.watch_interval_seconds} title="Watchlist interval (s)" />
                      <label className="sr-only" htmlFor={`d-${r.slug}`}>Discovery interval seconds</label>
                      <input id={`d-${r.slug}`} name="discovery" type="number" min={300} className="input input-sm" defaultValue={r.discovery_interval_seconds} title="Discovery interval (s)" />
                    </ActionForm>
                  </td>
                  <td className="nowrap">{fmtAgo(r.last_success_at)}</td>
                  <td>{r.last_error ? <><span className="muted text-xs">{fmtAgo(r.last_error_at)}</span><p className="err-text">{r.last_error.slice(0, 160)}</p></> : <span className="muted">—</span>}</td>
                  <td className="n">{r.consecutive_errors}</td>
                  <td className="n">{r.zero_product_cycles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="provenance">Health: failing after 3 consecutive errors or no success for 10 watch intervals; degraded on any error or {threshold}+ empty cycles.</p>
      </section>

      <section className="admin-section" aria-labelledby="del-h">
        <h2 id="del-h" className="admin-h2">Alert delivery, last 24 hours</h2>
        <div className="table-wrap mt-3">
          <table className="dt" style={{ maxWidth: 560 }}>
            <caption className="sr-only">Drop alert deliveries by channel and status</caption>
            <thead><tr><th scope="col">Channel</th><th scope="col" className="n">Queued</th><th scope="col" className="n">Sent</th><th scope="col" className="n">Failed</th></tr></thead>
            <tbody>
              {['email', 'onsite', 'discord'].map((ch) => (
                <tr key={ch}>
                  <th scope="row">{ch === 'onsite' ? 'On-site' : ch[0]!.toUpperCase() + ch.slice(1)}</th>
                  <td className="n">{stat(ch, 'queued')}</td>
                  <td className="n">{stat(ch, 'sent')}</td>
                  <td className={`n${stat(ch, 'failed') ? ' admin-warn-text' : ''}`}>{stat(ch, 'failed')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section" aria-labelledby="ev-h">
        <h2 id="ev-h" className="admin-h2">Recent drop events</h2>
        {d.events.length === 0 ? <p className="muted mt-2 text-sm">No drop events yet.</p> : (
          <div className="table-wrap mt-3">
            <table className="dt">
              <caption className="sr-only">The 30 most recent drop events</caption>
              <thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">Product</th><th scope="col" className="n">Price</th><th scope="col">RRP</th><th scope="col">Public</th><th scope="col">Flags</th></tr></thead>
              <tbody>
                {d.events.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{fmtAgo(e.occurred_at)}</td>
                    <td className="nowrap">{e.event_type.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="wrap">{e.product?.title ?? '—'} <span className="muted text-xs">{e.product?.retailer?.name}</span></td>
                    <td className="n">{fmtAud2(e.price_aud)}</td>
                    <td className="nowrap">{RRP_LABEL[e.rrp_tag] ?? e.rrp_tag}{e.rrp_delta_pct !== null && e.rrp_tag !== 'AT_RRP' ? ` (${Number(e.rrp_delta_pct) > 0 ? '+' : ''}${Number(e.rrp_delta_pct).toFixed(0)}%)` : ''}</td>
                    <td className="nowrap">{fmtAgo(e.public_at)}</td>
                    <td className="nowrap">
                      {e.suppressed && <span className="badge badge-warn" title={e.suppressed_reason ?? ''}>Suppressed</span>}
                      {e.manual && <span className="badge badge-lang ml-1">Manual</span>}
                      {!e.suppressed && !e.manual && <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-section admin-panel" aria-labelledby="man-h">
        <h2 id="man-h" className="admin-h2">Send an alert manually</h2>
        <p className="muted text-sm">Creates a drop event (marked manual) for an existing retail product. Premium members get it now; Free members after their delay.</p>
        {d.products.length === 0 ? (
          <p className="notice mt-4">No retail products yet. The drop monitors add them as they discover listings.</p>
        ) : (
          <ActionForm action={sendManualAlert} submitLabel="Send alert" submitVariant="primary" confirm="Send this alert to members now?" reset>
            <div className="admin-grid-3">
              <div className="field">
                <label htmlFor="mp">Retail product</label>
                <select id="mp" name="product_id" className="select" required>
                  {d.products.map((p) => <option key={p.id} value={p.id}>{p.retailer?.name}: {p.title}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="me">Event</label>
                <select id="me" name="event_type" className="select">
                  {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="mpr">Price (A$, optional)</label>
                <input id="mpr" name="price" className="input" inputMode="decimal" placeholder="e.g. 89.00" />
              </div>
            </div>
          </ActionForm>
        )}
      </section>

      <section className="admin-section" aria-labelledby="rrp-h">
        <h2 id="rrp-h" className="admin-h2">RRP reference</h2>
        <p className="muted text-sm">Alerts are tagged at, below or above RRP from this table. A row with no set code is the default for that product type.</p>
        <ActionForm action={addRrpForm} submitLabel="Add RRP" className="admin-inline mt-3" reset ariaLabel="Add an RRP">
          <div className="field">
            <label htmlFor="rg">Game</label>
            <select id="rg" name="game" className="select"><option value="pokemon">Pokémon</option><option value="one-piece">One Piece</option></select>
          </div>
          <div className="field">
            <label htmlFor="rt">Product type</label>
            <input id="rt" name="product_type" className="input" required minLength={2} maxLength={40} placeholder="booster-box" />
          </div>
          <div className="field">
            <label htmlFor="rs">Set code</label>
            <input id="rs" name="set_code" className="input" maxLength={12} placeholder="optional" />
          </div>
          <div className="field">
            <label htmlFor="ra">RRP (A$)</label>
            <input id="ra" name="rrp_aud" className="input" inputMode="decimal" required />
          </div>
        </ActionForm>
        {d.rrp.length > 0 && (
          <div className="table-wrap mt-4">
            <table className="dt">
              <caption className="sr-only">RRP reference table</caption>
              <thead><tr><th scope="col">Game</th><th scope="col">Product type</th><th scope="col">Set</th><th scope="col" className="n">RRP</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {d.rrp.map((r) => (
                  <tr key={r.id}>
                    <td>{r.game}</td><td>{r.product_type}</td><td>{r.set_code ?? <span className="muted">default</span>}</td>
                    <td className="n">{fmtAud2(Number(r.rrp_aud))}</td>
                    <td><ActionButton action={deleteRrp.bind(null, r.id)} label="Delete" variant="ghost" confirm="Delete this RRP row?" ariaLabel={`Delete RRP ${r.product_type} ${r.set_code ?? ''}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-section" aria-labelledby="w-h">
        <h2 id="w-h" className="admin-h2">Watchlist</h2>
        <p className="muted text-sm">What the monitors treat as TCG: include and exclude keywords, set codes, and priority SKUs or URLs polled on the fast interval.</p>
        <ActionForm action={addWatchForm} submitLabel="Add" className="admin-inline mt-3" reset ariaLabel="Add a watchlist entry">
          <div className="field">
            <label htmlFor="wk">Type</label>
            <select id="wk" name="kind" className="select">{WATCH_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div className="field" style={{ flex: '2 1 220px' }}>
            <label htmlFor="wv">Value</label>
            <input id="wv" name="value" className="input" required maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="wg">Game</label>
            <select id="wg" name="game" className="select"><option value="">Any</option><option value="pokemon">Pokémon</option><option value="one-piece">One Piece</option></select>
          </div>
        </ActionForm>
        <div className="table-wrap mt-4">
          <table className="dt">
            <caption className="sr-only">Watchlist entries</caption>
            <thead><tr><th scope="col">Type</th><th scope="col">Value</th><th scope="col">Game</th><th scope="col">On</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {d.watch.map((w) => (
                <tr key={w.id}>
                  <td className="nowrap">{WATCH_KINDS.find(([k]) => k === w.kind)?.[1] ?? w.kind}</td>
                  <td className="wrap">{w.value}{w.retailer && <span className="muted text-xs"> · {w.retailer.name}</span>}</td>
                  <td>{w.game ?? <span className="muted">any</span>}</td>
                  <td><ActionSwitch action={setWatchEnabled.bind(null, w.id)} checked={w.enabled} label={`Watch ${w.value}`} /></td>
                  <td><ActionButton action={deleteWatch.bind(null, w.id)} label="Delete" variant="ghost" confirm={`Delete “${w.value}”?`} ariaLabel={`Delete ${w.value}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
