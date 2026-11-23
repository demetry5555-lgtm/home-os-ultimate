import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassCard } from '../components/ui'
import { EmptyState, SectionTitle } from '../components/finance'
import { listThreads, openDirectThread, ChatThread } from '../lib/chat'
import { getMyProfile, listMembers, Profile } from '../lib/db'
import { useT } from '../i18n'
import { useNavigate } from 'react-router-dom'

export default function Chat() {
  const { t } = useT()
  const navigate = useNavigate()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [threads, setThreads] = useState<ChatThread[]>([])

  useEffect(() => {
    getMyProfile().then(setMe)
    Promise.all([listThreads(), listMembers()]).then(([ts, ms]) => { setThreads(ts); setMembers(ms) }).catch(() => {})
  }, [])

  const familyRoom = threads.find(t => t.kind === 'family')
  const directThreads = threads.filter(t => t.kind === 'direct')
  const others = me ? members.filter(m => m.id !== me.id && m.status === 'active') : []

  async function openDirect(profileId: string) {
    const id = await openDirectThread(profileId)
    navigate(`/home/chat/${id}`)
  }

  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('chat')}</h1>

      {familyRoom && (
        <Link to={`/home/chat/${familyRoom.id}`}>
          <GlassCard className="!p-4 flex items-center gap-3 hover:border-gold-electric/40 transition border-gold/25">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gold-soft to-gold flex items-center justify-center text-obsidian text-xl font-black">🏠</div>
            <div>
              <p className="font-bold">{t('familyRoom')}</p>
              <p className="text-xs text-muted">{members.length} · {t('members')}</p>
            </div>
          </GlassCard>
        </Link>
      )}

      <div className="space-y-3">
        <SectionTitle>{t('directChats')}</SectionTitle>
        {directThreads.map(th => (
          <Link key={th.id} to={`/home/chat/${th.id}`}>
            <GlassCard className="!p-4 flex items-center gap-3 hover:border-gold-electric/40 transition mb-3">
              <div className="w-10 h-10 rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center text-gold-electric font-black">
                {th.otherName?.charAt(0) ?? '؟'}
              </div>
              <p className="font-bold">{th.otherName}</p>
            </GlassCard>
          </Link>
        ))}
        {others
          .filter(m => !directThreads.some(th => th.otherName === m.full_name))
          .map(m => (
            <button key={m.id} onClick={() => openDirect(m.id)} className="w-full text-start">
              <GlassCard className="!p-4 flex items-center gap-3 border-dashed hover:border-gold-electric/40 transition">
                <div className="w-10 h-10 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center text-muted font-black">
                  {m.full_name.charAt(0)}
                </div>
                <p className="font-semibold text-muted">{m.full_name}</p>
              </GlassCard>
            </button>
          ))}
        {others.length === 0 && <EmptyState text={t('emptyRequests')} />}
      </div>
    </div>
  )
}
