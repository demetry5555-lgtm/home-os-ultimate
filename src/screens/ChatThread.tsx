import { FormEvent, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { listMessages, sendMessage, listThreads, ChatMessage } from '../lib/chat'
import { getMyProfile, listMembers, Profile } from '../lib/db'
import { useT } from '../i18n'

export default function ChatThread() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  async function refresh() {
    setMessages(await listMessages(id!))
  }
  useEffect(() => {
    getMyProfile().then(setMe)
    listMembers().then(setMembers).catch(() => {})
    listThreads().then(ts => {
      const th = ts.find(x => x.id === id)
      setTitle(th ? (th.kind === 'family' ? t('familyRoom') : th.otherName ?? '') : '')
    }).catch(() => {})
    refresh().catch(() => {})
    const timer = setInterval(() => refresh().catch(() => {}), 5000)
    return () => clearInterval(timer)
  }, [id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    const text = body
    setBody('')
    await sendMessage(id!, text)
    await refresh()
  }

  const name = (pid: string) => members.find(m => m.id === pid)?.full_name ?? '—'

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 pb-3 border-b border-gold/10">
        <button onClick={() => navigate('/home/chat')} className="text-muted hover:text-ivory"><span className="back-arrow">←</span></button>
        <h1 className="text-lg font-black gold-text">{title}</h1>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-3">
        {messages.length === 0 && <p className="text-center text-muted text-sm pt-8">{t('noMessages')}</p>}
        {messages.map(m => {
          const own = m.senderId === me?.id
          return (
            <div key={m.id} className={`flex ${own ? 'justify-start flex-row-reverse' : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-3xl px-4 py-2.5 ${
                own
                  ? 'bg-gradient-to-br from-gold-soft to-gold text-obsidian rounded-ts-md'
                  : 'glass !rounded-3xl !rounded-tl-md'
              }`}>
                {!own && <p className="text-[11px] font-bold text-gold-electric mb-0.5">{name(m.senderId)}</p>}
                <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                <p className={`text-[10px] mt-1 ${own ? 'text-obsidian/60' : 'text-muted'}`} dir="ltr">
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2 pt-3 border-t border-gold/10">
        <input value={body} onChange={e => setBody(e.target.value)}
          className="input-glass flex-1" placeholder={t('typeMessage')} />
        <button className="btn-gold !w-auto !px-5" disabled={!body.trim()}>{t('send')}</button>
      </form>
    </div>
  )
}
