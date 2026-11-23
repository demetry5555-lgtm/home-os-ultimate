import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassCard } from '../../components/ui'
import { MoneyText, EmptyState } from '../../components/finance'
import { financeSummary, FinanceSummary } from '../../lib/finance'
import { useT } from '../../i18n'

export default function Dashboard() {
  const { t } = useT()
  const [s, setS] = useState<FinanceSummary | null>(null)
  useEffect(() => { financeSummary().then(setS).catch(() => setS(null)) }, [])

  const cards: { key: string; label: string; cents: number; accent?: boolean }[] = s ? [
    { key: 'total', label: t('totalBalance'), cents: s.totalBalanceCents, accent: true },
    { key: 'income', label: t('monthIncome'), cents: s.monthIncomeCents },
    { key: 'expense', label: t('monthExpense'), cents: s.monthExpenseCents },
    { key: 'loans', label: t('openLoans'), cents: s.openLoansCents },
  ] : []

  const budgetPct = s && s.budgetPlannedCents > 0
    ? Math.round((s.budgetActualCents / s.budgetPlannedCents) * 100) : null

  return (
    <div className="space-y-4 fade-in">
      {s && cards.every(c => c.cents === 0) ? (
        <GlassCard>
          <EmptyState text={t('emptyAccounts')} />
          <Link to="/home/finance/accounts" className="btn-gold w-full mt-4 block text-center">{t('addAccount')}</Link>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {cards.map(c => (
            <GlassCard key={c.key} className={`!p-4 ${c.accent ? 'border-gold-electric/30' : ''}`}>
              <p className="text-xs text-muted">{c.label}</p>
              <MoneyText cents={c.cents} className={`text-lg ${c.accent ? 'gold-text' : ''}`} />
            </GlassCard>
          ))}
        </div>
      )}
      {budgetPct !== null && (
        <GlassCard className="!p-4">
          <div className="flex justify-between items-baseline">
            <p className="text-xs text-muted">{t('budgetUsed')}</p>
            <p dir="ltr" className="text-sm font-black text-gold-electric">{budgetPct}%</p>
          </div>
          <div className="h-2 mt-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div className={`h-full rounded-full ${budgetPct > 100 ? 'bg-red-400' : 'bg-gradient-to-l from-gold-soft to-gold-electric'}`}
              style={{ width: `${Math.min(100, budgetPct)}%` }} />
          </div>
        </GlassCard>
      )}
      <Link to="/home/finance" className="glass block p-4 text-center font-bold text-gold-soft hover:text-gold-electric transition">
        {t('finance')} ←
      </Link>
    </div>
  )
}
