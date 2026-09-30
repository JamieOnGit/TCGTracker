'use client'
import { useState, useTransition } from 'react'
import { sendTestAlert } from '@/lib/actions/dropSetup'
import type { ActionResult } from '@/lib/actions/result'

/**
 * "Send me a test alert": an on-site notification from the server and, if
 * this device has push on, a local notification through the service worker
 * (so members see what an alert looks like without waiting for a real drop).
 */
export function TestAlertButton() {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActionResult | null>(null)
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await sendTestAlert()
            setRes(r)
            try {
              if ('serviceWorker' in navigator && 'Notification' in window && Notification.permission === 'granted') {
                const reg = await navigator.serviceWorker.getRegistration('/')
                await reg?.showNotification('Test alert: TCG Trade', {
                  body: 'This is what a restock or member sighting alert looks like.',
                  icon: '/icon-192.png',
                  tag: 'tcgtrade-test',
                  data: { url: '/account/alerts/drops/' },
                })
              }
            } catch {
              // Local notification is a bonus; the on-site one is the test.
            }
          })
        }
      >
        {pending ? 'Sending…' : 'Send me a test alert'}
      </button>
      {res && <span role={res.ok ? 'status' : 'alert'} className={res.ok ? 'text-xs muted' : 'field-error'}>{res.ok ? res.message : res.error}</span>}
    </span>
  )
}
