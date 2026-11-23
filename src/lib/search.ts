import { listMembers } from './db'
import { listRequests } from './requests'
import { listTasks } from './tasks'
import { listTransactions } from './finance'
import { listRooms, listStages, listAssets, listMaintenance, listSuppliers } from './apartment'
import { listEvents } from './calendar'
import { listDocuments } from './documents'
import { formatAmount } from './money'

export interface SearchHit {
  section: string; id: string; title: string; subtitle: string; link: string
}

// One search across every section. Every source list is already scoped by
// RLS (cloud) or the demo mirror (local), so the searcher only ever sees
// what their permissions allow - no separate filtering needed.
export async function globalSearch(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const has = (...fields: (string | null | undefined)[]) =>
    fields.some(f => (f ?? '').toLowerCase().includes(q))

  const [members, requests, tasks, transactions, rooms, stages, assets, jobs, suppliers, events, docs] =
    await Promise.all([
      listMembers().catch(() => []), listRequests().catch(() => []), listTasks().catch(() => []),
      listTransactions(200).catch(() => []), listRooms().catch(() => []), listStages().catch(() => []),
      listAssets().catch(() => []), listMaintenance().catch(() => []), listSuppliers().catch(() => []),
      listEvents().catch(() => []), listDocuments().catch(() => []),
    ])

  const hits: SearchHit[] = []
  for (const m of members) {
    if (has(m.full_name, m.role)) hits.push({ section: 'members', id: m.id, title: m.full_name, subtitle: m.role, link: '/home/profile' })
  }
  for (const r of requests) {
    if (has(r.title, r.details, r.type)) hits.push({ section: 'requests', id: r.id, title: r.title, subtitle: `#${r.requestNumber} · ${r.status}`, link: `/home/requests/${r.id}` })
  }
  for (const t of tasks) {
    if (has(t.title, t.description)) hits.push({ section: 'tasks', id: t.id, title: t.title, subtitle: t.status, link: `/home/tasks/${t.id}` })
  }
  for (const x of transactions) {
    if (has(x.description, x.category)) hits.push({ section: 'finance', id: x.id, title: x.description || x.category, subtitle: `${x.type} · ${formatAmount(x.amountCents)}`, link: '/home/finance/transactions' })
  }
  for (const r of rooms) {
    if (has(r.name, r.notes, r.flooring, r.paintColor)) hits.push({ section: 'apartment', id: r.id, title: r.name, subtitle: 'room', link: `/home/apartment/rooms/${r.id}` })
  }
  for (const st of stages) {
    if (has(st.stage)) hits.push({ section: 'apartment', id: st.id, title: st.stage, subtitle: `stage · ${st.status}`, link: '/home/apartment' })
  }
  for (const a of assets) {
    if (has(a.name, a.brand, a.model, a.serial)) hits.push({ section: 'apartment', id: a.id, title: a.name, subtitle: `${a.kind}${a.brand ? ' · ' + a.brand : ''}`, link: '/home/apartment' })
  }
  for (const j of jobs) {
    if (has(j.title, j.description)) hits.push({ section: 'apartment', id: j.id, title: j.title, subtitle: `maintenance · ${j.status}`, link: '/home/apartment' })
  }
  for (const s of suppliers) {
    if (has(s.name, s.trade)) hits.push({ section: 'apartment', id: s.id, title: s.name, subtitle: `supplier · ${s.trade}`, link: '/home/apartment' })
  }
  for (const e of events) {
    if (has(e.title, e.description)) hits.push({ section: 'calendar', id: e.id, title: e.title, subtitle: e.startsAt.slice(0, 10), link: '/home/calendar' })
  }
  for (const d of docs) {
    if (has(d.title, d.path, ...d.tags)) hits.push({ section: 'documents', id: d.id, title: d.title, subtitle: d.category, link: '/home/documents' })
  }
  return hits.slice(0, 50)
}
