import { ImageResponse } from 'next/og'
import { getRepo } from '@/lib/data'
import { isGame, isLang, siteName } from '@/lib/seo/urls'

// Dynamic OG image per card: name, set, language and PSA 10 market cap (brief 7.3).
export const alt = 'Card market cap summary'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })

export default async function Image({ params }: { params: Promise<{ game: string; lang: string; set: string; card: string }> }) {
  const p = await params
  const repo = getRepo()
  const card = isGame(p.game) && isLang(p.lang) ? await repo.getCard(p.game, p.lang, p.set, p.card) : null
  const psa10 = card ? (await repo.cardGrades(card.id)).find((g) => g.gradeKey === 'psa-10') : undefined
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 64, background: '#0e1116', color: '#e8ebef', fontSize: 40 }}>
        <div style={{ display: 'flex', fontSize: 28, opacity: 0.7 }}>{siteName()}</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 72, fontWeight: 700 }}>{card ? card.name : 'Card not found'}</div>
          {card && <div style={{ display: 'flex' }}>{`${card.setName} · ${card.number} · ${card.lang.toUpperCase()}`}</div>}
        </div>
        <div style={{ display: 'flex', gap: 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 24, opacity: 0.7 }}>PSA 10 market cap</span><span>{psa10?.marketCapAud ? aud.format(psa10.marketCapAud) : '—'}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 24, opacity: 0.7 }}>PSA 10 pop</span><span>{psa10?.population ?? '—'}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 24, opacity: 0.7 }}>Floor</span><span>{psa10?.floorAud ? aud.format(psa10.floorAud) : '—'}</span></div>
        </div>
      </div>
    ),
    size,
  )
}
