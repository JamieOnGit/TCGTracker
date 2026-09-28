'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import { attachmentUrl, blockUser, markRead, sendMessage, unblockUser } from '@/lib/actions/messages'
import { ATTACHMENT_MAX_BYTES, checkImageFile, extFor, looksLikeContactDetails, messageTime } from '@/lib/account/format'
import { supabaseBrowser } from '@/lib/supabase/browser'
import type { ThreadMessage } from '@/lib/account/data'
import { prepareImage, uuid, type PreparedImage } from './imageTools'

type Row = { id: number; sender_id: string; body: string; created_at: string; attachment_path: string | null }

function toMsg(r: Row): ThreadMessage {
  return { id: r.id, senderId: r.sender_id, body: r.body, createdAt: r.created_at, attachmentPath: r.attachment_path, attachmentUrl: null }
}

function merge(list: ThreadMessage[], more: ThreadMessage[]): ThreadMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]))
  for (const m of more) {
    const prev = byId.get(m.id)
    byId.set(m.id, prev ? { ...m, attachmentUrl: m.attachmentUrl ?? prev.attachmentUrl } : m)
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
}

export function ThreadClient(props: {
  conversationId: string
  userId: string
  otherId: string
  otherUsername: string
  initial: ThreadMessage[]
  blockedByMe: boolean
  otherLastReadAt: string | null
}) {
  const { conversationId, userId, otherId, otherUsername } = props
  const router = useRouter()
  const [messages, setMessages] = useState<ThreadMessage[]>(props.initial)
  const [live, setLive] = useState(false)
  const [otherRead, setOtherRead] = useState<string | null>(props.otherLastReadAt)
  const [text, setText] = useState('')
  const [file, setFile] = useState<{ img: PreparedImage; preview: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [pending, start] = useTransition()
  const endRef = useRef<HTMLDivElement | null>(null)
  const lastId = useRef<number>(props.initial.at(-1)?.id ?? 0)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const addRows = useCallback(
    (rows: Row[]) => {
      if (rows.length === 0) return
      const incoming = rows.map(toMsg)
      lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id))
      setMessages((list) => merge(list, incoming))
      if (incoming.some((m) => m.senderId !== userId) && document.visibilityState === 'visible') void markRead(conversationId)
      for (const m of incoming) {
        if (m.attachmentPath) {
          void attachmentUrl(m.id).then((url) => url && setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, attachmentUrl: url } : x))))
        }
      }
    },
    [conversationId, userId],
  )

  // Near-real-time: Supabase Realtime (RLS-filtered), with a polling fallback while the socket is down.
  useEffect(() => {
    const sb = supabaseBrowser()
    if (!sb) return
    let cancelled = false
    let isLive = false
    const catchUp = async () => {
      const { data } = await sb
        .from('messages')
        .select('id,sender_id,body,created_at,attachment_path')
        .eq('conversation_id', conversationId)
        .gt('id', lastId.current)
        .order('id', { ascending: true })
        .limit(200)
      if (!cancelled && data) addRows(data as Row[])
    }
    const channel = sb.channel(`conversation:${conversationId}`)
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (p) => addRows([p.new as Row]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversationId}` }, (p) => {
        const c = p.new as { buyer_id: string; buyer_last_read_at: string | null; seller_last_read_at: string | null }
        setOtherRead(c.buyer_id === userId ? c.seller_last_read_at : c.buyer_last_read_at)
      })
    ;(async () => {
      const { data } = await sb.auth.getSession()
      if (data.session) await sb.realtime.setAuth(data.session.access_token)
      if (cancelled) return
      channel.subscribe((status) => {
        isLive = status === 'SUBSCRIBED'
        setLive(isLive)
        if (isLive) void catchUp()
      })
    })()
    const poll = setInterval(() => {
      if (!isLive && document.visibilityState === 'visible') void catchUp()
    }, 8000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void catchUp()
        void markRead(conversationId)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      void sb.removeChannel(channel)
    }
  }, [conversationId, userId, addRows])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  useEffect(() => () => {
    if (file) URL.revokeObjectURL(file.preview)
  }, [file])

  async function pickFile(f: File) {
    setError(null)
    const bad = checkImageFile(f, 40 * 1024 * 1024)
    if (bad) return setError(bad)
    const img = await prepareImage(f)
    if (img.bytes > ATTACHMENT_MAX_BYTES) return setError('That image is over 5 MB. Try a smaller one.')
    setFile({ img, preview: URL.createObjectURL(img.blob) })
  }

  async function send() {
    const body = text.trim() || (file ? 'Sent a photo' : '')
    if (!body) return setError('Write a message.')
    setError(null)
    setSending(true)
    try {
      let attachment: { path: string; bytes: number } | undefined
      if (file) {
        const sb = supabaseBrowser()
        if (!sb) throw new Error('Attachments need the Supabase connection.')
        const path = `${userId}/${conversationId}/${uuid()}.${extFor(file.img.mime)}`
        const up = await sb.storage.from('message-attachments').upload(path, file.img.blob, { contentType: file.img.mime, upsert: false })
        if (up.error) throw new Error('The photo didn’t upload. Check your connection and try again.')
        attachment = { path, bytes: file.img.bytes }
      }
      const res = await sendMessage(conversationId, body, attachment)
      if (!res.ok) throw new Error(res.error)
      const d = res.data!
      lastId.current = Math.max(lastId.current, d.id)
      setMessages((list) => merge(list, [{ id: d.id, senderId: userId, body, createdAt: d.createdAt, attachmentPath: attachment?.path ?? null, attachmentUrl: d.attachmentUrl }]))
      setText('')
      setFile(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message not sent. Try again.')
    } finally {
      setSending(false)
    }
  }

  const toggleBlock = () => {
    if (!props.blockedByMe && !window.confirm(`Block @${otherUsername}? Neither of you will be able to send messages. You can unblock later.`)) return
    start(async () => {
      const res = props.blockedByMe ? await unblockUser(otherId) : await blockUser(otherId)
      setNotice(res.ok ? (res.message ?? null) : res.error)
      router.refresh()
    })
  }

  const lastMine = [...messages].reverse().find((m) => m.senderId === userId)
  const seen = lastMine && otherRead && otherRead >= lastMine.createdAt
  const now = new Date()
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--line)' }}>
        <span className="live-dot" data-on={live} data-testid="live-status">{live ? 'Live' : 'Connecting…'}</span>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <button type="button" className="link-btn" onClick={toggleBlock} disabled={pending}>{props.blockedByMe ? `Unblock @${otherUsername}` : `Block @${otherUsername}`}</button>
          <Link className="prose-link" href={`/report/?conversation=${conversationId}`}>Report</Link>
        </div>
      </div>
      {notice && <p className="form-status mt-3" role="status">{notice}</p>}

      <div className="thread" role="log" aria-live="polite" aria-label={`Conversation with ${otherUsername}`} data-testid="thread">
        {messages.length === 0 && <p className="muted text-sm">No messages yet.</p>}
        {messages.map((m, i) => {
          const day = dayOf(m.createdAt)
          const sep = i === 0 || dayOf(messages[i - 1]!.createdAt) !== day
          const mine = m.senderId === userId
          return (
            <div key={m.id} className="contents">
              {sep && <p className="day-sep">{day}</p>}
              <div className={`msg${mine ? ' me' : ''}`} data-message-id={m.id}>
                <div className={`bubble ${mine ? 'bubble-me' : 'bubble-them'}`}>
                  <span className="sr-only">{mine ? 'You' : otherUsername}: </span>
                  {m.body}
                  {m.attachmentPath && (
                    m.attachmentUrl ? (
                      <a className="att" href={m.attachmentUrl} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL */}
                        <img className="att-img" src={m.attachmentUrl} alt="Attached photo" />
                      </a>
                    ) : <span className="msg-meta block">Loading photo…</span>
                  )}
                </div>
                <span className="msg-meta">
                  {messageTime(m.createdAt, now)}
                  {mine && lastMine?.id === m.id && seen ? ' · Seen' : ''}
                </span>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div className="composer">
        {props.blockedByMe ? (
          <p className="notice">You&apos;ve blocked @{otherUsername}. Unblock them to keep chatting.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <label htmlFor="msg" className="sr-only">Message @{otherUsername}</label>
            <div className="composer-row">
              <button type="button" className="icon-btn" aria-label="Attach a photo" onClick={() => fileInput.current?.click()} disabled={sending} style={{ height: 44, width: 44 }}>
                <Paperclip size={18} />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                tabIndex={-1}
                data-testid="attach-input"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void pickFile(f)
                }}
              />
              <textarea
                id="msg"
                className="textarea"
                rows={1}
                maxLength={4000}
                placeholder="Write a message…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void send()
                  }
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'msg-err msg-hint' : 'msg-hint'}
              />
              <button type="submit" className="btn btn-primary" disabled={sending} aria-label="Send message" style={{ height: 44 }}>
                <Send size={16} aria-hidden="true" />
                <span className="hidden sm:inline">{sending ? 'Sending…' : 'Send'}</span>
              </button>
            </div>
            {file && (
              <span className="attach-chip">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={file.preview} alt="" /> Photo ready ({Math.round(file.img.bytes / 1024)} KB)
                <button type="button" className="icon-btn" aria-label="Remove photo" onClick={() => setFile(null)}><X size={14} /></button>
              </span>
            )}
            {error && <p id="msg-err" className="field-error mt-2" role="alert">{error}</p>}
            <p id="msg-hint" className="hint mt-2 text-xs muted">
              {looksLikeContactDetails(text)
                ? <span style={{ color: 'var(--warn)' }}>Sharing a phone number or email is up to you, but most scams start by moving off-site.</span>
                : 'Photos up to 5 MB. Ctrl/⌘ + Enter to send.'}
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
