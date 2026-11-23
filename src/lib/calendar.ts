import { supabase, isCloud } from './supabase'
import { demo, uid, getMyProfile } from './db'
import { Recurrence } from './tasks'

export const EVENT_KINDS = ['event','occasion','maintenance','other'] as const
export type EventKind = typeof EVENT_KINDS[number]

export interface CalendarEvent {
  id: string; title: string; description: string; kind: EventKind
  startsAt: string; endsAt: string | null; allDay: boolean
  recurrence: Recurrence; reminderMinutes: number[]
  linkedMemberId: string | null; linkedTaskId: string | null; linkedRequestId: string | null
  createdBy: string
}

interface DemoEvent {
  id: string; title: string; description: string; kind: EventKind
  starts_at: string; ends_at: string | null; all_day: boolean
  recurrence: Recurrence; reminder_minutes: number[]
  linked_member_id: string | null; linked_task_id: string | null; linked_request_id: string | null
  created_by: string
}

function dload() {
  const s = demo.load() as ReturnType<typeof demo.load> & { calendarEvents?: DemoEvent[] }
  if (!s.calendarEvents) s.calendarEvents = []
  return s
}

function toEvent(e: DemoEvent): CalendarEvent {
  return {
    id: e.id, title: e.title, description: e.description, kind: e.kind,
    startsAt: e.starts_at, endsAt: e.ends_at, allDay: e.all_day,
    recurrence: e.recurrence, reminderMinutes: e.reminder_minutes,
    linkedMemberId: e.linked_member_id, linkedTaskId: e.linked_task_id, linkedRequestId: e.linked_request_id,
    createdBy: e.created_by,
  }
}

export interface EventInput {
  title: string; description: string; kind: EventKind
  startsAt: string; endsAt: string | null; allDay: boolean
  recurrence: Recurrence; reminderMinutes: number[]
  linkedMemberId: string | null; linkedTaskId: string | null; linkedRequestId: string | null
}

export async function addEvent(input: EventInput): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('calendar_events').insert({
      family_id: me!.family_id, title: input.title, description: input.description, kind: input.kind,
      starts_at: input.startsAt, ends_at: input.endsAt, all_day: input.allDay,
      recurrence: input.recurrence, reminder_minutes: input.reminderMinutes,
      linked_member_id: input.linkedMemberId, linked_task_id: input.linkedTaskId,
      linked_request_id: input.linkedRequestId, created_by: me!.id,
    })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me || me.status !== 'active') throw new Error('not allowed')
  s.calendarEvents!.push({
    id: uid(), title: input.title, description: input.description, kind: input.kind,
    starts_at: input.startsAt, ends_at: input.endsAt, all_day: input.allDay,
    recurrence: input.recurrence, reminder_minutes: input.reminderMinutes,
    linked_member_id: input.linkedMemberId, linked_task_id: input.linkedTaskId,
    linked_request_id: input.linkedRequestId, created_by: me.id,
  })
  demo.save(s)
}

export async function listEvents(): Promise<CalendarEvent[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('calendar_events').select('*').order('starts_at')
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => ({
      id: r.id, title: r.title, description: r.description, kind: r.kind,
      startsAt: r.starts_at, endsAt: r.ends_at, allDay: r.all_day,
      recurrence: r.recurrence, reminderMinutes: r.reminder_minutes ?? [],
      linkedMemberId: r.linked_member_id, linkedTaskId: r.linked_task_id, linkedRequestId: r.linked_request_id,
      createdBy: r.created_by,
    }))
  }
  const s = dload()
  return s.calendarEvents!.slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(toEvent)
}

export async function updateEvent(id: string, input: EventInput): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('calendar_events').update({
      title: input.title, description: input.description, kind: input.kind,
      starts_at: input.startsAt, ends_at: input.endsAt, all_day: input.allDay,
      recurrence: input.recurrence, reminder_minutes: input.reminderMinutes,
      linked_member_id: input.linkedMemberId, linked_task_id: input.linkedTaskId,
      linked_request_id: input.linkedRequestId,
    }).eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  const e = s.calendarEvents!.find(x => x.id === id)
  if (!me || !e) throw new Error('event not found')
  const approver = me.role === 'owner' || me.role === 'supervisor'
  if (e.created_by !== me.id && !approver) throw new Error('not allowed')
  Object.assign(e, {
    title: input.title, description: input.description, kind: input.kind,
    starts_at: input.startsAt, ends_at: input.endsAt, all_day: input.allDay,
    recurrence: input.recurrence, reminder_minutes: input.reminderMinutes,
    linked_member_id: input.linkedMemberId, linked_task_id: input.linkedTaskId,
    linked_request_id: input.linkedRequestId,
  })
  demo.save(s)
}

export async function deleteEvent(id: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('calendar_events').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  const e = s.calendarEvents!.find(x => x.id === id)
  if (!me || !e) throw new Error('event not found')
  const approver = me.role === 'owner' || me.role === 'supervisor'
  if (e.created_by !== me.id && !approver) throw new Error('not allowed')
  s.calendarEvents = s.calendarEvents!.filter(x => x.id !== id)
  demo.save(s)
}

// Expand recurring events into concrete occurrences within [from, to] (YYYY-MM-DD).
export function expandRecurrence<T extends { startsAt: string; endsAt: string | null; recurrence: Recurrence }>(
  items: T[], from: string, to: string,
): T[] {
  const out: T[] = []
  for (const item of items) {
    const startDay = item.startsAt.slice(0, 10)
    if (item.recurrence === 'none') {
      if (startDay >= from && startDay <= to) out.push(item)
      continue
    }
    let cur = new Date(startDay + 'T00:00:00Z')
    const end = new Date(to + 'T00:00:00Z')
    const spanMs = item.endsAt ? Date.parse(item.endsAt) - Date.parse(item.startsAt) : 0
    let guard = 0
    while (cur <= end && guard++ < 800) {
      const day = cur.toISOString().slice(0, 10)
      if (day >= from) {
        const time = item.startsAt.slice(10)
        const startsAt = day + time
        out.push({ ...item, startsAt, endsAt: spanMs ? new Date(Date.parse(startsAt) + spanMs).toISOString() : item.endsAt })
      }
      if (item.recurrence === 'daily') cur.setUTCDate(cur.getUTCDate() + 1)
      else if (item.recurrence === 'weekly') cur.setUTCDate(cur.getUTCDate() + 7)
      else cur.setUTCMonth(cur.getUTCMonth() + 1)
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}
