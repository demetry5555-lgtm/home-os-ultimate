import { supabase, isCloud } from './supabase'
import { demo, uid, getMyProfile } from './db'
import { Cents, dbToCents, centsToDb } from './money'
import { notify } from './notifications'

export const REQUEST_TYPES = ['money','purchase','outing','travel','booking','maintenance','leave','needs','document','help','custom'] as const
export type RequestType = typeof REQUEST_TYPES[number]
export const REQUEST_STATUSES = ['new','under_review','needs_info','approved','partially_approved','rejected','deferred','completed','cancelled'] as const
export type RequestStatus = typeof REQUEST_STATUSES[number]
export const PRIORITIES = ['low','normal','high','urgent'] as const
export type Priority = typeof PRIORITIES[number]

export interface FamilyRequest {
  id: string; requestNumber: number | null; requesterId: string; type: RequestType
  title: string; details: string; amountCents: Cents | null; priority: Priority
  status: RequestStatus; assigneeId: string | null; linkedTransactionId: string | null
  decidedBy: string | null; decidedAt: string | null; createdAt: string
}
export interface RequestComment { id: string; authorId: string; body: string; createdAt: string }
export interface RequestEvent { id: number; actorId: string; action: string; fromStatus: string | null; toStatus: string | null; reason: string; createdAt: string }

// Valid transitions, mirrors decide_request() in migration 0004.
const DECIDER_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  new: ['under_review','needs_info','approved','partially_approved','rejected','deferred'],
  under_review: ['needs_info','approved','partially_approved','rejected','deferred'],
  needs_info: ['under_review','approved','partially_approved','rejected','deferred'],
  approved: ['completed'],
  partially_approved: ['completed'],
  deferred: ['under_review','rejected'],
  rejected: [], completed: [], cancelled: [],
}
const CANCELLABLE: RequestStatus[] = ['new','under_review','needs_info','deferred']

interface DemoRequest {
  id: string; request_number: number; requester_id: string; type: RequestType
  title: string; details: string; amount_cents: number | null; priority: Priority
  status: RequestStatus; assignee_id: string | null; linked_transaction_id: string | null
  decided_by: string | null; decided_at: string | null; created_at: string
}
interface DemoRequestComment { id: string; request_id: string; author_id: string; body: string; created_at: string }
interface DemoRequestEvent { id: number; request_id: string; actor_id: string; action: string; from_status: string | null; to_status: string | null; reason: string; created_at: string }

declare module './db' {}
function dload() {
  const s = demo.load() as ReturnType<typeof demo.load> & {
    requests?: DemoRequest[]; requestComments?: DemoRequestComment[]; requestEvents?: DemoRequestEvent[]
  }
  if (!s.requests) s.requests = []
  if (!s.requestComments) s.requestComments = []
  if (!s.requestEvents) s.requestEvents = []
  return s
}

async function canDecide(): Promise<boolean> {
  const me = await getMyProfile()
  return !!me && me.status === 'active' && (me.role === 'owner' || me.role === 'supervisor')
}

function toReq(r: DemoRequest): FamilyRequest {
  return {
    id: r.id, requestNumber: r.request_number, requesterId: r.requester_id, type: r.type,
    title: r.title, details: r.details, amountCents: r.amount_cents, priority: r.priority,
    status: r.status, assigneeId: r.assignee_id, linkedTransactionId: r.linked_transaction_id,
    decidedBy: r.decided_by, decidedAt: r.decided_at, createdAt: r.created_at,
  }
}

export async function createRequest(input: {
  type: RequestType; title: string; details: string; amountCents: Cents | null; priority: Priority
}): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('requests').insert({
      family_id: me!.family_id, requester_id: me!.id, type: input.type,
      title: input.title, details: input.details,
      amount: input.amountCents == null ? null : centsToDb(input.amountCents),
      priority: input.priority,
    })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me || me.status !== 'active') throw new Error('not allowed')
  const num = (s.requests!.reduce((m, r) => Math.max(m, r.request_number), 0)) + 1
  s.requests!.push({
    id: uid(), request_number: num, requester_id: me.id, type: input.type,
    title: input.title, details: input.details, amount_cents: input.amountCents,
    priority: input.priority, status: 'new', assignee_id: null, linked_transaction_id: null,
    decided_by: null, decided_at: null, created_at: new Date().toISOString(),
  })
  demo.save(s)
}

export async function listRequests(): Promise<FamilyRequest[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('requests').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => ({
      id: r.id, requestNumber: r.request_number, requesterId: r.requester_id, type: r.type,
      title: r.title, details: r.details, amountCents: r.amount == null ? null : dbToCents(r.amount),
      priority: r.priority, status: r.status, assigneeId: r.assignee_id,
      linkedTransactionId: r.linked_transaction_id, decidedBy: r.decided_by,
      decidedAt: r.decided_at, createdAt: r.created_at,
    }))
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) return []
  const decider = me.role === 'owner' || me.role === 'supervisor'
  return s.requests!
    .filter(r => decider || r.requester_id === me.id)
    .slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(toReq)
}

export async function getRequest(id: string): Promise<FamilyRequest | null> {
  const all = await listRequests()
  return all.find(r => r.id === id) ?? null
}

export async function decideRequest(id: string, toStatus: RequestStatus, reason: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('decide_request', { p_request_id: id, p_to_status: toStatus, p_reason: reason })
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canDecide())) throw new Error('not allowed')
  const s = dload()
  const r = s.requests!.find(x => x.id === id)
  if (!r) throw new Error('request not found')
  if (!DECIDER_TRANSITIONS[r.status].includes(toStatus)) throw new Error('invalid transition')
  const from = r.status
  r.status = toStatus; r.decided_by = s.session!.userId; r.decided_at = new Date().toISOString()
  s.requestEvents!.push({
    id: (s.requestEvents!.length + 1), request_id: id, actor_id: s.session!.userId,
    action: 'decision', from_status: from, to_status: toStatus, reason, created_at: new Date().toISOString(),
  })
  demo.save(s)
  await notify(r.requester_id, 'request', 'Request ' + toStatus, reason || r.title).catch(() => {})
}

export async function cancelRequest(id: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('cancel_request', { p_request_id: id })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const r = s.requests!.find(x => x.id === id)
  if (!r) throw new Error('request not found')
  if (r.requester_id !== s.session?.userId) throw new Error('not allowed')
  if (!CANCELLABLE.includes(r.status)) throw new Error('cannot cancel a decided request')
  const from = r.status
  r.status = 'cancelled'; r.decided_by = s.session!.userId; r.decided_at = new Date().toISOString()
  s.requestEvents!.push({
    id: (s.requestEvents!.length + 1), request_id: id, actor_id: s.session!.userId,
    action: 'cancel', from_status: from, to_status: 'cancelled', reason: '', created_at: new Date().toISOString(),
  })
  demo.save(s)
}

export async function linkRequestTransaction(requestId: string, transactionId: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('link_request_transaction', { p_request_id: requestId, p_transaction_id: transactionId })
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canDecide())) throw new Error('not allowed')
  const s = dload()
  const r = s.requests!.find(x => x.id === requestId)
  if (!r) throw new Error('request not found')
  if (!['approved','partially_approved','completed'].includes(r.status)) throw new Error('only approved requests can be linked')
  r.linked_transaction_id = transactionId
  s.requestEvents!.push({
    id: (s.requestEvents!.length + 1), request_id: requestId, actor_id: s.session!.userId,
    action: 'link_transaction', from_status: null, to_status: null, reason: transactionId, created_at: new Date().toISOString(),
  })
  demo.save(s)
}

export async function listComments(requestId: string): Promise<RequestComment[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('request_comments').select('*').eq('request_id', requestId).order('created_at')
    if (error) throw new Error(error.message)
    return (data ?? []).map(c => ({ id: c.id, authorId: c.author_id, body: c.body, createdAt: c.created_at }))
  }
  const s = dload()
  return (s.requestComments ?? []).filter(c => c.request_id === requestId)
    .map(c => ({ id: c.id, authorId: c.author_id, body: c.body, createdAt: c.created_at }))
}

export async function addComment(requestId: string, body: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('request_comments').insert({ request_id: requestId, body })
    if (error) throw new Error(error.message)
    const req = await getRequest(requestId)
    if (req) await notify(req.requesterId, 'comment', 'New comment on request', req.title).catch(() => {})
    return
  }
  const s = dload()
  if (!s.session) throw new Error('not authenticated')
  s.requestComments!.push({ id: uid(), request_id: requestId, author_id: s.session.userId, body, created_at: new Date().toISOString() })
  demo.save(s)
  const req = s.requests!.find(x => x.id === requestId)
  if (req) await notify(req.requester_id, 'comment', 'New comment on request', req.title).catch(() => {})
}

export async function listEvents(requestId: string): Promise<RequestEvent[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('request_events').select('*').eq('request_id', requestId).order('created_at')
    if (error) throw new Error(error.message)
    return (data ?? []).map(e => ({
      id: e.id, actorId: e.actor_id, action: e.action, fromStatus: e.from_status,
      toStatus: e.to_status, reason: e.reason, createdAt: e.created_at,
    }))
  }
  const s = dload()
  return (s.requestEvents ?? []).filter(e => e.request_id === requestId)
    .map(e => ({ id: e.id, actorId: e.actor_id, action: e.action, fromStatus: e.from_status, toStatus: e.to_status, reason: e.reason, createdAt: e.created_at }))
}

export function nextStatuses(status: RequestStatus): RequestStatus[] {
  return DECIDER_TRANSITIONS[status]
}
export function canCancel(status: RequestStatus): boolean {
  return CANCELLABLE.includes(status)
}
export async function isDecider(): Promise<boolean> {
  return canDecide()
}
