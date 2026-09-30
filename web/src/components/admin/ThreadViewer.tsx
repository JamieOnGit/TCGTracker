'use client'
import { useState, useTransition } from 'react'
import { readReportedThread, type ThreadMessage } from '@/lib/actions/admin'

/** Opening a reported thread is an audited act: the button says so, and the database logs every read. */
export function ThreadViewer({ conversationId }: { conversationId: string }) {
  const [pending, start] = useTransition()
  const [msgs, setMsgs] = useState<ThreadMessage[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="thread-viewer">
      {!msgs && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await readReportedThread(conversationId)
              if (r.ok) setMsgs(r.data ?? [])
              else setErr(r.error)
            })
          }
        >
          {pending ? 'Opening…' : 'Open conversation (logged)'}
        </button>
      )}
      <p className="muted mt-1 text-xs">Every read is recorded in the audit log with your name.</p>
      {err && <p className="field-error" role="alert">{err}</p>}
      {msgs && (
        <ol className="thread" aria-label="Messages in the reported conversation">
          {msgs.length === 0 && <li className="muted text-sm">No messages.</li>}
          {msgs.map((m) => (
            <li key={m.id}>
              <p className="text-xs muted">
                @{m.sender} · {new Date(m.created_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}
                {m.hasAttachment && ' · attachment'}
              </p>
              <p className="thread-body">{m.body}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
