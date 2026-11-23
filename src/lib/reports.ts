import { listTransactions, listAccounts, listSalaryPayments, Transaction, Account, SalaryPayment } from './finance'
import { listTasks, FamilyTask } from './tasks'
import { listMembers, Profile } from './db'
import { Cents } from './money'

export interface MonthlyFinanceReport {
  month: string  // 'YYYY-MM'
  incomeCents: Cents; expenseCents: Cents; netCents: Cents
  byCategory: { category: string; cents: Cents }[]
  byMember: { memberId: string | null; name: string; cents: Cents }[]
  balances: { name: string; type: string; cents: Cents }[]
  salaryCents: Cents
}

export function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function monthlyFinanceReport(month: string): Promise<MonthlyFinanceReport> {
  const [tx, accounts, salaries, members] = await Promise.all([
    listTransactions(1000), listAccounts(), listSalaryPayments(), listMembers(),
  ])
  const [y, m] = month.split('-').map(Number)
  const inMonth = (iso: string) => {
    const d = new Date(iso)
    return d.getFullYear() === y && d.getMonth() + 1 === m
  }
  const monthTx = tx.filter(x => inMonth(x.createdAt))
  const income = monthTx.filter(x => x.type === 'income').reduce((s, x) => s + x.amountCents, 0)
  const expenseTx = monthTx.filter(x => x.type === 'expense')
  const expense = expenseTx.reduce((s, x) => s + x.amountCents, 0)
  const cat = new Map<string, Cents>()
  for (const x of expenseTx) cat.set(x.category, (cat.get(x.category) ?? 0) + x.amountCents)
  const nameOf = (id: string | null) => members.find(p => p.id === id)?.full_name ?? 'Family'
  const per = new Map<string | null, Cents>()
  for (const x of expenseTx) {
    const who = x.memberId ?? x.createdBy
    per.set(who, (per.get(who) ?? 0) + x.amountCents)
  }
  const salaryCents = salaries.filter(p => inMonth(p.paidAt)).reduce((s, p) => s + p.netCents, 0)
  return {
    month, incomeCents: income, expenseCents: expense, netCents: income - expense,
    byCategory: [...cat.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents),
    byMember: [...per.entries()].map(([memberId, cents]) => ({ memberId, name: nameOf(memberId), cents })).sort((a, b) => b.cents - a.cents),
    balances: accounts.map(a => ({ name: a.name, type: a.type, cents: a.balanceCents })),
    salaryCents,
  }
}

export interface MemberTaskStats {
  memberId: string | null; name: string
  assigned: number; completed: number; open: number; overdue: number
  avgRating: number | null
}

export async function taskCompletionStats(): Promise<MemberTaskStats[]> {
  const [tasks, members] = await Promise.all([listTasks(), listMembers()])
  const today = new Date().toISOString().slice(0, 10)
  const groups = new Map<string | null, FamilyTask[]>()
  for (const t of tasks) {
    const key = t.assigneeId
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const nameOf = (id: string | null) => members.find((p: Profile) => p.id === id)?.full_name ?? 'Unassigned'
  return [...groups.entries()].map(([memberId, list]) => {
    const completed = list.filter(t => t.status === 'completed')
    const open = list.filter(t => !['completed', 'cancelled'].includes(t.status))
    const overdue = open.filter(t => t.dueDate && t.dueDate < today)
    const rated = completed.filter(t => t.rating != null)
    return {
      memberId, name: nameOf(memberId), assigned: list.length,
      completed: completed.length, open: open.length, overdue: overdue.length,
      avgRating: rated.length ? rated.reduce((s, t) => s + (t.rating ?? 0), 0) / rated.length : null,
    }
  }).sort((a, b) => b.completed - a.completed)
}

export type { Transaction, Account, SalaryPayment }
