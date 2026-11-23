import { FormEvent, useEffect, useState } from 'react'
import { GlassCard, GoldButton, Field, ErrorNote } from '../../components/ui'
import { MoneyText, SelectField, EmptyState, SectionTitle, ProgressBar } from '../../components/finance'
import { listBudgets, setBudget, canManageFinance, BudgetRow, EXPENSE_CATEGORIES } from '../../lib/finance'
import { getMyProfile, Profile } from '../../lib/db'
import { parseAmount } from '../../lib/money'
import { useT, Key } from '../../i18n'

export default function Budgets() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [items, setItems] = useState<BudgetRow[]>([])
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0])
  const [limit, setLimit] = useState('')
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canManage = me ? canManageFinance(me.role) : false

  async function refresh() { setItems(await listBudgets()) }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => setItems([])) }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await setBudget(category, parseAmount(limit), period, 'family', null)
      setLimit('')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') }
    finally { setBusy(false) }
  }

  const catKey = (c: string) => ('cat_' + c) as Key

  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('budgets')}</h1>

      {canManage && (
        <GlassCard className="space-y-4">
          <SectionTitle>{t('addBudget')}</SectionTitle>
          <form onSubmit={submit} className="space-y-4">
            <SelectField label={t('category')} value={category} onChange={e => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{t(catKey(c))}</option>)}
            </SelectField>
            <Field label={t('monthlyLimit')} required inputMode="decimal" dir="ltr" value={limit}
              onChange={e => setLimit(e.target.value)} placeholder="0.00" />
            <SelectField label={t('payType')} value={period} onChange={e => setPeriod(e.target.value as 'monthly' | 'annual')}>
              <option value="monthly">{t('monthly')}</option>
              <option value="annual">{t('reports')} / {t('monthly')} → {t('actual')}</option>
            </SelectField>
            <ErrorNote message={error} />
            <GoldButton disabled={busy || !limit}>{t('create')}</GoldButton>
          </form>
        </GlassCard>
      )}

      <div className="space-y-3">
        {items.length === 0 && <EmptyState text={t('emptyBudgets')} />}
        {items.map(b => (
          <GlassCard key={b.id} className="!p-4 space-y-2">
            <div className="flex justify-between items-baseline">
              <p className="font-bold">{t(catKey(b.category))}</p>
              <p dir="ltr" className={`text-sm font-black ${b.remainingCents < 0 ? 'text-red-300' : 'text-gold-electric'}`}>
                {b.limitCents > 0 ? Math.round((b.actualCents / b.limitCents) * 100) : 0}%
              </p>
            </div>
            <ProgressBar value={b.actualCents} max={b.limitCents} />
            <div className="flex justify-between text-xs text-muted">
              <span>{t('actual')}: <MoneyText cents={b.actualCents} className="text-ivory" /></span>
              <span>{t('planned')}: <MoneyText cents={b.limitCents} className="text-ivory" /></span>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  )
}
