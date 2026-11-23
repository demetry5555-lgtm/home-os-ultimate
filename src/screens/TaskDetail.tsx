import { FormEvent, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../components/ui'
import { MoneyText } from '../components/finance'
import { TaskStatusBadge } from './Tasks'
import {
  getTask, setTaskStatus, rateTask, listSteps, addStep, toggleStep,
  listTaskComments, addTaskComment, listTaskEvents, nextTaskStatuses,
  FamilyTask, TaskStep, TaskComment, TaskEvent, TaskStatus,
} from '../lib/tasks'
import { getMyProfile, listMembers, Profile } from '../lib/db'
import { useT, Key } from '../i18n'
import { uploadDocument } from '../lib/documents'
import { useRef } from 'react'

export default function TaskDetail() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [task, setTask] = useState<FamilyTask | null>(null)
  const [steps, setSteps] = useState<TaskStep[]>([])
  const [comments, setComments] = useState<TaskComment[]>([])
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [newStep, setNewStep] = useState('')
  const [comment, setComment] = useState('')
  const [paths, setPaths] = useState<{ path: string; kind: string }[]>([])
  const attachRef = useRef<HTMLInputElement>(null)
  const [attachKind, setAttachKind] = useState<'attachment' | 'proof'>('attachment')
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!id) return
    try {
      const { listDocuments } = await import('../lib/documents')
      setPaths((await listDocuments()).filter(d => d.entityType === 'task' && d.entityId === id)
        .map(d => ({ path: d.path, kind: d.category === 'photo' ? 'proof' : 'attachment' })))
    } catch { /* listing is best-effort */ }
    setTask(await getTask(id))
    setSteps(await listSteps(id))
    setComments(await listTaskComments(id))
    setEvents(await listTaskEvents(id))
    setMembers(await listMembers())
  }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => {}) }, [id])

  const name = (pid: string | null) => members.find(m => m.id === pid)?.full_name ?? '—'

  if (!task) return <div className="h-full" />

  const isApprover = !!me && (me.role === 'owner' || me.role === 'supervisor')
  const isCreator = !!me && task.createdBy === me.id
  const isActor = isCreator || task.assigneeId === me?.id || (me ? task.participants.includes(me.id) : false) || isApprover
  const actions = me ? nextTaskStatuses(task, { isApprover, isCreator, isActor }) : []

  const actionLabel: Partial<Record<TaskStatus, Key>> = {
    in_progress: 'startTask', blocked: 'blockTask', todo: 'unblock',
    pending_approval: 'requestApproval', completed: task.requiresApproval ? 'approveCompletion' : 'markCompleted',
    cancelled: 'cancel',
  }

  const taskId = task.id
  async function doStatus(s: TaskStatus) {
    setError(null)
    try { await setTaskStatus(taskId, s); await refresh() } catch (err) { setError((err as Error).message) }
  }
  async function doRate(stars: number) {
    setError(null)
    try { await rateTask(taskId, stars); await refresh() } catch (err) { setError((err as Error).message) }
  }
  async function submitStep(e: FormEvent) {
    e.preventDefault()
    if (!newStep.trim()) return
    await addStep(taskId, newStep.trim())
    setNewStep('')
    await refresh()
  }
  async function submitComment(e: FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return
    await addTaskComment(taskId, comment.trim())
    setComment('')
    await refresh()
  }

  const doneSteps = steps.filter(s => s.done).length

  return (
    <div className="space-y-4">
      <Link to="/home/tasks" className="text-sm text-muted hover:text-ivory"><span className="back-arrow">←</span> {t('tasks')}</Link>

      <GlassCard>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-black">{task.title}</h1>
            {task.description && <p className="text-sm text-muted mt-1">{task.description}</p>}
          </div>
          <TaskStatusBadge status={task.status} />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
          <p className="text-muted">{t('assignee')}: <span className="text-ivory">{name(task.assigneeId)}</span></p>
          <p className="text-muted">{t('priority')}: <span className="text-ivory">{t(('pr_' + task.priority) as Key)}</span></p>
          {task.startDate && <p className="text-muted">{t('startDate')}: <span className="text-ivory">{task.startDate}</span></p>}
          {task.dueDate && <p className="text-muted">{t('dueDate')}: <span className="text-ivory">{task.dueDate}</span></p>}
          {task.budgetCents != null && <p className="text-muted">{t('budget')}: <span className="text-gold-electric font-bold"><MoneyText cents={task.budgetCents} /></span></p>}
          {task.recurrence !== 'none' && <p className="text-muted">{t('recurrence')}: <span className="text-ivory">{t(('rec_' + task.recurrence) as Key)}</span></p>}
          {task.participants.length > 0 && <p className="text-muted col-span-2">{t('participants')}: <span className="text-ivory">{task.participants.map(name).join(', ')}</span></p>}
          {task.linkedRequestId && <p className="text-muted col-span-2"><Link className="text-gold-electric underline" to={`/home/requests/${task.linkedRequestId}`}>{t('linkRequest')}</Link></p>}
        </div>
        {task.rating != null && (
          <p className="mt-3 text-gold-electric text-lg">{'★'.repeat(task.rating)}{'☆'.repeat(5 - task.rating)}</p>
        )}
      </GlassCard>

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map(s => (
            <GhostButton key={s} onClick={() => doStatus(s)} className="text-sm px-4 py-2">
              {t(actionLabel[s] ?? ('ts_' + s) as Key)}
            </GhostButton>
          ))}
        </div>
      )}
      <ErrorNote message={error} />

      {isApprover && task.status === 'completed' && task.rating == null && (
        <GlassCard>
          <p className="label-glass">{t('rateTask')}</p>
          <div className="flex gap-2">
            {[1,2,3,4,5].map(n => (
              <button key={n} onClick={() => doRate(n)} className="text-2xl text-gold-electric hover:scale-125 transition">★</button>
            ))}
          </div>
        </GlassCard>
      )}

      <GlassCard>
        <p className="label-glass">{t('steps')} ({doneSteps}/{steps.length})</p>
        <div className="space-y-2">
          {steps.map(step => (
            <label key={step.id} className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={step.done}
                onChange={e => toggleStep(step.id, e.target.checked).then(refresh)} />
              <span className={step.done ? 'line-through text-muted' : ''}>{step.title}</span>
            </label>
          ))}
        </div>
        <form onSubmit={submitStep} className="flex gap-2 mt-3">
          <input className="input-glass flex-1" placeholder={t('stepPlaceholder')} value={newStep} onChange={e => setNewStep(e.target.value)} />
          <GhostButton className="px-4 py-2 text-sm">{t('addStep')}</GhostButton>
        </form>
      </GlassCard>

      <GlassCard>
        <p className="label-glass">{t('attachments')} / {t('proofPhotos')}</p>
        <div className="flex gap-2 mb-2">
          <select className="input-glass !w-auto" value={attachKind} onChange={e => setAttachKind(e.target.value as 'attachment' | 'proof')}>
            <option value="attachment">{t('attachments')}</option>
            <option value="proof">{t('proofPhoto')}</option>
          </select>
          <input ref={attachRef} type="file" accept="image/*,.pdf" className="hidden"
            onChange={async e => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                await uploadDocument({
                  file: f, title: f.name, category: attachKind === 'proof' ? 'photo' : 'general',
                  visibility: 'family', entityType: 'task', entityId: taskId, tags: [attachKind],
                })
                await refresh()
              } catch (err) { setError((err as Error).message) }
              if (attachRef.current) attachRef.current.value = ''
            }} />
          <GhostButton type="button" className="text-sm px-4 py-2" onClick={() => attachRef.current?.click()}>{t('attachFile')}</GhostButton>
        </div>
        {paths.map(p => <p key={p.path} className="text-xs text-muted truncate">📎 {p.path.split('/').pop()}{p.kind === 'proof' ? ' · ' + t('proofPhoto') : ''}</p>)}
      </GlassCard>

      <GlassCard>
        <p className="label-glass">{t('comments')}</p>
        <div className="space-y-2">
          {comments.map(c => (
            <div key={c.id} className="text-sm">
              <span className="font-bold text-gold-electric">{name(c.authorId)}: </span>
              <span>{c.body}</span>
              <span className="text-[10px] text-muted ms-2">{new Date(c.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
        <form onSubmit={submitComment} className="flex gap-2 mt-3">
          <input className="input-glass flex-1" value={comment} onChange={e => setComment(e.target.value)} />
          <GhostButton className="px-4 py-2 text-sm">{t('send')}</GhostButton>
        </form>
      </GlassCard>

      <GlassCard>
        <p className="label-glass">{t('history')}</p>
        <div className="space-y-1 text-xs text-muted">
          {events.map(e => (
            <p key={e.id}>
              {new Date(e.createdAt).toLocaleString()} · {name(e.actorId)} · {e.action}
              {e.fromStatus ? ` ${t(('ts_' + e.fromStatus) as Key)} → ${t(('ts_' + (e.toStatus ?? '')) as Key)}` : ''}
              {e.note ? ` · ${e.note}` : ''}
            </p>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}
