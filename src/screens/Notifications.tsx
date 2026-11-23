import { useEffect, useState } from 'react'
import { GlassCard, GhostButton } from '../components/ui'
import { EmptyState } from '../components/finance'
import {
  listNotifications, markAllRead, getSettings, setKindEnabled,
  AppNotification, NOTIFICATION_KINDS, NotificationKind,
} from '../lib/notifications'
import { listTasks, FamilyTask } from '../lib/tasks'
import { listEvents, CalendarEvent } from '../lib/calendar'
import { listBills } from '../lib/bills'
import { getMyProfile, Profile } from '../lib/db'
import { useT, Key } from '../i18n'

export default function Notifications() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [items, setItems] = useState<AppNotification[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [showSettings, setShowSettings] = useState(false)
  const [reminders, setReminders] = useState<{ key: string; label: string; sub: string }[]>([])

  async function refresh() {
    setItems(await listNotifications())
    setSettings(await getSettings())
    const [tasks, events, profile, bills] = await Promise.all([listTasks(), listEvents(), getMyProfile(), listBills().catch(() => [])])
    setMe(profile)
    const today = new Date().toISOString().slice(0, 10)
    const now = Date.now()
    const r: { key: string; label: string; sub: string }[] = []
    for (const task of tasks) {
      if (!task.dueDate || ['completed','cancelled'].includes(task.status)) continue
      const mine = profile && (task.assigneeId === profile.id || task.participants.includes(profile.id))
      if (!mine) continue
      if (task.dueDate < today) r.push({ key: 'task-' + task.id, label: task.title, sub: 'overdue' })
      else if (task.dueDate === today) r.push({ key: 'task-' + task.id, label: task.title, sub: 'dueToday' })
    }
    const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    for (const b of bills) {
      if (!b.active || b.dueDate > week) continue
      r.push({ key: 'bill-' + b.id, label: b.title, sub: b.dueDate < today ? 'overdue' : 'billsDueSoon' })
    }
    for (const ev of events) {
      for (const mins of ev.reminderMinutes) {
        const at = Date.parse(ev.startsAt) - mins * 60000
        if (at <= now && Date.parse(ev.startsAt) > now) {
          r.push({ key: 'ev-' + ev.id + '-' + mins, label: ev.title, sub: 'upcomingEvent' })
        }
      }
    }
    setReminders(r)
  }
  useEffect(() => { refresh().catch(() => {}) }, [])

  async function readAll() {
    await markAllRead()
    await refresh()
  }

  const kindIcon: Record<string, string> = {
    request: '📨', task: '✅', comment: '💬', invitation: '✉️', salary: '💰', reminder: '⏰',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black gold-text">{t('notifications')}</h1>
        <div className="flex gap-2">
          <GhostButton onClick={() => setShowSettings(v => !v)} className="text-sm px-4 py-2">⚙</GhostButton>
          <GhostButton onClick={readAll} className="text-sm px-4 py-2">{t('markAllRead')}</GhostButton>
        </div>
      </div>

      {showSettings && (
        <GlassCard>
          <p className="label-glass">{t('notificationSettings')}</p>
          <div className="space-y-2">
            {NOTIFICATION_KINDS.map(k => {
              const on = settings[k] !== 'off'
              return (
                <label key={k} className="flex items-center justify-between text-sm">
                  <span>{t(('nk_' + k) as Key)}</span>
                  <input type="checkbox" checked={on}
                    onChange={e => setKindEnabled(k as NotificationKind, e.target.checked).then(refresh)} />
                </label>
              )
            })}
          </div>
        </GlassCard>
      )}

      {reminders.length > 0 && (
        <GlassCard>
          <p className="label-glass">{t('reminders')}</p>
          {reminders.map(r => (
            <div key={r.key} className="flex justify-between text-sm py-1">
              <span>{r.label}</span>
              <span className={r.sub === 'overdue' ? 'text-red-300 text-xs' : 'text-gold-electric text-xs'}>{t(r.sub as Key)}</span>
            </div>
          ))}
        </GlassCard>
      )}

      {items.length === 0 && <EmptyState text={t('noNotifications')} />}
      {items.map(n => (
        <GlassCard key={n.id} className={`!p-4 ${n.readAt ? 'opacity-60' : ''}`}>
          <div className="flex items-start gap-3">
            <span>{kindIcon[n.kind] ?? '🔔'}</span>
            <div className="flex-1">
              <p className="font-bold text-sm">{n.title}</p>
              {n.body && <p className="text-xs text-muted mt-0.5">{n.body}</p>}
              <p className="text-[10px] text-muted mt-1">{new Date(n.createdAt).toLocaleString()}</p>
            </div>
            {!n.readAt && <span className="w-2 h-2 rounded-full bg-gold-electric mt-1.5" />}
          </div>
        </GlassCard>
      ))}
    </div>
  )
}
