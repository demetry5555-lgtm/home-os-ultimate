import { supabase, isCloud } from './supabase'
import { demo, uid, getMyProfile } from './db'
import { Cents, dbToCents, centsToDb } from './money'
import { notify } from './notifications'

export const TASK_STATUSES = ['todo','in_progress','blocked','pending_approval','completed','cancelled'] as const
export type TaskStatus = typeof TASK_STATUSES[number]
export const RECURRENCES = ['none','daily','weekly','monthly'] as const
export type Recurrence = typeof RECURRENCES[number]
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export interface FamilyTask {
  id: string; title: string; description: string
  assigneeId: string | null; participants: string[]; priority: Priority
  startDate: string | null; dueDate: string | null; budgetCents: Cents | null
  status: TaskStatus; recurrence: Recurrence; requiresApproval: boolean
  rating: number | null; linkedRequestId: string | null; roomId: string | null
  createdBy: string; createdAt: string; completedAt: string | null; approvedBy: string | null
}
export interface TaskStep { id: string; title: string; done: boolean; position: number }
export interface TaskComment { id: number; authorId: string; body: string; createdAt: string }
export interface TaskEvent { id: number; actorId: string; action: string; fromStatus: string | null; toStatus: string | null; note: string; createdAt: string }

interface DemoTask {
  id: string; title: string; description: string
  assignee_id: string | null; participants: string[]; priority: Priority
  start_date: string | null; due_date: string | null; budget_cents: number | null
  status: TaskStatus; recurrence: Recurrence; requires_approval: boolean
  rating: number | null; linked_request_id: string | null; room_id: string | null
  created_by: string; created_at: string; completed_at: string | null; approved_by: string | null
}
interface DemoStep { id: string; task_id: string; title: string; done: boolean; position: number }
interface DemoTaskComment { id: number; task_id: string; author_id: string; body: string; created_at: string }
interface DemoTaskEvent { id: number; task_id: string; actor_id: string; action: string; from_status: string | null; to_status: string | null; note: string; created_at: string }

function dload() {
  const s = demo.load() as ReturnType<typeof demo.load> & {
    tasks?: DemoTask[]; taskSteps?: DemoStep[]; taskComments?: DemoTaskComment[]; taskEvents?: DemoTaskEvent[]
  }
  if (!s.tasks) s.tasks = []
  if (!s.taskSteps) s.taskSteps = []
  if (!s.taskComments) s.taskComments = []
  if (!s.taskEvents) s.taskEvents = []
  return s
}

function toTask(t: DemoTask): FamilyTask {
  return {
    id: t.id, title: t.title, description: t.description,
    assigneeId: t.assignee_id, participants: t.participants, priority: t.priority,
    startDate: t.start_date, dueDate: t.due_date, budgetCents: t.budget_cents,
    status: t.status, recurrence: t.recurrence, requiresApproval: t.requires_approval,
    rating: t.rating, linkedRequestId: t.linked_request_id, roomId: t.room_id,
    createdBy: t.created_by, createdAt: t.created_at, completedAt: t.completed_at, approvedBy: t.approved_by,
  }
}

function shiftDate(date: string | null, rec: Recurrence): string | null {
  if (!date) return null
  const d = new Date(date + 'T00:00:00Z')
  if (rec === 'daily') d.setUTCDate(d.getUTCDate() + 1)
  else if (rec === 'weekly') d.setUTCDate(d.getUTCDate() + 7)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}

export interface TaskInput {
  title: string; description: string; assigneeId: string | null; participants: string[]
  priority: Priority; startDate: string | null; dueDate: string | null; budgetCents: Cents | null
  recurrence: Recurrence; requiresApproval: boolean
  linkedRequestId: string | null; roomId: string | null
}

export async function createTask(input: TaskInput): Promise<string> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { data, error } = await supabase.from('tasks').insert({
      family_id: me!.family_id, title: input.title, description: input.description,
      assignee_id: input.assigneeId, participants: input.participants, priority: input.priority,
      start_date: input.startDate, due_date: input.dueDate,
      budget: input.budgetCents == null ? null : centsToDb(input.budgetCents),
      recurrence: input.recurrence, requires_approval: input.requiresApproval,
      linked_request_id: input.linkedRequestId, room_id: input.roomId, created_by: me!.id,
    }).select('id').single()
    if (error) throw new Error(error.message)
    for (const pid of [input.assigneeId, ...input.participants]) {
      if (pid) await notify(pid, 'task', 'New task assigned', input.title).catch(() => {})
    }
    return data.id as string
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me || me.status !== 'active') throw new Error('not allowed')
  const id = uid()
  s.tasks!.push({
    id, title: input.title, description: input.description,
    assignee_id: input.assigneeId, participants: input.participants, priority: input.priority,
    start_date: input.startDate, due_date: input.dueDate, budget_cents: input.budgetCents,
    status: 'todo', recurrence: input.recurrence, requires_approval: input.requiresApproval,
    rating: null, linked_request_id: input.linkedRequestId, room_id: input.roomId,
    created_by: me.id, created_at: new Date().toISOString(), completed_at: null, approved_by: null,
  })
  s.taskEvents!.push({ id: s.taskEvents!.length + 1, task_id: id, actor_id: me.id, action: 'create', from_status: null, to_status: 'todo', note: '', created_at: new Date().toISOString() })
  demo.save(s)
  for (const pid of [input.assigneeId, ...input.participants]) {
    if (pid) await notify(pid, 'task', 'New task assigned', input.title).catch(() => {})
  }
  return id
}

export async function listTasks(): Promise<FamilyTask[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => ({
      id: r.id, title: r.title, description: r.description,
      assigneeId: r.assignee_id, participants: r.participants ?? [], priority: r.priority,
      startDate: r.start_date, dueDate: r.due_date, budgetCents: r.budget == null ? null : dbToCents(r.budget),
      status: r.status, recurrence: r.recurrence, requiresApproval: r.requires_approval,
      rating: r.rating, linkedRequestId: r.linked_request_id, roomId: r.room_id,
      createdBy: r.created_by, createdAt: r.created_at, completedAt: r.completed_at, approvedBy: r.approved_by,
    }))
  }
  const s = dload()
  return s.tasks!.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toTask)
}

export async function getTask(id: string): Promise<FamilyTask | null> {
  const all = await listTasks()
  return all.find(t => t.id === id) ?? null
}

// Mirrors set_task_status() in migration 0005.
export async function setTaskStatus(taskId: string, toStatus: TaskStatus, note = ''): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('set_task_status', { p_task_id: taskId, p_to_status: toStatus, p_note: note })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  const t = s.tasks!.find(x => x.id === taskId)
  if (!me || !t) throw new Error('task not found')
  const approver = me.role === 'owner' || me.role === 'supervisor'
  const involved = t.created_by === me.id || t.assignee_id === me.id || t.participants.includes(me.id) || approver
  let valid = false
  switch (t.status) {
    case 'todo':
    case 'in_progress':
      valid = ['in_progress','blocked','todo','cancelled'].includes(toStatus)
        || (toStatus === 'pending_approval' && t.requires_approval)
        || (toStatus === 'completed' && !t.requires_approval)
      break
    case 'blocked':
      valid = ['todo','in_progress','cancelled'].includes(toStatus); break
    case 'pending_approval':
      valid = toStatus === 'completed' || toStatus === 'in_progress'; break
    default: valid = false
  }
  if (!valid) throw new Error('invalid transition')
  if ((t.status === 'pending_approval' && (toStatus === 'completed' || toStatus === 'in_progress')) || toStatus === 'cancelled') {
    if (!(approver || t.created_by === me.id)) throw new Error('not allowed')
  } else if (!involved) throw new Error('not allowed')

  const from = t.status
  t.status = toStatus
  t.completed_at = toStatus === 'completed' ? new Date().toISOString() : null
  if (toStatus === 'completed' && t.requires_approval) t.approved_by = me.id
  s.taskEvents!.push({ id: s.taskEvents!.length + 1, task_id: taskId, actor_id: me.id, action: 'status', from_status: from, to_status: toStatus, note, created_at: new Date().toISOString() })

  if (toStatus === 'completed' && t.recurrence !== 'none') {
    const newId = uid()
    s.tasks!.push({
      ...t, id: newId, status: 'todo', rating: null, completed_at: null, approved_by: null,
      start_date: shiftDate(t.start_date, t.recurrence), due_date: shiftDate(t.due_date, t.recurrence),
      created_at: new Date().toISOString(),
    })
    for (const step of s.taskSteps!.filter(x => x.task_id === taskId)) {
      s.taskSteps!.push({ id: uid(), task_id: newId, title: step.title, done: false, position: step.position })
    }
    s.taskEvents!.push({ id: s.taskEvents!.length + 1, task_id: newId, actor_id: me.id, action: 'recurrence', from_status: null, to_status: null, note: 'spawned from ' + taskId, created_at: new Date().toISOString() })
  }
  demo.save(s)
}

export async function rateTask(taskId: string, rating: number): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('rate_task', { p_task_id: taskId, p_rating: rating })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  const t = s.tasks!.find(x => x.id === taskId)
  if (!me || !t) throw new Error('task not found')
  if (!(me.role === 'owner' || me.role === 'supervisor')) throw new Error('not allowed')
  if (t.status !== 'completed') throw new Error('only completed tasks can be rated')
  if (rating < 1 || rating > 5) throw new Error('rating must be 1-5')
  t.rating = rating
  s.taskEvents!.push({ id: s.taskEvents!.length + 1, task_id: taskId, actor_id: me.id, action: 'rating', from_status: null, to_status: null, note: String(rating), created_at: new Date().toISOString() })
  demo.save(s)
}

export async function listSteps(taskId: string): Promise<TaskStep[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('task_steps').select('*').eq('task_id', taskId).order('position')
    if (error) throw new Error(error.message)
    return (data ?? []).map(x => ({ id: x.id, title: x.title, done: x.done, position: x.position }))
  }
  const s = dload()
  return s.taskSteps!.filter(x => x.task_id === taskId).sort((a, b) => a.position - b.position)
    .map(x => ({ id: x.id, title: x.title, done: x.done, position: x.position }))
}

export async function addStep(taskId: string, title: string): Promise<void> {
  if (isCloud && supabase) {
    const steps = await listSteps(taskId)
    const { error } = await supabase.from('task_steps').insert({ task_id: taskId, title, position: steps.length })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const pos = s.taskSteps!.filter(x => x.task_id === taskId).length
  s.taskSteps!.push({ id: uid(), task_id: taskId, title, done: false, position: pos })
  demo.save(s)
}

export async function toggleStep(stepId: string, done: boolean): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('task_steps').update({ done }).eq('id', stepId)
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const step = s.taskSteps!.find(x => x.id === stepId)
  if (step) { step.done = done; demo.save(s) }
}

export async function listTaskComments(taskId: string): Promise<TaskComment[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at')
    if (error) throw new Error(error.message)
    return (data ?? []).map(c => ({ id: c.id, authorId: c.author_id, body: c.body, createdAt: c.created_at }))
  }
  const s = dload()
  return s.taskComments!.filter(c => c.task_id === taskId)
    .map(c => ({ id: c.id, authorId: c.author_id, body: c.body, createdAt: c.created_at }))
}

export async function addTaskComment(taskId: string, body: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('task_comments').insert({ task_id: taskId, body })
    if (error) throw new Error(error.message)
    const task = await getTask(taskId)
    if (task) for (const pid of [task.createdBy, task.assigneeId]) {
      if (pid) await notify(pid, 'comment', 'New comment on task', task.title).catch(() => {})
    }
    return
  }
  const s = dload()
  if (!s.session) throw new Error('not authenticated')
  s.taskComments!.push({ id: s.taskComments!.length + 1, task_id: taskId, author_id: s.session.userId, body, created_at: new Date().toISOString() })
  demo.save(s)
  const task = s.tasks!.find(x => x.id === taskId)
  if (task) for (const pid of [task.created_by, task.assignee_id]) {
    if (pid) await notify(pid, 'comment', 'New comment on task', task.title).catch(() => {})
  }
}

export async function listTaskEvents(taskId: string): Promise<TaskEvent[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('task_events').select('*').eq('task_id', taskId).order('created_at')
    if (error) throw new Error(error.message)
    return (data ?? []).map(e => ({ id: e.id, actorId: e.actor_id, action: e.action, fromStatus: e.from_status, toStatus: e.to_status, note: e.note, createdAt: e.created_at }))
  }
  const s = dload()
  return s.taskEvents!.filter(e => e.task_id === taskId)
    .map(e => ({ id: e.id, actorId: e.actor_id, action: e.action, fromStatus: e.from_status, toStatus: e.to_status, note: e.note, createdAt: e.created_at }))
}

// Allowed next statuses for the current user - mirrors the SQL function.
export function nextTaskStatuses(t: FamilyTask, opts: { isApprover: boolean; isCreator: boolean; isActor: boolean }): TaskStatus[] {
  const out: TaskStatus[] = []
  const can = (s: TaskStatus) => out.push(s)
  switch (t.status) {
    case 'todo':
    case 'in_progress':
      if (opts.isActor) {
        if (t.status === 'todo') can('in_progress'); else can('todo')
        can('blocked')
        if (t.requiresApproval) can('pending_approval'); else can('completed')
      }
      if (opts.isApprover || opts.isCreator) can('cancelled')
      break
    case 'blocked':
      if (opts.isActor) { can('todo'); can('in_progress') }
      if (opts.isApprover || opts.isCreator) can('cancelled')
      break
    case 'pending_approval':
      if (opts.isApprover || opts.isCreator) { can('completed'); can('in_progress') }
      break
    default: break
  }
  return out
}
