import { FormEvent, useEffect, useState } from 'react'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../../components/ui'
import { MoneyText, EmptyState, SectionTitle, SelectField } from '../../components/finance'
import { Bill, BillInput, BILL_KINDS, BILL_RECURRENCES, addBill, deleteBill, listBills, payBill, setBillActive } from '../../lib/bills'
import { listAccounts, listLoans, Account, Loan, EXPENSE_CATEGORIES } from '../../lib/finance'
import { getMyProfile, Profile } from '../../lib/db'
import { parseAmount } from '../../lib/money'
import { useT, Key } from '../../i18n'

export default function Bills() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loans, setLoans] = useState<Loan[]>([])
  const [showForm, setShowForm] = useState(false)
  const [payFor, setPayFor] = useState<Bill | null>(null)
  const [payAccount, setPayAccount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [kind, setKind] = useState<BillInput['kind']>('bill')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>('utilities')
  const [amount, setAmount] = useState('')
  const [recurrence, setRecurrence] = useState<BillInput['recurrence']>('monthly')
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10))
  const [loanId, setLoanId] = useState('')

  const canManage = !!me && (me.role === 'owner' || me.role === 'supervisor')

  async function refresh() {
    setBills(await listBills(true).catch(() => []))
    setAccounts(await listAccounts().catch(() => []))
    setLoans(await listLoans().catch(() => []))
  }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => {}) }, [])

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true); setError(null)
    try {
      await addBill({
        kind, title: title.trim(), category, amountCents: parseAmount(amount),
        recurrence, dueDate, loanId: kind === 'installment' && loanId ? loanId : null,
        accountId: null, note: '',
      })
      setShowForm(false); setTitle(''); setAmount('')
      await refresh()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  async function pay() {
    if (!payFor || !payAccount) return
    setBusy(true); setError(null)
    try {
      await payBill(payFor.id, payAccount)
      setPayFor(null)
      await refresh()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const catKey = (c: string) => ('cat_' + c) as Key

  return (
    <div className="space-y-5 fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black gold-text">{t('bills')}</h1>
        {canManage && <GhostButton onClick={() => setShowForm(v => !v)} className="text-sm px-4 py-2">{t('addBill')}</GhostButton>}
      </div>

      {showForm && (
        <GlassCard className="!p-4">
          <form onSubmit={submit} className="space-y-3">
            <SelectField label={t('billKind')} value={kind} onChange={e => setKind(e.target.value as BillInput['kind'])}>
              {BILL_KINDS.map(k => <option key={k} value={k}>{t(('bk_' + k) as Key)}</option>)}
            </SelectField>
            <Field label={t('billTitle')} value={title} onChange={e => setTitle(e.target.value)} required />
            <SelectField label={t('category')} value={category} onChange={e => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{t(catKey(c))}</option>)}
            </SelectField>
            <Field label={t('amount')} value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" required />
            <SelectField label={t('recurrence')} value={recurrence} onChange={e => setRecurrence(e.target.value as BillInput['recurrence'])}>
              {BILL_RECURRENCES.map(r => <option key={r} value={r}>{t(('br_' + r) as Key)}</option>)}
            </SelectField>
            <Field label={t('dueDate')} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required />
            {kind === 'installment' && loans.length > 0 && (
              <SelectField label={t('linkedLoan')} value={loanId} onChange={e => setLoanId(e.target.value)}>
                <option value="">—</option>
                {loans.map(l => <option key={l.id} value={l.id}>{l.counterparty}</option>)}
              </SelectField>
            )}
            <ErrorNote message={error} />
            <GoldButton disabled={busy}>{t('addBill')}</GoldButton>
          </form>
        </GlassCard>
      )}

      {payFor && (
        <GlassCard className="!p-4 space-y-3">
          <p className="font-bold">{t('payBill')}: {payFor.title} — <MoneyText cents={payFor.amountCents} /></p>
          <SelectField label={t('account')} value={payAccount} onChange={e => setPayAccount(e.target.value)}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </SelectField>
          <div className="flex gap-2">
            <GoldButton disabled={busy || !payAccount} onClick={pay}>{t('confirmPayment')}</GoldButton>
            <GhostButton onClick={() => setPayFor(null)}>{t('cancel')}</GhostButton>
          </div>
        </GlassCard>
      )}
      <ErrorNote message={!showForm ? error : null} />

      <div className="space-y-2">
        {bills.length === 0 && <EmptyState text={t('emptyBills')} />}
        {bills.map(b => {
          const overdue = b.active && b.dueDate < today
          return (
            <GlassCard key={b.id} className={`!p-3 space-y-2 ${!b.active ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{b.title}</p>
                  <p className="text-xs text-muted">
                    {t(('bk_' + b.kind) as Key)} · {t(catKey(b.category))} · {t(('br_' + b.recurrence) as Key)}
                  </p>
                </div>
                <MoneyText cents={b.amountCents} className="gold-text" />
              </div>
              <div className="flex items-center justify-between">
                <p className={`text-xs font-bold ${overdue ? 'text-red-300' : 'text-muted'}`}>
                  {b.active ? `${t('dueDate')}: ${b.dueDate}` : t('billInactive')}{overdue ? ` · ${t('overdue')}` : ''}
                </p>
                {canManage && (
                  <div className="flex gap-2">
                    {b.active && (
                      <button onClick={() => { setPayFor(b); setPayAccount(accounts[0]?.id ?? '') }}
                        className="text-xs text-gold-electric hover:underline">{t('payBill')}</button>
                    )}
                    <button onClick={() => setBillActive(b.id, !b.active).then(refresh).catch(err => setError(err.message))}
                      className="text-xs text-muted hover:text-ivory">{b.active ? t('deactivate') : t('reactivate')}</button>
                    <button onClick={() => deleteBill(b.id).then(refresh).catch(err => setError(err.message))}
                      className="text-xs text-red-300 hover:underline">{t('delete')}</button>
                  </div>
                )}
              </div>
            </GlassCard>
          )
        })}
      </div>
      <SectionTitle>{t('billsCalendarNote')}</SectionTitle>
    </div>
  )
}
