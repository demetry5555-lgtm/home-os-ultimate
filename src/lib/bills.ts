import { supabase, isCloud } from './supabase'
import { demo, uid, getMyProfile } from './db'
import { Cents, dbToCents, centsToDb } from './money'

export const BILL_KINDS = ['bill', 'installment'] as const
export type BillKind = typeof BILL_KINDS[number]
export const BILL_RECURRENCES = ['once', 'monthly', 'quarterly', 'annual'] as const
export type BillRecurrence = typeof BILL_RECURRENCES[number]

export interface Bill {
  id: string; kind: BillKind; title: string; category: string
  amountCents: Cents; recurrence: BillRecurrence; dueDate: string
  loanId: string | null; accountId: string | null; note: string
  active: boolean; lastPaidAt: string | null; createdBy: string
}

interface DemoBill {
  id: string; kind: BillKind; title: string; category: string
  amount_cents: number; recurrence: BillRecurrence; due_date: string
  loan_id: string | null; account_id: string | null; note: string
  active: boolean; last_paid_at: string | null; created_by: string
}

function dload() {
  const s = demo.load() as ReturnType<typeof demo.load> & { bills?: DemoBill[] }
  if (!s.bills) s.bills = []
  return s
}

async function requireFinanceManage() {
  const me = await getMyProfile()
  if (!me || me.status !== 'active') throw new Error('not allowed')
  if (me.role !== 'owner' && me.role !== 'supervisor') throw new Error('not allowed')
  return me
}

export interface BillInput {
  kind: BillKind; title: string; category: string; amountCents: Cents
  recurrence: BillRecurrence; dueDate: string; loanId: string | null
  accountId: string | null; note: string
}

export async function addBill(input: BillInput): Promise<void> {
  const me = await requireFinanceManage()
  if (isCloud && supabase) {
    const { error } = await supabase.from('bills').insert({
      family_id: me.family_id, kind: input.kind, title: input.title, category: input.category,
      amount: centsToDb(input.amountCents), recurrence: input.recurrence, due_date: input.dueDate,
      loan_id: input.loanId, account_id: input.accountId, note: input.note, created_by: me.id,
    })
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  s.bills!.push({
    id: uid(), kind: input.kind, title: input.title, category: input.category,
    amount_cents: input.amountCents, recurrence: input.recurrence, due_date: input.dueDate,
    loan_id: input.loanId, account_id: input.accountId, note: input.note,
    active: true, last_paid_at: null, created_by: me.id,
  })
  demo.save(s)
}

function toBill(b: DemoBill): Bill {
  return {
    id: b.id, kind: b.kind, title: b.title, category: b.category,
    amountCents: b.amount_cents, recurrence: b.recurrence, dueDate: b.due_date,
    loanId: b.loan_id, accountId: b.account_id, note: b.note,
    active: b.active, lastPaidAt: b.last_paid_at, createdBy: b.created_by,
  }
}

export async function listBills(includeInactive = false): Promise<Bill[]> {
  if (isCloud && supabase) {
    let q = supabase.from('bills').select('*').order('due_date', { ascending: true })
    if (!includeInactive) q = q.eq('active', true)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []).map(b => ({
      id: b.id, kind: b.kind, title: b.title, category: b.category,
      amountCents: dbToCents(b.amount), recurrence: b.recurrence, dueDate: b.due_date,
      loanId: b.loan_id, accountId: b.account_id, note: b.note,
      active: b.active, lastPaidAt: b.last_paid_at, createdBy: b.created_by,
    }))
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) return []
  return s.bills!.filter(b => includeInactive || b.active).sort((a, b) => a.due_date.localeCompare(b.due_date)).map(toBill)
}

// Mirrors public.pay_bill(): record the expense, then advance the due date.
export async function payBill(billId: string, accountId: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('pay_bill', { p_bill_id: billId, p_account_id: accountId })
    if (error) throw new Error(error.message)
    return
  }
  await requireFinanceManage()
  const s = dload()
  const bill = s.bills!.find(b => b.id === billId)
  if (!bill) throw new Error('bill not found')
  if (!bill.active) throw new Error('bill is not active')
  const acc = s.accounts.find(a => a.id === accountId)
  if (!acc) throw new Error('account not found')
  if (acc.balance_cents < bill.amount_cents) throw new Error('insufficient funds')
  const me = s.profiles.find(p => p.id === s.session?.userId)!
  acc.balance_cents -= bill.amount_cents
  s.transactions.push({
    id: uid(), account_id: accountId, type: 'expense', amount_cents: bill.amount_cents,
    category: bill.category, description: 'Bill: ' + bill.title, member_id: null,
    receipt_path: null, related_transaction_id: null, created_by: me.id,
    created_at: new Date().toISOString(),
  })
  bill.last_paid_at = new Date().toISOString()
  if (bill.recurrence === 'once') {
    bill.active = false
  } else {
    const d = new Date(bill.due_date + 'T00:00:00')
    if (bill.recurrence === 'monthly') d.setMonth(d.getMonth() + 1)
    else if (bill.recurrence === 'quarterly') d.setMonth(d.getMonth() + 3)
    else d.setFullYear(d.getFullYear() + 1)
    const pad2 = (n: number) => String(n).padStart(2, '0')
    bill.due_date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  }
  demo.save(s)
}

export async function setBillActive(billId: string, active: boolean): Promise<void> {
  await requireFinanceManage()
  if (isCloud && supabase) {
    const { error } = await supabase.from('bills').update({ active }).eq('id', billId)
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  const bill = s.bills!.find(b => b.id === billId)
  if (!bill) throw new Error('bill not found')
  bill.active = active
  demo.save(s)
}

export async function deleteBill(billId: string): Promise<void> {
  await requireFinanceManage()
  if (isCloud && supabase) {
    const { error } = await supabase.from('bills').delete().eq('id', billId)
    if (error) throw new Error(error.message)
    return
  }
  const s = dload()
  s.bills = s.bills!.filter(b => b.id !== billId)
  demo.save(s)
}

// Bills due in [from, to] - powers the calendar and the reminders section.
export function billsDueBetween(bills: Bill[], from: string, to: string): Bill[] {
  return bills.filter(b => b.active && b.dueDate >= from && b.dueDate <= to)
}
