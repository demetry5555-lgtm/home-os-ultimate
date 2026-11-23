import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../components/ui'
import { SelectField, EmptyState, MoneyText } from '../components/finance'
import {
  createTask, listTasks, FamilyTask, TaskStatus, Recurrence, RECURRENCES,
} from '../lib/tasks'
import { PRIORITIES, Priority, listRequests, FamilyRequest } from '../lib/requests'
import { getMyProfile, listMembers, Profile } from '../lib/db'
import { listRooms, Room } from '../lib/apartment'
import { parseAmount } from '../lib/money'
import { useT, Key } from '../i18n'

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useT()
  const styles: Record<TaskStatus, string> = {
    todo: 'text-sky-300 border-sky-400/40 bg-sky-400/10',
    in_progress: 'text-gold-electric border-gold-electric/40 bg-gold-electric/10',
    blocked: 'text-red-300 border-red-400/40 bg-red-400/10',
    pending_approval: 'text-amber-300 border-amber-400/40 bg-amber-400/10',
    completed: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
    cancelled: 'text-muted border-muted/40 bg-muted/10',
  }
  return <span className={`text-xs font-bold px-3 py-1 rounded-full border ${styles[status]}`}>{t(('ts_' + status) as Key)}</span>
}

type Filter = 'all' | 'mine' | 'active' | 'completed'

export default function Tasks() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<FamilyTask[]>([])
  const [requests, setRequests] = useState<FamilyRequest[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [priority, setPriority] = useState<Priority>('normal')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [budget, setBudget] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [requiresApproval, setRequiresApproval] = useState(false)
  const [linkedRequestId, setLinkedRequestId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setTasks(await listTasks())
    setMembers(await listMembers())
    setRequests(await listRequests())
    setRooms(await listRooms())
  }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => {}) }, [])

  const name = (id: string | null) => members.find(m => m.id === id)?.full_name ?? '—'

  const visible = tasks.filter(task => {
    if (filter === 'mine') return me && (task.assigneeId === me.id || task.participants.includes(me.id) || task.createdBy === me.id)
    if (filter === 'active') return ['todo','in_progress','blocked','pending_approval'].includes(task.status)
    if (filter === 'completed') return task.status === 'completed'
    return true
  })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await createTask({
        title: title.trim(), description: description.trim(),
        assigneeId: assigneeId || null, participants: participantIds,
        priority, startDate: startDate || null, dueDate: dueDate || null,
        budgetCents: budget ? parseAmount(budget) : null,
        recurrence, requiresApproval,
        linkedRequestId: linkedRequestId || null, roomId: roomId || null,
      })
      setTitle(''); setDescription(''); setBudget(''); setShowForm(false)
      await refresh()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  const filters: Filter[] = ['all', 'mine', 'active', 'completed']
  const filterLabels: Record<Filter, Key> = { all: 'allTasks', mine: 'myTasks', active: 'activeTasks', completed: 'completedTasks' }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black gold-text">{t('tasks')}</h1>
        <GhostButton onClick={() => setShowForm(v => !v)} className="text-sm px-4 py-2">{t('newTask')}</GhostButton>
      </div>

      <div className="flex gap-2">
        {filters.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${filter === f ? 'border-gold-electric/60 text-gold-electric bg-gold-electric/10' : 'border-white/10 text-muted hover:text-ivory'}`}>
            {t(filterLabels[f])}
          </button>
        ))}
      </div>

      {showForm && (
        <GlassCard>
          <form onSubmit={submit} className="space-y-3">
            <Field label={t('taskName')} value={title} onChange={e => setTitle(e.target.value)} required />
            <div>
              <label className="label-glass">{t('description')}</label>
              <textarea className="input-glass" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField label={t('assignee')} value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                <option value="">—</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </SelectField>
              <SelectField label={t('priority')} value={priority} onChange={e => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{t(('pr_' + p) as Key)}</option>)}
              </SelectField>
              <Field label={t('startDate')} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              <Field label={t('dueDate')} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              <Field label={t('budget')} inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0.00" />
              <SelectField label={t('recurrence')} value={recurrence} onChange={e => setRecurrence(e.target.value as Recurrence)}>
                {RECURRENCES.map(r => <option key={r} value={r}>{t(('rec_' + r) as Key)}</option>)}
              </SelectField>
              <SelectField label={t('linkRequest')} value={linkedRequestId} onChange={e => setLinkedRequestId(e.target.value)}>
                <option value="">{t('noLink')}</option>
                {requests.map(r => <option key={r.id} value={r.id}>#{r.requestNumber} {r.title}</option>)}
              </SelectField>
              <SelectField label={t('linkRoom')} value={roomId} onChange={e => setRoomId(e.target.value)}>
                <option value="">{t('noLink')}</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </SelectField>
            </div>
            <div>
              <label className="label-glass">{t('participants')}</label>
              <div className="flex flex-wrap gap-2">
                {members.map(m => (
                  <button type="button" key={m.id}
                    onClick={() => setParticipantIds(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])}
                    className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${participantIds.includes(m.id) ? 'border-gold-electric/60 text-gold-electric bg-gold-electric/10' : 'border-white/10 text-muted'}`}>
                    {m.full_name}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={requiresApproval} onChange={e => setRequiresApproval(e.target.checked)} />
              {t('requiresApproval')}
            </label>
            <ErrorNote message={error} />
            <GoldButton disabled={busy || !title.trim()}>{t('create')}</GoldButton>
          </form>
        </GlassCard>
      )}

      {visible.length === 0 && !showForm && <EmptyState text={t('noTasks')} />}

      {visible.map(task => (
        <Link key={task.id} to={`/home/tasks/${task.id}`}>
          <GlassCard className="mb-3 hover:border-gold/30 transition">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold">{task.title}</p>
                <p className="text-xs text-muted mt-1">
                  {name(task.assigneeId)} · {t(('pr_' + task.priority) as Key)}
                  {task.dueDate ? ` · ${t('dueDate')}: ${task.dueDate}` : ''}
                  {task.recurrence !== 'none' ? ` · ${t(('rec_' + task.recurrence) as Key)}` : ''}
                </p>
              </div>
              <div className="text-end space-y-1">
                <TaskStatusBadge status={task.status} />
                {task.budgetCents != null && <p className="text-xs text-gold-electric font-bold"><MoneyText cents={task.budgetCents} /></p>}
                {task.rating != null && <p className="text-xs text-gold-electric">{'★'.repeat(task.rating)}</p>}
              </div>
            </div>
          </GlassCard>
        </Link>
      ))}
    </div>
  )
}
