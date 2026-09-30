import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice, LangLabel } from '@/components/account/bits'
import { WishlistConfirm } from '@/components/account/AlertForms'
import { getAccount, getCardOption } from '@/lib/account/data'
import { GRADERS, parseGradeKey } from '@/lib/account/format'
import { one, requireMember, withQuery } from '@/lib/account/gate'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Set an alert' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const COMMON = ['psa-10', 'psa-9', 'bgs-10', 'bgs-9.5', 'cgc-10', 'raw']

export default async function NewAlert({ searchParams }: Props) {
  const sp = await searchParams
  const path = withQuery('/account/alerts/new/', { card: one(sp.card), grade: one(sp.grade) })
  const m = await requireMember(path)
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect(`/login/?next=${encodeURIComponent(path)}`)
  const card = one(sp.card) ? await getCardOption(one(sp.card)!) : null
  const gradeParam = one(sp.grade) ?? null
  const parsed = parseGradeKey(gradeParam)
  const keys = [...new Set([...(parsed && gradeParam ? [gradeParam.toLowerCase()] : []), ...COMMON])]
  const grades = keys.map((k) => {
    const g = parseGradeKey(k)
    return { key: k, label: g?.kind === 'graded' ? `${g.grader} ${g.grade}` : 'Raw (ungraded)' }
  }).filter((g) => g.key === 'raw' || GRADERS.some((x) => g.label.startsWith(x)))

  return (
    <div className="container-x pb-16" style={{ maxWidth: 720 }}>
      <AccountHead eyebrow="Set an alert" title="Notify me when it’s listed" />
      {!card ? (
        <div className="notice notice-warn" role="alert">
          We couldn&apos;t find that card. <Link className="prose-link" href="/cards/">Browse the catalogue</Link> and use <strong>Alert me</strong> on the card page.
        </div>
      ) : (
        <>
          <div className="listing-head mb-6">
            <div className="min-w-0">
              <p className="t">{card.name} <span className="muted">#{card.number}</span></p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs muted">
                <LangLabel lang={card.lang} /> {card.setName} · {card.game === 'one-piece' ? 'One Piece' : 'Pokémon'}
              </p>
            </div>
          </div>
          <WishlistConfirm cardId={card.id} cardLabel={`${card.name} #${card.number} (${card.lang.toUpperCase()})`} initialGrade={parsed ? gradeParam!.toLowerCase() : 'any'} grades={grades} />
          <p className="muted mt-4 text-sm">Alerts go to {acct.email ?? 'your email'} and your notifications. Change how you&apos;re notified in <Link className="prose-link" href="/account/settings/#notifications">settings</Link>.</p>
        </>
      )}
    </div>
  )
}
