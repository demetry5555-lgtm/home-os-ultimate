import { supabase, isCloud } from './supabase'
import { demo, uid, getMyProfile } from './db'

export interface ChatThread {
  id: string; kind: 'family' | 'direct'
  otherName: string | null   // for direct threads: the other member's name
}
export interface ChatMessage {
  id: string; threadId: string; senderId: string; body: string; createdAt: string
}

interface DemoThread { id: string; kind: 'family' | 'direct'; direct_key: string | null }
interface DemoMessage { id: string; thread_id: string; sender_id: string; body: string; created_at: string }

function dload() {
  const s = demo.load() as ReturnType<typeof demo.load> & { chatThreads?: DemoThread[]; chatMessages?: DemoMessage[] }
  if (!s.chatThreads) s.chatThreads = []
  if (!s.chatMessages) s.chatMessages = []
  return s
}

function ensureFamilyRoom(s: ReturnType<typeof dload>): DemoThread {
  let room = s.chatThreads!.find(t => t.kind === 'family')
  if (!room) {
    room = { id: uid(), kind: 'family', direct_key: null }
    s.chatThreads!.push(room)
  }
  return room
}

export async function listThreads(): Promise<ChatThread[]> {
  const me = await getMyProfile()
  if (!me) return []
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('chat_threads').select('*')
    if (error) throw new Error(error.message)
    const members = await (await import('./db')).listMembers()
    return (data ?? []).map(t => {
      if (t.kind === 'family') return { id: t.id, kind: 'family', otherName: null }
      const otherId = (t.direct_key as string).split(':').find((x: string) => x !== me.id)
      const other = members.find(m => m.id === otherId)
      return { id: t.id, kind: 'direct', otherName: other?.full_name ?? null }
    })
  }
  const s = dload()
  ensureFamilyRoom(s)
  demo.save(s)
  return s.chatThreads!
    .filter(t => t.kind === 'family' || (t.direct_key ?? '').split(':').includes(me.id))
    .map(t => {
      if (t.kind === 'family') return { id: t.id, kind: 'family', otherName: null }
      const otherId = t.direct_key!.split(':').find(x => x !== me.id)
      const other = s.profiles.find(p => p.id === otherId)
      return { id: t.id, kind: 'direct', otherName: other?.full_name ?? null }
    })
}

export async function openDirectThread(otherProfileId: string): Promise<string> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.rpc('open_direct_thread', { p_other_profile_id: otherProfileId })
    if (error) throw new Error(error.message)
    return data as string
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  const other = s.profiles.find(p => p.id === otherProfileId)
  if (!me || !other || me.id === other.id || me.family_id !== other.family_id) throw new Error('not allowed')
  const key = [me.id, other.id].sort().join(':')
  let t = s.chatThreads!.find(x => x.kind === 'direct' && x.direct_key === key)
  if (!t) {
    t = { id: uid(), kind: 'direct', direct_key: key }
    s.chatThreads!.push(t)
  }
  ensureFamilyRoom(s)
  demo.save(s)
  return t.id
}

export async function listMessages(threadId: string): Promise<ChatMessage[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('chat_messages').select('*')
      .eq('thread_id', threadId).order('created_at').limit(200)
    if (error) throw new Error(error.message)
    return (data ?? []).map(m => ({ id: m.id, threadId: m.thread_id, senderId: m.sender_id, body: m.body, createdAt: m.created_at }))
  }
  const s = dload()
  return s.chatMessages!.filter(m => m.thread_id === threadId)
    .map(m => ({ id: m.id, threadId: m.thread_id, senderId: m.sender_id, body: m.body, createdAt: m.created_at }))
}

export async function sendMessage(threadId: string, body: string): Promise<void> {
  const trimmed = body.trim()
  if (!trimmed) return
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('chat_messages').insert({ thread_id: threadId, sender_id: me!.id, body: trimmed })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  if (!s.session) throw new Error('not authenticated')
  s.chatMessages!.push({ id: uid(), thread_id: threadId, sender_id: s.session.userId, body: trimmed, created_at: new Date().toISOString() })
  demo.save(s)
}
