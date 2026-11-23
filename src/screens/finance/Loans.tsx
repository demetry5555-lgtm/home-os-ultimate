import { FormEvent, useEffect, useState } from 'react'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../../components/ui'
import { MoneyText, SelectField, EmptyState, SectionTitle, ProgressBar } from '../../components/finance'
import { listLoans, addLoan, repayLoan, listAccounts, canManageFinance, Loan, Account } from '../../lib/finance'
import { getMyProfile, Profile } from '../../lib/db'
import { parseAmount, formatAmount } from '../../lib/money'
import { useT } from '../../i18n'

export default function Loans() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [items, setItems] = useState<Loan[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [counterparty, setCounterparty] = useState('')
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('borrowed')
  const [principal, setPrincipal] = useState('')
  const [repayFor, setRepayFor] = useState<string | null>(null)
  const [repayAmount, setRepayAmount] = useState('')
  const [repayAccount, setRepayAccount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canAdd = me?.role === 'owner'
  const canRepay = me ? canManageFinance(me.role) : false

  async function refresh() {
    const [ls, accs] = await Promise.all([listLoans(), listAccounts()])
    setItems(ls); setAccounts(accs)
    if (!repayAccount && accs.length) setRepayAccount(accs[0].id)
  }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => {}) }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await addLoan(counterparty.trim(), direction, parseAmount(principal))
      setCounterparty(''); setPrincipal('')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') }
    finally { setBusy(false) }
  }

  async function repay(loanId: string, full: boolean) {
    setBusy(true); setError(null)
    try {
      const loan = items.find(l => l.id === loanId)!
      const cents = full ? loan.remainingCents : parseAmount(repayAmount)
      await repayLoan(loanId, repayAccount, cents)
      setRepayFor(null); setRepayAmount('')
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error'
      setError(msg === 'insufficient funds' ? t('insufficientFunds') : msg)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('loans')}</h1>

      {canAdd && (
        <GlassCard className="space-y-4">
          <SectionTitle>{t('addLoan')}</SectionTitle>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('counterparty')} required value={counterparty} onChange={e => setCounterparty(e.target.value)} />
            <SelectField label={t('accType')} value={direction} onChange={e => setDirection(e.target.value as 'lent' | 'borrowed')}>
              <option value="borrowed">{t('borrowed')}</option>
              <option value="lent">{t('lent')}</option>
            </SelectField>
            <Field label={t('principal')} required inputMode="decimal" dir="ltr" value={principal}
              onChange={e => setPrincipal(e.target.value)} placeholder="0.00" />
            <ErrorNote message={error} />
            <GoldButton disabled={busy || !counterparty.trim()}>{t('create')}</GoldButton>
          </form>
        </GlassCard>
      )}

      <div className="space-y-3">
        {items.length === 0 && <EmptyState text={t('emptyLoans')} />}
        {items.map(l => (
          <GlassCard key={l.id} className="!p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold">{l.counterparty}</p>
                <p className="text-xs text-muted">{l.direction === 'lent' ? t('lent') : t('borrowed')}</p>
              </div>
              {l.remainingCents === 0
                ? <span className="text-xs font-bold text-emerald-300 border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 rounded-full">{t('paidOff')}</span>
                : <MoneyText cents={l.remainingCents} className="text-gold-electric" />}
            </div>
            <ProgressBar value={l.principalCents - l.remainingCents} max={l.principalCents} />
            <p className="text-xs text-muted">
              {t('principal')}: <span dir="ltr" className="font-mono">{formatAmount(l.principalCents)}</span>
              {' · '}{t('remaining')}: <span dir="ltr" className="font-mono">{formatAmount(l.remainingCents)}</span>
            </p>
            {canRepay && l.remainingCents > 0 && (
              repayFor === l.id ? (
                <div className="glass-inner p-3 space-y-3">
                  <Field label={t('amount')} inputMode="decimal" dir="ltr" value={repayAmount}
                    onChange={e => setRepayAmount(e.target.value)} placeholder={formatAmount(l.remainingCents)} />
                  <SelectField label={t('account')} value={repayAccount} onChange={e => setRepayAccount(e.target.value)}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </SelectField>
                  <div className="flex gap-2">
                    <GoldButton className="flex-1" disabled={busy || !repayAmount} onClick={() => repay(l.id, false)}>{t('repay')}</GoldButton>
                    <GhostButton className="flex-1" disabled={busy} onClick={() => repay(l.id, true)}>{t('repayFull')}</GhostButton>
                  </div>
                </div>
              ) : (
                <GhostButton className="w-full text-sm" onClick={() => setRepayFor(l.id)}>{t('repay')}</GhostButton>
              )
            )}
          </GlassCard>
        ))}
      </div>
    </div>
  )
}
