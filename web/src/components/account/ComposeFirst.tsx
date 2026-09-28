'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { contactSeller } from '@/lib/actions/messages'
import { looksLikeContactDetails } from '@/lib/account/format'

export function ComposeFirst({ listingId, sellerUsername, suggestion }: { listingId: number; sellerUsername: string; suggestion: string }) {
  const router = useRouter()
  const [text, setText] = useState(suggestion)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return setError('Write a message.')
        setError(null)
        start(async () => {
          const res = await contactSeller(listingId, text)
          if (!res.ok) return setError(res.error)
          router.push(`/messages/${res.data!.conversationId}/`)
        })
      }}
    >
      <div className="field">
        <label htmlFor="first">Message to @{sellerUsername}</label>
        <textarea id="first" className="textarea" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'first-err first-hint' : 'first-hint'} />
        <p id="first-hint" className="hint">
          {looksLikeContactDetails(text) ? <span style={{ color: 'var(--warn)' }}>Keep contact on-site until you trust the seller. Your email and phone are hidden by default.</span> : 'Ask about condition, postage or a combined deal. Your email stays hidden.'}
        </p>
        {error && <p id="first-err" className="field-error" role="alert">{error}</p>}
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Sending…' : 'Send message'}</button>
      </div>
    </form>
  )
}
