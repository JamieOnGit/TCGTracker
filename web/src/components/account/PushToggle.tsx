'use client'
import { useEffect, useState } from 'react'
import { deletePushSubscription, savePushSubscription } from '@/lib/actions/push'
import { needsHomeScreen, urlBase64ToUint8Array } from '@/lib/account/push'

type Status = 'checking' | 'no-key' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'

/** Register /sw.js (tiny: push + notificationclick only, no caching). */
export async function pushRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  return existing ?? navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
}

/**
 * Turns web push on or off for this browser. Subscriptions are stored per
 * device (push_subscriptions); the workers send with the VAPID private key.
 */
export function PushToggle({ vapidKey }: { vapidKey: string | null }) {
  const [status, setStatus] = useState<Status>(vapidKey ? 'checking' : 'no-key')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!vapidKey) return
    let active = true
    const check = async (): Promise<Status> => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
      if (needsHomeScreen(navigator.userAgent, standalone)) return 'ios-install'
      if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) return 'unsupported'
      if (Notification.permission === 'denied') return 'denied'
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      return sub ? 'on' : 'off'
    }
    check()
      .then((s) => active && setStatus(s))
      .catch(() => active && setStatus('unsupported'))
    return () => {
      active = false
    }
  }, [vapidKey])

  async function turnOn() {
    if (!vapidKey) return
    setBusy(true)
    setMsg(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await pushRegistration()
      await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }))
      const json = sub.toJSON()
      const res = await savePushSubscription({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '', userAgent: navigator.userAgent.slice(0, 300) })
      if (!res.ok) {
        await sub.unsubscribe()
        setMsg({ ok: false, text: res.error })
        return
      }
      setStatus('on')
      setMsg({ ok: true, text: res.message ?? 'Push alerts are on.' })
    } catch {
      setMsg({ ok: false, text: 'This browser couldn’t turn on push alerts. Try again, or use email and on-site alerts.' })
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    setMsg(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await deletePushSubscription(sub.endpoint)
        await sub.unsubscribe()
      }
      setStatus('off')
      setMsg({ ok: true, text: 'Push alerts are off for this device.' })
    } catch {
      setMsg({ ok: false, text: 'Couldn’t turn push off. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="notice" data-testid="push-toggle" data-status={status}>
      <p><strong>Push on this device</strong></p>
      {status === 'no-key' && (
        <>
          <p className="muted mt-1">Push alerts are being set up. Email and on-site alerts work now.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-3" disabled>Turn on push alerts</button>
        </>
      )}
      {status === 'checking' && <p className="muted mt-1">Checking this browser…</p>}
      {status === 'unsupported' && <p className="muted mt-1">This browser doesn&apos;t support push notifications. Use email or on-site alerts, or try Chrome, Edge, Firefox or Safari.</p>}
      {status === 'ios-install' && (
        <p className="muted mt-1">
          On iPhone and iPad (iOS 16.4 or later), push only works from the Home Screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, open TCG Trade from the new icon, sign in and come back here.
        </p>
      )}
      {status === 'denied' && <p className="muted mt-1">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload this page.</p>}
      {status === 'off' && (
        <>
          <p className="muted mt-1">Get a phone or desktop notification the moment an alert fires — no app needed.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={turnOn} disabled={busy}>{busy ? 'Turning on…' : 'Turn on push alerts'}</button>
        </>
      )}
      {status === 'on' && (
        <>
          <p className="muted mt-1">Push alerts are on for this device.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={turnOff} disabled={busy}>{busy ? 'Turning off…' : 'Turn off on this device'}</button>
        </>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'muted' : 'field-error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </div>
  )
}
