import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getFamilyName, getMyProfile, signOut, Profile } from '../lib/db'
import { Logo } from '../components/ui'
import { useT } from '../i18n'
import { isCloud } from '../lib/supabase'
import { unreadCount, NOTIFS_CHANGED } from '../lib/notifications'

export default function Home() {
  const { t } = useT()
  const navigate = useNavigate()
  const [me, setMe] = useState<Profile | null>(null)
  const [family, setFamily] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    getMyProfile().then(setMe)
    getFamilyName().then(setFamily)
    let alive = true
    const poll = () => unreadCount().then(n => { if (alive) setUnread(n) }).catch(() => {})
    poll()
    const timer = setInterval(poll, 15000)
    window.addEventListener(NOTIFS_CHANGED, poll)
    return () => { alive = false; clearInterval(timer); window.removeEventListener(NOTIFS_CHANGED, poll) }
  }, [])

  const link = ({ isActive }: { isActive: boolean }) =>
    `px-2.5 py-2 rounded-xl text-xs font-bold transition ${isActive ? 'bg-gold/15 text-gold-electric' : 'text-muted hover:text-ivory'}`

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-obsidian/70 border-b border-gold/10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Logo />
          <div className="text-end pe-14 flex items-center gap-3">
            <div>
              <p className="text-sm font-bold">{family ?? ''}</p>
              <p className="text-[11px] text-muted">{isCloud ? '' : 'demo'}</p>
            </div>
            <NavLink to="/home/notifications" className="relative text-lg" aria-label={t('notifications')}>
              🔔
              {unread > 0 && (
                <span className="absolute -top-1.5 -end-1.5 min-w-4 h-4 px-1 rounded-full bg-gold-electric text-obsidian text-[10px] font-black flex items-center justify-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </NavLink>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-2xl mx-auto p-4">
        <Outlet />
      </main>
      <nav className="sticky bottom-0 z-10 backdrop-blur-xl bg-obsidian/80 border-t border-gold/10">
        <div className="max-w-2xl mx-auto px-2 py-2 flex gap-1 overflow-x-auto">
          <NavLink to="/home" end className={link}>{t('dashboard')}</NavLink>
          <NavLink to="/home/finance" className={link}>{t('finance')}</NavLink>
          <NavLink to="/home/requests" className={link}>{t('requests')}</NavLink>
          <NavLink to="/home/tasks" className={link}>{t('tasks')}</NavLink>
          <NavLink to="/home/calendar" className={link}>{t('calendar')}</NavLink>
          <NavLink to="/home/apartment" className={link}>{t('apartment')}</NavLink>
          <NavLink to="/home/documents" className={link}>{t('documents')}</NavLink>
          <NavLink to="/home/search" className={link}>{t('search')}</NavLink>
          <NavLink to="/home/chat" className={link}>{t('chat')}</NavLink>
          <NavLink to="/home/invitations" className={link}>{t('invitations')}</NavLink>
          <NavLink to="/home/settings" className={link}>{t('settings')}</NavLink>
          <NavLink to="/home/profile" className={link}>{t('profile')}</NavLink>
          <button onClick={async () => { await signOut(); navigate('/login', { replace: true }) }}
            className="px-4 py-2 rounded-xl text-sm font-bold text-muted hover:text-red-300 transition">
            {t('signOut')}
          </button>
        </div>
      </nav>
    </div>
  )
}
