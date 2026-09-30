'use client'
import { startTransition, useActionState, useEffect, useRef } from 'react'
import type { ActionResult } from '@/lib/actions/result'
import { ResultNote } from './ActionButton'

/**
 * A form posting to a (bound) server action that takes FormData and returns an
 * ActionResult. Shows the result inline and can reset itself on success.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant = 'secondary',
  className,
  reset = false,
  confirm,
  ariaLabel,
}: {
  action: (form: FormData) => Promise<ActionResult>
  children?: React.ReactNode
  submitLabel: string
  submitVariant?: 'primary' | 'secondary' | 'danger'
  className?: string
  reset?: boolean
  confirm?: string
  ariaLabel?: string
}) {
  const ref = useRef<HTMLFormElement>(null)
  const [state, run, pending] = useActionState(async (_prev: ActionResult | null, fd: FormData) => action(fd), null)
  useEffect(() => {
    if (reset && state?.ok) ref.current?.reset()
  }, [state, reset])
  return (
    <form
      ref={ref}
      className={className ?? 'admin-form'}
      aria-label={ariaLabel}
      onSubmit={(e) => {
        // Submitted by hand (not via the action prop) so React does not reset
        // the fields when validation fails.
        e.preventDefault()
        if (confirm && !window.confirm(confirm)) return
        const fd = new FormData(e.currentTarget)
        startTransition(() => run(fd))
      }}
    >
      {children}
      <div className="admin-form-actions">
        <button type="submit" className={`btn btn-sm ${submitVariant === 'primary' ? 'btn-primary' : submitVariant === 'danger' ? 'btn-secondary admin-danger' : 'btn-secondary'}`} disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        <ResultNote res={state} />
      </div>
    </form>
  )
}
