'use client'
import { useState, useTransition } from 'react'
import type { ActionResult } from '@/lib/actions/result'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const cls = (v: Variant, small: boolean) =>
  `btn ${v === 'primary' ? 'btn-primary' : v === 'ghost' ? 'btn-ghost' : v === 'danger' ? 'btn-secondary admin-danger' : 'btn-secondary'}${small && v !== 'ghost' ? ' btn-sm' : ''}`

/** Runs a bound server action on click, with an optional confirm and an inline result. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  confirm,
  variant = 'secondary',
  small = true,
  ariaLabel,
}: {
  action: () => Promise<ActionResult>
  label: string
  pendingLabel?: string
  confirm?: string
  variant?: Variant
  small?: boolean
  ariaLabel?: string
}) {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActionResult | null>(null)
  return (
    <span className="admin-action">
      <button
        type="button"
        className={cls(variant, small)}
        disabled={pending}
        aria-label={ariaLabel}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return
          start(async () => setRes(await action()))
        }}
      >
        {pending ? pendingLabel ?? 'Working…' : label}
      </button>
      <ResultNote res={res} />
    </span>
  )
}

export function ResultNote({ res }: { res: ActionResult<unknown> | null }) {
  if (!res) return <span role="status" className="sr-only" />
  if (res.ok) return res.message ? <span role="status" className="admin-ok">{res.message}</span> : <span role="status" className="sr-only">Done</span>
  return <span role="alert" className="field-error">{res.error}</span>
}

/** An accessible on/off switch backed by a server action. */
export function ActionSwitch({ action, checked, label }: { action: (next: boolean) => Promise<ActionResult>; checked: boolean; label: string }) {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActionResult | null>(null)
  return (
    <span className="admin-action">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="admin-switch"
        disabled={pending}
        onClick={() => start(async () => setRes(await action(!checked)))}
      >
        <span aria-hidden="true" />
      </button>
      {res && !res.ok && <span role="alert" className="field-error">{res.error}</span>}
    </span>
  )
}
