'use client'
import { useState, useTransition } from 'react'
import { setProductImage } from '@/lib/actions/admin'
import type { ActionResult } from '@/lib/actions/result'
import { ResultNote } from './ActionButton'

/** Paste an image address for one product; saved as a hand-set image. */
export function ImageFix({ kind, id, name }: { kind: 'card' | 'sealed'; id: string; name: string }) {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActionResult | null>(null)
  const [url, setUrl] = useState('')
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => setRes(await setProductImage({ kind, id, url: url.trim() })))
      }}
    >
      <label className="sr-only" htmlFor={`img-${id}`}>Image address for {name}</label>
      <input id={`img-${id}`} type="url" inputMode="url" className="input" style={{ minWidth: 260, flex: 1 }} placeholder="https://… image address" value={url} onChange={(e) => setUrl(e.target.value)} required />
      <button type="submit" className="btn btn-secondary btn-sm" disabled={pending}>Save</button>
      <ResultNote res={res} />
    </form>
  )
}
