import { FormEvent, useEffect, useState } from 'react'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../../components/ui'
import { MoneyText, SelectField, EmptyState, SectionTitle } from '../../components/finance'
import {
  listSalaries, addSalary, paySalary, listSalaryPayments, listAccounts,
  Salary, SalaryPayment, Account,
} from '../../lib/finance'
import { getMyProfile, listMembers, Profile } from '../../lib/db'
import { parseAmount } from '../../lib/money'
import { useT } from '../../i18n'

export default function Salaries() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [items, setItems] = useState<Salary[]>([])
  const [payslips, setPayslips] = useState<SalaryPayment[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [profileId, setProfileId] = useState('')
  const [amount, setAmount] = useState('')
  const [payType, setPayType] = useState<'monthly' | 'daily'>('monthly')
  const [payday, setPayday] = useState('1')
  const [payFor, setPayFor] = useState<string | null>(null)
  const [bonus, setBonus] = useState('')
  const [deduction, setDeduction] = useState('')
  const [payAccount, setPayAccount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canManage = me?.role === 'owner'

  async function refresh() {
    const [ms, ss, ps, accs] = await Promise.all([listMembers(), listSalaries(), listSalaryPayments(), listAccounts()])
    setMembers(ms); setItems(ss); setPayslips(ps); setAccounts(accs)
    if (!payAccount && accs.length) setPayAccount(accs[0].id)
  }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => {}) }, [])

  const memberName = (id: string) => members.find(m => m.id === id)?.full_name ?? '—'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await addSalary(profileId, parseAmount(amount), payType, parseInt(payday, 10))
      setAmount(''); setProfileId('')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') }
    finally { setBusy(false) }
  }

  async function pay(salaryId: string) {
    setBusy(true); setError(null)
    try {
      await paySalary(salaryId, payAccount, bonus ? parseAmount(bonus) : 0, deduction ? parseAmount(deduction) : 0)
      setPayFor(null); setBonus(''); setDeduction('')
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error'
      setError(msg === 'insufficient funds' ? t('insufficientFunds') : msg)
    } finally { setBusy(false) }
  }

  const netPreview = (s: Salary) => {
    try {
      return s.amountCents + (bonus ? parseAmount(bonus) : 0) - (deduction ? parseAmount(deduction) : 0)
    } catch { return s.amountCents }
  }

  const eligible = members.filter(m => m.status === 'active' && !items.some(s => s.profileId === m.id && s.active))

  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('salaries')}</h1>

      {canManage && (
        <GlassCard className="space-y-4">
          <SectionTitle>{t('addSalary')}</SectionTitle>
          <form onSubmit={submit} className="space-y-4">
            <SelectField label={t('member')} required value={profileId} onChange={e => setProfileId(e.target.value)}>
              <option value="" disabled>—</option>
              {eligible.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </SelectField>
            <Field label={t('amount')} required inputMode="decimal" dir="ltr" value={amount}
              onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            <SelectField label={t('payType')} value={payType} onChange={e => setPayType(e.target.value as 'monthly' | 'daily')}>
              <option value="monthly">{t('monthly')}</option>
              <option value="daily">{t('daily')}</option>
            </SelectField>
            <Field label={t('payday')} type="number" min={1} max={31} required value={payday} onChange={e => setPayday(e.target.value)} />
            <ErrorNote message={error} />
            <GoldButton disabled={busy || !profileId || !amount}>{t('create')}</GoldButton>
          </form>
        </GlassCard>
      )}

      <div className="space-y-3">
        {items.length === 0 && <EmptyState text={t('emptySalaries')} />}
        {items.map(s => (
          <GlassCard key={s.id} className="!p-4 space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-bold">{memberName(s.profileId)}</p>
                <p className="text-xs text-muted">{s.payType === 'monthly' ? t('monthly') : t('daily')} · {t('payday')} {s.payday}</p>
              </div>
              <MoneyText cents={s.amountCents} className="gold-text" />
            </div>
            {canManage && (
              payFor === s.id ? (
                <div className="glass-inner p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t('bonus')} inputMode="decimal" dir="ltr" value={bonus} onChange={e => setBonus(e.target.value)} placeholder="0" />
                    <Field label={t('deduction')} inputMode="decimal" dir="ltr" value={deduction} onChange={e => setDeduction(e.target.value)} placeholder="0" />
                  </div>
                  <SelectField label={t('account')} value={payAccount} onChange={e => setPayAccount(e.target.value)}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </SelectField>
                  <div className="flex justify-between items-center rounded-xl bg-gold/10 px-3 py-2">
                    <span className="text-sm font-semibold">{t('net')}</span>
                    <MoneyText cents={netPreview(s)} className="gold-electric text-gold-electric" />
                  </div>
                  <GoldButton disabled={busy} onClick={() => pay(s.id)}>{t('paySalary')}</GoldButton>
                </div>
              ) : (
                <GhostButton className="w-full text-sm" onClick={() => setPayFor(s.id)}>{t('paySalary')}</GhostButton>
              )
            )}
          </GlassCard>
        ))}
      </div>

      <div className="space-y-2">
        <SectionTitle>{t('payslips')}</SectionTitle>
        {payslips.length === 0 && <EmptyState text={t('emptyPayslips')} />}
        {payslips.map(p => (
          <GlassCard key={p.id} className="!p-3 space-y-1">
            <div className="flex justify-between items-center">
              <p className="font-semibold text-sm">{memberName(p.profileId)} · <span dir="ltr" className="text-xs text-muted">{p.period}</span></p>
              <MoneyText cents={p.netCents} className="text-emerald-300" />
            </div>
            <p className="text-xs text-muted font-mono" dir="ltr">
              base {p.baseCents / 100} + bonus {p.bonusCents / 100} − deduction {p.deductionCents / 100}
            </p>
          </GlassCard>
        ))}
      </div>
    </div>
  )
}
