import { supabase, isCloud } from './supabase'
import { demo, uid, getMyProfile } from './db'
import { Cents, dbToCents, centsToDb } from './money'

export interface Account {
  id: string; name: string; type: string; balanceCents: Cents
  currency: string; ownerProfileId: string | null
}
export interface Transaction {
  id: string; accountId: string; type: 'income' | 'expense' | 'transfer'
  amountCents: Cents; category: string; description: string
  memberId: string | null; receiptPath: string | null; createdAt: string
  createdBy: string | null
}
export interface Loan {
  id: string; counterparty: string; direction: 'lent' | 'borrowed'
  principalCents: Cents; remainingCents: Cents; profileId: string | null
}
export interface Salary {
  id: string; profileId: string; amountCents: Cents
  payType: 'monthly' | 'daily'; payday: number; active: boolean
}
export interface SalaryPayment {
  id: string; profileId: string; period: string
  baseCents: Cents; bonusCents: Cents; deductionCents: Cents; netCents: Cents
  paidAt: string
}
export interface BudgetRow {
  id: string; category: string; limitCents: Cents; actualCents: Cents
  remainingCents: Cents; period: 'monthly' | 'annual'; scope: string; month: string
}
export interface FinanceSummary {
  totalBalanceCents: Cents; monthIncomeCents: Cents; monthExpenseCents: Cents
  openLoansCents: Cents; budgetPlannedCents: Cents; budgetActualCents: Cents
}

export const ACCOUNT_TYPES = ['cash', 'bank', 'wallet', 'vault', 'card', 'member'] as const
export const EXPENSE_CATEGORIES = ['groceries', 'utilities', 'transport', 'health', 'education', 'apartment', 'salary', 'loan_repayment', 'entertainment', 'other'] as const
export const INCOME_CATEGORIES = ['salary_income', 'business', 'gift', 'loan_repayment', 'other'] as const

function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function inMonth(iso: string, month: string, period: 'monthly' | 'annual' = 'monthly'): boolean {
  const t = new Date(iso)
  const [y, m] = month.split('-').map(Number)
  if (period === 'annual') return t.getFullYear() === y
  return t.getFullYear() === y && t.getMonth() + 1 === m
}

// finance.manage: owner + supervisor (mirrors role_permissions).
async function requireFinanceManage(): Promise<void> {
  const me = await getMyProfile()
  if (!me || me.status !== 'active') throw new Error('not allowed')
  if (me.role !== 'owner' && me.role !== 'supervisor') throw new Error('not allowed')
}

// owner-only: accounts, loans, salaries administration (mirrors RLS owner policies).
async function requireOwner(): Promise<void> {
  const me = await getMyProfile()
  if (!me || me.status !== 'active' || me.role !== 'owner') throw new Error('not allowed')
}

export function canManageFinance(role: string): boolean {
  return role === 'owner' || role === 'supervisor'
}

/* -------------------------------- Accounts ------------------------------- */

export async function listAccounts(): Promise<Account[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('accounts').select('*').order('created_at')
    if (error) throw new Error(error.message)
    return (data ?? []).map(a => ({
      id: a.id, name: a.name, type: a.type, balanceCents: dbToCents(a.balance),
      currency: a.currency, ownerProfileId: a.owner_profile_id,
    }))
  }
  return demo.load().accounts.map(a => ({
    id: a.id, name: a.name, type: a.type, balanceCents: a.balance_cents,
    currency: a.currency, ownerProfileId: a.owner_profile_id,
  }))
}

export async function addAccount(name: string, type: string, ownerProfileId: string | null = null): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('accounts')
      .insert({ name, type, family_id: me!.family_id, owner_profile_id: ownerProfileId })
    if (error) throw new Error(error.message)
    return
  }
  await requireOwner()
  const s = demo.load()
  if (s.accounts.some(a => a.name === name)) throw new Error('account name already exists')
  s.accounts.push({ id: uid(), name, type, balance_cents: 0, currency: 'EGP', owner_profile_id: ownerProfileId })
  demo.save(s)
}

/* ------------------------------ Transactions ----------------------------- */

export async function recordIncome(accountId: string, amount: Cents, category: string, description: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('record_income', {
      p_account_id: accountId, p_amount: centsToDb(amount), p_category: category, p_description: description,
    })
    if (error) throw new Error(error.message)
    return
  }
  await requireFinanceManage()
  const s = demo.load()
  const acc = s.accounts.find(a => a.id === accountId)
  if (!acc) throw new Error('account not found')
  acc.balance_cents += amount
  s.transactions.push({
    id: uid(), account_id: accountId, type: 'income', amount_cents: amount,
    category, description, member_id: null, receipt_path: null,
    related_transaction_id: null, created_by: s.session!.userId, created_at: new Date().toISOString(),
  })
  demo.save(s)
}

export async function recordExpense(
  accountId: string, amount: Cents, category: string,
  description: string, receiptPath: string | null = null, memberId: string | null = null,
  roomId: string | null = null, stageId: string | null = null, maintenanceId: string | null = null,
): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('record_expense', {
      p_account_id: accountId, p_amount: centsToDb(amount), p_category: category,
      p_description: description, p_receipt_path: receiptPath, p_member_id: memberId,
      p_room_id: roomId, p_stage_id: stageId, p_maintenance_id: maintenanceId,
    })
    if (error) throw new Error(error.message)
    return
  }
  await requireFinanceManage()
  const s = demo.load()
  const acc = s.accounts.find(a => a.id === accountId)
  if (!acc) throw new Error('account not found')
  if (acc.balance_cents < amount) throw new Error('insufficient funds')
  acc.balance_cents -= amount
  s.transactions.push({
    id: uid(), account_id: accountId, type: 'expense', amount_cents: amount,
    category, description, member_id: memberId, receipt_path: receiptPath,
    related_transaction_id: null, created_by: s.session!.userId, created_at: new Date().toISOString(),
    room_id: roomId, stage_id: stageId, maintenance_id: maintenanceId,
  })
  demo.save(s)
}

export async function transfer(fromId: string, toId: string, amount: Cents, description: string): Promise<void> {
  if (fromId === toId) throw new Error('same account')
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('transfer_funds', {
      p_from_account: fromId, p_to_account: toId, p_amount: centsToDb(amount), p_description: description,
    })
    if (error) throw new Error(error.message)
    return
  }
  await requireFinanceManage()
  const s = demo.load()
  const from = s.accounts.find(a => a.id === fromId)
  const to = s.accounts.find(a => a.id === toId)
  if (!from || !to) throw new Error('account not found')
  if (from.balance_cents < amount) throw new Error('insufficient funds')
  from.balance_cents -= amount
  to.balance_cents += amount
  const outId = uid()
  const now = new Date().toISOString()
  s.transactions.push({
    id: outId, account_id: fromId, type: 'transfer', amount_cents: amount, category: 'transfer',
    description, member_id: null, receipt_path: null, related_transaction_id: null,
    created_by: s.session!.userId, created_at: now,
  })
  s.transactions.push({
    id: uid(), account_id: toId, type: 'transfer', amount_cents: amount, category: 'transfer',
    description, member_id: null, receipt_path: null, related_transaction_id: outId,
    created_by: s.session!.userId, created_at: now,
  })
  demo.save(s)
}

export async function listTransactions(limit = 50): Promise<Transaction[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('transactions')
      .select('*').order('created_at', { ascending: false }).limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []).map(t => ({
      id: t.id, accountId: t.account_id, type: t.type, amountCents: dbToCents(t.amount),
      category: t.category, description: t.description, memberId: t.member_id,
      receiptPath: t.receipt_path, createdAt: t.created_at, createdBy: t.created_by ?? null,
    }))
  }
  return demo.load().transactions
    .slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
    .map(t => ({
      id: t.id, accountId: t.account_id, type: t.type, amountCents: t.amount_cents,
      category: t.category, description: t.description, memberId: t.member_id,
      receiptPath: t.receipt_path, createdAt: t.created_at, createdBy: t.created_by ?? null,
    }))
}

/* --------------------------------- Loans --------------------------------- */

export async function addLoan(counterparty: string, direction: 'lent' | 'borrowed', principal: Cents, profileId: string | null = null): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('loans').insert({
      family_id: me!.family_id, counterparty, direction,
      principal: centsToDb(principal), remaining: centsToDb(principal), profile_id: profileId,
    })
    if (error) throw new Error(error.message)
    return
  }
  await requireOwner()
  const s = demo.load()
  s.loans.push({ id: uid(), counterparty, direction, principal_cents: principal, remaining_cents: principal, profile_id: profileId })
  demo.save(s)
}

export async function listLoans(): Promise<Loan[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('loans').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map(l => ({
      id: l.id, counterparty: l.counterparty, direction: l.direction,
      principalCents: dbToCents(l.principal), remainingCents: dbToCents(l.remaining), profileId: l.profile_id,
    }))
  }
  return demo.load().loans.map(l => ({
    id: l.id, counterparty: l.counterparty, direction: l.direction,
    principalCents: l.principal_cents, remainingCents: l.remaining_cents, profileId: l.profile_id,
  }))
}

export async function repayLoan(loanId: string, accountId: string, amount: Cents): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('repay_loan', {
      p_loan_id: loanId, p_account_id: accountId, p_amount: centsToDb(amount),
    })
    if (error) throw new Error(error.message)
    return
  }
  await requireFinanceManage()
  const s = demo.load()
  const loan = s.loans.find(l => l.id === loanId)
  if (!loan) throw new Error('loan not found')
  if (amount > loan.remaining_cents) throw new Error('amount exceeds remaining balance')
  const acc = s.accounts.find(a => a.id === accountId)
  if (!acc) throw new Error('account not found')
  if (loan.direction === 'borrowed') {
    if (acc.balance_cents < amount) throw new Error('insufficient funds')
    acc.balance_cents -= amount
  } else {
    acc.balance_cents += amount
  }
  loan.remaining_cents -= amount
  const txId = uid()
  s.transactions.push({
    id: txId, account_id: accountId, type: loan.direction === 'borrowed' ? 'expense' : 'income',
    amount_cents: amount, category: 'loan_repayment', description: 'loan repayment',
    member_id: loan.profile_id, receipt_path: null, related_transaction_id: null,
    created_by: s.session!.userId, created_at: new Date().toISOString(),
  })
  s.loanPayments.push({ id: uid(), loan_id: loanId, transaction_id: txId, amount_cents: amount, paid_at: new Date().toISOString() })
  demo.save(s)
}

/* -------------------------------- Salaries ------------------------------- */

export async function addSalary(profileId: string, amount: Cents, payType: 'monthly' | 'daily', payday: number): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('salaries').insert({
      family_id: me!.family_id, profile_id: profileId,
      amount: centsToDb(amount), pay_type: payType, payday,
    })
    if (error) throw new Error(error.message)
    return
  }
  await requireOwner()
  const s = demo.load()
  if (s.salaries.some(x => x.profile_id === profileId && x.active)) throw new Error('member already has a salary')
  s.salaries.push({ id: uid(), profile_id: profileId, amount_cents: amount, pay_type: payType, payday, active: true })
  demo.save(s)
}

export async function listSalaries(): Promise<Salary[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('salaries').select('*')
    if (error) throw new Error(error.message)
    return (data ?? []).map(x => ({
      id: x.id, profileId: x.profile_id, amountCents: dbToCents(x.amount),
      payType: x.pay_type, payday: x.payday, active: x.active,
    }))
  }
  return demo.load().salaries.map(x => ({
    id: x.id, profileId: x.profile_id, amountCents: x.amount_cents,
    payType: x.pay_type, payday: x.payday, active: x.active,
  }))
}

export async function paySalary(salaryId: string, accountId: string, bonus: Cents, deduction: Cents): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('pay_salary', {
      p_salary_id: salaryId, p_account_id: accountId,
      p_bonus: centsToDb(bonus), p_deduction: centsToDb(deduction),
    })
    if (error) throw new Error(error.message)
    return
  }
  await requireOwner()
  const s = demo.load()
  const sal = s.salaries.find(x => x.id === salaryId && x.active)
  if (!sal) throw new Error('salary not found')
  const net = sal.amount_cents + bonus - deduction
  if (net <= 0) throw new Error('net pay must be positive')
  const period = monthKey()
  if (s.salaryPayments.some(p => p.salary_id === salaryId && p.period === period)) {
    throw new Error('already paid for this period')
  }
  const acc = s.accounts.find(a => a.id === accountId)
  if (!acc) throw new Error('account not found')
  if (acc.balance_cents < net) throw new Error('insufficient funds')
  acc.balance_cents -= net
  const txId = uid()
  s.transactions.push({
    id: txId, account_id: accountId, type: 'expense', amount_cents: net, category: 'salary',
    description: `salary ${period}`, member_id: sal.profile_id, receipt_path: null,
    related_transaction_id: null, created_by: s.session!.userId, created_at: new Date().toISOString(),
  })
  s.salaryPayments.push({
    id: uid(), salary_id: salaryId, profile_id: sal.profile_id, period,
    base_cents: sal.amount_cents, bonus_cents: bonus, deduction_cents: deduction,
    net_cents: net, transaction_id: txId, paid_at: new Date().toISOString(),
  })
  demo.save(s)
}

export async function listSalaryPayments(): Promise<SalaryPayment[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('salary_payments').select('*').order('paid_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map(p => ({
      id: p.id, profileId: p.profile_id, period: p.period,
      baseCents: dbToCents(p.base), bonusCents: dbToCents(p.bonus),
      deductionCents: dbToCents(p.deduction), netCents: dbToCents(p.net), paidAt: p.paid_at,
    }))
  }
  return demo.load().salaryPayments.slice().reverse().map(p => ({
    id: p.id, profileId: p.profile_id, period: p.period,
    baseCents: p.base_cents, bonusCents: p.bonus_cents,
    deductionCents: p.deduction_cents, netCents: p.net_cents, paidAt: p.paid_at,
  }))
}

/* -------------------------------- Budgets -------------------------------- */

export async function setBudget(category: string, limit: Cents, period: 'monthly' | 'annual', scope: 'family' | 'apartment' | 'member', scopeId: string | null): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('budgets').upsert({
      family_id: me!.family_id, category, monthly_limit: centsToDb(limit),
      month: monthKey(), period, scope, scope_id: scopeId,
    }, { onConflict: 'family_id,category,month' })
    if (error) throw new Error(error.message)
    return
  }
  await requireFinanceManage()
  const s = demo.load()
  const month = monthKey()
  const existing = s.budgets.find(b => b.category === category && b.month === month && b.scope === scope && b.scope_id === scopeId)
  if (existing) existing.limit_cents = limit
  else s.budgets.push({ id: uid(), category, limit_cents: limit, month, period, scope, scope_id: scopeId })
  demo.save(s)
}

export async function listBudgets(): Promise<BudgetRow[]> {
  const month = monthKey()
  if (isCloud && supabase) {
    const { data, error } = await supabase.rpc('budget_report', { p_month: month })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: Record<string, string>) => ({
      id: r.budget_id, category: r.category, limitCents: dbToCents(r.planned),
      actualCents: dbToCents(r.actual), remainingCents: dbToCents(r.remaining),
      period: 'monthly' as const, scope: r.scope, month,
    }))
  }
  const s = demo.load()
  return s.budgets.filter(b => b.month === month).map(b => {
    const actual = s.transactions
      .filter(t => t.type === 'expense' && t.category === b.category && inMonth(t.created_at, month, b.period))
      .filter(t => b.scope === 'family' || (b.scope === 'member' && t.member_id === b.scope_id) || b.scope === 'apartment')
      .reduce((sum, t) => sum + t.amount_cents, 0)
    return {
      id: b.id, category: b.category, limitCents: b.limit_cents,
      actualCents: actual, remainingCents: b.limit_cents - actual,
      period: b.period, scope: b.scope, month: b.month,
    }
  })
}

/* -------------------------------- Summary -------------------------------- */

export async function financeSummary(): Promise<FinanceSummary> {
  const month = monthKey()
  if (isCloud && supabase) {
    const { data, error } = await supabase.rpc('finance_summary', { p_month: month })
    if (error) throw new Error(error.message)
    const r = (data ?? [])[0]
    if (!r) return { totalBalanceCents: 0, monthIncomeCents: 0, monthExpenseCents: 0, openLoansCents: 0, budgetPlannedCents: 0, budgetActualCents: 0 }
    return {
      totalBalanceCents: dbToCents(r.total_balance), monthIncomeCents: dbToCents(r.month_income),
      monthExpenseCents: dbToCents(r.month_expense), openLoansCents: dbToCents(r.open_loans_remaining),
      budgetPlannedCents: dbToCents(r.budget_planned), budgetActualCents: dbToCents(r.budget_actual),
    }
  }
  const s = demo.load()
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const monthTx = s.transactions.filter(t => inMonth(t.created_at, month))
  const monthBudgets = s.budgets.filter(b => b.month === month)
  const budgetedCats = new Set(monthBudgets.map(b => b.category))
  return {
    totalBalanceCents: sum(s.accounts.map(a => a.balance_cents)),
    monthIncomeCents: sum(monthTx.filter(t => t.type === 'income').map(t => t.amount_cents)),
    monthExpenseCents: sum(monthTx.filter(t => t.type === 'expense').map(t => t.amount_cents)),
    openLoansCents: sum(s.loans.filter(l => l.remaining_cents > 0).map(l => l.remaining_cents)),
    budgetPlannedCents: sum(monthBudgets.map(b => b.limit_cents)),
    budgetActualCents: sum(monthTx.filter(t => t.type === 'expense' && budgetedCats.has(t.category)).map(t => t.amount_cents)),
  }
}
