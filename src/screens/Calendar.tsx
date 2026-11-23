import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../components/ui'
import { SelectField, EmptyState } from '../components/finance'
import {
  addEvent, updateEvent, deleteEvent, listEvents, expandRecurrence,
  CalendarEvent, EventKind, EVENT_KINDS,
} from '../lib/calendar'
import { listTasks, FamilyTask, Recurrence, RECURRENCES } from '../lib/tasks'
import { listRequests, FamilyRequest } from '../lib/requests'
import { listMaintenance, MaintenanceJob } from '../lib/apartment'
import { listBills, Bill } from '../lib/bills'
import { getMyProfile, listMembers, Profile } from '../lib/db'
import { useT, Key } from '../i18n'

type View = 'day' | 'week' | 'month'

interface CalItem {
  key: string; day: string; time: string; title: string
  kind: 'event' | 'task' | 'maintenance' | 'bill'; refId: string
  event?: CalendarEvent
}

function toDay(d: Date): string { return d.toISOString().slice(0, 10) }
function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return toDay(d)
}

export default function Calendar() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<FamilyTask[]>([])
  const [requests, setRequests] = useState<FamilyRequest[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [jobs, setJobs] = useState<MaintenanceJob[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(toDay(new Date()))
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<EventKind>('event')
  const [date, setDate] = useState(toDay(new Date()))
  const [time, setTime] = useState('18:00')
  const [allDay, setAllDay] = useState(true)
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [reminders, setReminders] = useState('')
  const [linkedMemberId, setLinkedMemberId] = useState('')
  const [linkedTaskId, setLinkedTaskId] = useState('')
  const [linkedRequestId, setLinkedRequestId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setEvents(await listEvents())
    setTasks(await listTasks())
    setRequests(await listRequests())
    setJobs(await listMaintenance().catch(() => []))
    setBills(await listBills().catch(() => []))
    setMembers(await listMembers())
  }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => {}) }, [])

  const range = useMemo((): [string, string] => {
    if (view === 'day') return [cursor, cursor]
    if (view === 'week') {
      const d = new Date(cursor + 'T00:00:00Z')
      const start = addDays(cursor, -((d.getUTCDay() + 1) % 7)) // week starts Saturday (EG)
      return [start, addDays(start, 6)]
    }
    const month = cursor.slice(0, 7)
    const first = month + '-01'
    const d = new Date(first + 'T00:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + 1)
    return [first, addDays(toDay(d), -1)]
  }, [view, cursor])

  const items = useMemo((): CalItem[] => {
    const [from, to] = range
    const out: CalItem[] = []
    for (const e of expandRecurrence(events, from, to)) {
      out.push({
        key: 'ev-' + e.id + '-' + e.startsAt.slice(0, 10), day: e.startsAt.slice(0, 10),
        time: e.allDay ? '' : e.startsAt.slice(11, 16), title: e.title, kind: 'event', refId: e.id, event: e,
      })
    }
    for (const task of expandRecurrence(
      tasks.filter(x => x.dueDate && x.status !== 'cancelled')
        .map(x => ({ startsAt: x.dueDate! + 'T00:00', endsAt: null, recurrence: x.recurrence, task: x })),
      from, to,
    )) {
      out.push({
        key: 'task-' + task.task.id + '-' + task.startsAt.slice(0, 10), day: task.startsAt.slice(0, 10),
        time: '', title: task.task.title, kind: 'task', refId: task.task.id,
      })
    }
    for (const b of bills) {
      if (!b.active || b.dueDate < from || b.dueDate > to) continue
      out.push({
        key: 'bill-' + b.id + '-' + b.dueDate, day: b.dueDate,
        time: '', title: b.title, kind: 'bill', refId: b.id,
      })
    }
    for (const j of jobs) {
      if (!j.scheduledAt) continue
      const day = j.scheduledAt.slice(0, 10)
      if (day >= from && day <= to) {
        out.push({ key: 'job-' + j.id, day, time: j.scheduledAt.slice(11, 16), title: j.title, kind: 'maintenance', refId: j.id })
      }
    }
    return out.sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time))
  }, [range, events, tasks, jobs, bills])

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>()
    for (const item of items) {
      if (!map.has(item.day)) map.set(item.day, [])
      map.get(item.day)!.push(item)
    }
    return map
  }, [items])

  function openCreate(day?: string) {
    setEditing(null); setTitle(''); setDescription(''); setKind('event')
    setDate(day ?? cursor); setTime('18:00'); setAllDay(true); setRecurrence('none')
    setReminders(''); setLinkedMemberId(''); setLinkedTaskId(''); setLinkedRequestId('')
    setShowForm(true)
  }
  function openEdit(e: CalendarEvent) {
    setEditing(e); setTitle(e.title); setDescription(e.description); setKind(e.kind)
    setDate(e.startsAt.slice(0, 10)); setTime(e.startsAt.slice(11, 16) || '18:00')
    setAllDay(e.allDay); setRecurrence(e.recurrence); setReminders(e.reminderMinutes.join(','))
    setLinkedMemberId(e.linkedMemberId ?? ''); setLinkedTaskId(e.linkedTaskId ?? '')
    setLinkedRequestId(e.linkedRequestId ?? ''); setShowForm(true)
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true); setError(null)
    try {
      const input = {
        title: title.trim(), description: description.trim(), kind,
        startsAt: allDay ? date + 'T00:00:00' : `${date}T${time}:00`,
        endsAt: null, allDay, recurrence,
        reminderMinutes: reminders.split(',').map(x => parseInt(x.trim(), 10)).filter(n => Number.isFinite(n) && n > 0),
        linkedMemberId: linkedMemberId || null, linkedTaskId: linkedTaskId || null,
        linkedRequestId: linkedRequestId || null,
      }
      if (editing) await updateEvent(editing.id, input)
      else await addEvent(input)
      setShowForm(false)
      await refresh()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  async function remove() {
    if (!editing) return
    setBusy(true)
    try { await deleteEvent(editing.id); setShowForm(false); await refresh() }
    catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  function move(n: number) {
    if (view === 'day') setCursor(addDays(cursor, n))
    else if (view === 'week') setCursor(addDays(cursor, 7 * n))
    else {
      const d = new Date(cursor + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n)
      setCursor(toDay(d))
    }
  }

  const canModify = (e: CalendarEvent) => !!me && (e.createdBy === me.id || me.role === 'owner' || me.role === 'supervisor')
  const views: View[] = ['day', 'week', 'month']
  const viewLabels: Record<View, Key> = { day: 'dayView', week: 'weekView', month: 'monthView' }
  const kindStyles: Record<CalItem['kind'], string> = {
    event: 'border-gold-electric/50 text-gold-electric',
    task: 'border-sky-400/50 text-sky-300',
    maintenance: 'border-amber-400/50 text-amber-300',
    bill: 'border-red-400/50 text-red-300',
  }

  const days: string[] = []
  if (view === 'month') {
    const first = range[0]
    const lead = (new Date(first + 'T00:00:00Z').getUTCDay() + 1) % 7
    for (let i = -lead; addDays(first, i) <= range[1]; i++) days.push(addDays(first, i))
  } else {
    for (let d = range[0]; d <= range[1]; d = addDays(d, 1)) days.push(d)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black gold-text">{t('calendar')}</h1>
        <GhostButton onClick={() => openCreate()} className="text-sm px-4 py-2">{t('addEvent')}</GhostButton>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {views.map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${view === v ? 'border-gold-electric/60 text-gold-electric bg-gold-electric/10' : 'border-white/10 text-muted hover:text-ivory'}`}>
              {t(viewLabels[v])}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => move(-1)} className="text-muted hover:text-ivory px-2">‹</button>
          <button onClick={() => setCursor(toDay(new Date()))} className="text-xs text-muted hover:text-gold-electric">{t('today')}</button>
          <button onClick={() => move(1)} className="text-muted hover:text-ivory px-2">›</button>
        </div>
      </div>
      <p className="text-center text-sm text-muted">{range[0]} → {range[1]}</p>

      {view === 'month' ? (
        <div className="grid grid-cols-7 gap-1">
          {days.map(day => {
            const inMonth = day.slice(0, 7) === range[0].slice(0, 7)
            const dayItems = byDay.get(day) ?? []
            const isToday = day === toDay(new Date())
            return (
              <button key={day} onClick={() => { setCursor(day); setView('day') }}
                className={`min-h-16 rounded-xl border p-1 text-start align-top transition ${isToday ? 'border-gold-electric/60 bg-gold-electric/10' : inMonth ? 'border-white/10 bg-white/5' : 'border-white/5 opacity-40'}`}>
                <p className="text-[10px] font-bold text-muted">{parseInt(day.slice(8), 10)}</p>
                <div className="space-y-0.5 mt-0.5">
                  {dayItems.slice(0, 3).map(item => (
                    <p key={item.key} className={`text-[9px] leading-tight border-s-2 ps-1 truncate ${kindStyles[item.kind]}`}>{item.title}</p>
                  ))}
                  {dayItems.length > 3 && <p className="text-[9px] text-muted">+{dayItems.length - 3}</p>}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {days.map(day => (
            <div key={day}>
              <div className="flex items-center justify-between">
                <p className={`text-sm font-bold ${day === toDay(new Date()) ? 'text-gold-electric' : 'text-muted'}`}>{day}</p>
                <button onClick={() => openCreate(day)} className="text-xs text-muted hover:text-gold-electric">+ {t('addEvent')}</button>
              </div>
              {(byDay.get(day) ?? []).map(item => (
                <GlassCard key={item.key} className="mt-2 !p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold">{item.time ? item.time + ' · ' : ''}{item.title}</p>
                      <p className={`text-[10px] ${kindStyles[item.kind]}`}>
                        {item.kind === 'event' ? t(('ek_' + (item.event?.kind ?? 'event')) as Key) : item.kind === 'task' ? t('tasks') : item.kind === 'bill' ? t('bills') : t('maintenanceLog')}
                      </p>
                    </div>
                    {item.kind === 'task' && <Link className="text-xs text-gold-electric underline" to={`/home/tasks/${item.refId}`}>{t('tasks')}</Link>}
                    {item.event && canModify(item.event) && (
                      <button onClick={() => openEdit(item.event!)} className="text-xs text-muted hover:text-ivory">{t('edit')}</button>
                    )}
                  </div>
                </GlassCard>
              ))}
            </div>
          ))}
          {items.length === 0 && <EmptyState text={t('noEvents')} />}
        </div>
      )}

      {showForm && (
        <GlassCard>
          <form onSubmit={submit} className="space-y-3">
            <p className="font-bold">{editing ? t('editEvent') : t('addEvent')}</p>
            <Field label={t('eventTitle')} value={title} onChange={e => setTitle(e.target.value)} required />
            <div>
              <label className="label-glass">{t('description')}</label>
              <textarea className="input-glass" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField label={t('eventKind')} value={kind} onChange={e => setKind(e.target.value as EventKind)}>
                {EVENT_KINDS.map(k => <option key={k} value={k}>{t(('ek_' + k) as Key)}</option>)}
              </SelectField>
              <SelectField label={t('recurrence')} value={recurrence} onChange={e => setRecurrence(e.target.value as Recurrence)}>
                {RECURRENCES.map(r => <option key={r} value={r}>{t(('rec_' + r) as Key)}</option>)}
              </SelectField>
              <Field label={t('startDate')} type="date" value={date} onChange={e => setDate(e.target.value)} required />
              {!allDay && <Field label={t('status')} type="time" value={time} onChange={e => setTime(e.target.value)} />}
              <SelectField label={t('linkMember')} value={linkedMemberId} onChange={e => setLinkedMemberId(e.target.value)}>
                <option value="">{t('noLink')}</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </SelectField>
              <SelectField label={t('linkTask')} value={linkedTaskId} onChange={e => setLinkedTaskId(e.target.value)}>
                <option value="">{t('noLink')}</option>
                {tasks.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
              </SelectField>
              <SelectField label={t('linkRequest')} value={linkedRequestId} onChange={e => setLinkedRequestId(e.target.value)}>
                <option value="">{t('noLink')}</option>
                {requests.map(r => <option key={r.id} value={r.id}>#{r.requestNumber} {r.title}</option>)}
              </SelectField>
              <Field label={t('reminders')} value={reminders} onChange={e => setReminders(e.target.value)} placeholder="60, 1440" />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
              {t('allDay')}
            </label>
            <ErrorNote message={error} />
            <div className="flex gap-2">
              <GoldButton disabled={busy || !title.trim()}>{t('save')}</GoldButton>
              {editing && <GhostButton type="button" onClick={remove} disabled={busy} className="px-4 text-red-300">{t('delete')}</GhostButton>}
              <GhostButton type="button" onClick={() => setShowForm(false)} className="px-4">{t('cancel')}</GhostButton>
            </div>
          </form>
        </GlassCard>
      )}
    </div>
  )
}
