import { supabase, isCloud } from './supabase'
import { demo, uid, getMyProfile } from './db'

export interface AppNotification {
  id: number; kind: string; title: string; body: string
  readAt: string | null; createdAt: string
}

interface DemoNotification {
  id: number; profile_id: string; kind: string; title: string; body: string
  read_at: string | null; created_at: string
}

function dload() {
  const s = demo.load() as ReturnType<typeof demo.load> & {
    notifications?: DemoNotification[]; notificationSettings?: Record<string, Record<string, string>>
  }
  if (!s.notifications) s.notifications = []
  if (!s.notificationSettings) s.notificationSettings = {}
  return s
}

// Mirrors public.notify(): never self, honors recipient settings.
export async function notify(profileId: string, kind: string, title: string, body = ''): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('notify', { p_profile_id: profileId, p_kind: kind, p_title: title, p_body: body })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const meId = s.session?.userId
  if (!meId || profileId === meId) return
  const me = s.profiles.find(p => p.id === meId)
  const target = s.profiles.find(p => p.id === profileId)
  if (!me || !target || target.family_id !== me.family_id) throw new Error('not allowed')
  const settings = s.notificationSettings![profileId] ?? {}
  if (settings[kind] === 'off') return
  s.notifications!.push({
    id: s.notifications!.length + 1, profile_id: profileId, kind, title, body,
    read_at: null, created_at: new Date().toISOString(),
  })
  demo.save(s)
}

export async function listNotifications(): Promise<AppNotification[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('notifications').select('*')
      .order('created_at', { ascending: false }).limit(100)
    if (error) throw new Error(error.message)
    return (data ?? []).map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, readAt: n.read_at, createdAt: n.created_at }))
  }
  const s = dload()
  const meId = s.session?.userId
  if (!meId) return []
  return s.notifications!.filter(n => n.profile_id === meId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, readAt: n.read_at, createdAt: n.created_at }))
}

export async function unreadCount(): Promise<number> {
  const all = await listNotifications()
  return all.filter(n => !n.readAt).length
}

export const NOTIFS_CHANGED = 'homeos:notifications-changed'

export async function markAllRead(): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
    if (error) throw new Error(error.message)
    window.dispatchEvent(new Event(NOTIFS_CHANGED))
    return
  }
  const s = dload()
  const meId = s.session?.userId
  const now = new Date().toISOString()
  for (const n of s.notifications!) {
    if (n.profile_id === meId && !n.read_at) n.read_at = now
  }
  demo.save(s)
  window.dispatchEvent(new Event(NOTIFS_CHANGED))
}

export const NOTIFICATION_KINDS = ['request','task','comment','invitation','salary','reminder'] as const
export type NotificationKind = typeof NOTIFICATION_KINDS[number]

export async function getSettings(): Promise<Record<string, string>> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('notification_settings').select('kinds').maybeSingle()
    if (error) throw new Error(error.message)
    return (data?.kinds as Record<string, string>) ?? {}
  }
  const s = dload()
  return s.notificationSettings![s.session?.userId ?? ''] ?? {}
}

export async function setKindEnabled(kind: NotificationKind, enabled: boolean): Promise<void> {
  if (isCloud && supabase) {
    const current = await getSettings()
    const kinds = { ...current, [kind]: enabled ? 'on' : 'off' }
    const { error } = await supabase.from('notification_settings')
      .upsert({ profile_id: (await getMyProfile())!.id, kinds, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const meId = s.session?.userId
  if (!meId) return
  const cur = s.notificationSettings![meId] ?? {}
  s.notificationSettings![meId] = { ...cur, [kind]: enabled ? 'on' : 'off' }
  demo.save(s)
}
