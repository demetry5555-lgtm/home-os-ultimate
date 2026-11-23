import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getFamilyName, getMyProfile, signOut, Profile } from '../lib/db'
import { Logo } from '../components/ui'
import { useT, Key } from '../i18n'
import { isCloud } from '../lib/supabase'
import { unreadCount, NOTIFS_CHANGED } from '../lib/notifications'

const NAV: { to: string; key: Key; end?: boolean }[] = [
  { to: '/home', key: 'dashboard', end: true },
  { to: '/home/finance', key: 'finance' },
  { to: '/home/requests', key: 'requests' },
  { to: '/home/tasks', key: 'tasks' },
  { to: '/home/calendar', key: 'calendar' },
  { to: '/home/apartment', key: 'apartment' },
  { to: '/home/documents', key: 'documents' },
  { to: '/home/chat', key: 'chat' },
  { to: '/home/search', key: 'search' },
  { to: '/home/invitations', key: 'invitations' },
  { to: '/home/settings', key: 'settings' },
  { to: '/home/profile', key: 'profile' },
]

export default function Home() {
  const { t, lang, setLang } = useT()
  const navigate = useNavigate()
  const [me, setMe] = useState<Profile | null>(null)
  const [family, setFamily] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

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

  // Close the drawer whenever the route changes.
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('hashchange', close)
    return () => window.removeEventListener('hashchange', close)
  }, [menuOpen])

  const link = ({ isActive }: { isActive: boolean }) =>
    `block w-full text-start px-4 py-3 rounded-xl text-sm font-bold transition ${isActive ? 'bg-gold/15 text-gold-electric' : 'text-muted hover:text-ivory hover:bg-white/5'}`

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-obsidian/70 border-b border-gold/10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label={t('menu')}
            className="shrink-0 w-10 h-10 rounded-xl border border-gold/20 text-gold-electric text-lg font-black flex items-center justify-center hover:bg-gold/10 transition"
          >
            ☰
          </button>
          <div className="shrink-0">
            <Logo size="sm" />
          </div>
          <div className="flex-1" />
          <div className="text-end min-w-0 pe-12">
            <p className="text-sm font-bold truncate">{family ?? ''}</p>
            <p className="text-[11px] text-muted">{isCloud ? '' : 'demo'}</p>
          </div>
          <NavLink to="/home/notifications" className="relative shrink-0 text-lg" aria-label={t('notifications')}>
            🔔
            {unread > 0 && (
              <span className="absolute -top-1.5 -end-1.5 min-w-4 h-4 px-1 rounded-full bg-gold-electric text-obsidian text-[10px] font-black flex items-center justify-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto p-4">
        <Outlet />
      </main>

      {menuOpen && (
        <div className="fixed inset-0 z-30">
          <button aria-label={t('close')} onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-obsidian/70 backdrop-blur-sm cursor-default" />
          <div className="absolute inset-y-0 start-0 w-72 max-w-[85vw] bg-obsidian border-e border-gold/15 flex flex-col shadow-2xl">
            <div className="p-4 flex items-center justify-between border-b border-gold/10">
              <Logo size="sm" />
              <button onClick={() => setMenuOpen(false)} aria-label={t('close')}
                className="w-9 h-9 rounded-xl border border-white/10 text-muted hover:text-ivory transition text-lg">
                ✕
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {NAV.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end} className={link} onClick={() => setMenuOpen(false)}>
                  {t(item.key)}
                </NavLink>
              ))}
            </nav>
            <div className="p-3 border-t border-gold/10 space-y-1">
              <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
                className="block w-full text-start px-4 py-3 rounded-xl text-sm font-bold text-muted hover:text-ivory hover:bg-white/5 transition">
                {t('switchLanguage')} ({lang === 'ar' ? 'English' : 'العربية'})
              </button>
              <button onClick={async () => { await signOut(); navigate('/login', { replace: true }) }}
                className="block w-full text-start px-4 py-3 rounded-xl text-sm font-bold text-muted hover:text-red-300 hover:bg-white/5 transition">
                {t('signOut')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
