import { useEffect, useState } from 'react'
import { GlassCard, GhostButton } from '../../components/ui'
import { MoneyText, EmptyState, SectionTitle, ProgressBar } from '../../components/finance'
import { apartmentBudget, BudgetLine } from '../../lib/apartment'
import { monthlyFinanceReport, taskCompletionStats, MonthlyFinanceReport, MemberTaskStats, monthKeyOf } from '../../lib/reports'
import { getMyProfile, Profile } from '../../lib/db'
import { toCsv, downloadTextFile } from '../../lib/export'
import { formatAmount } from '../../lib/money'
import { useT, Key } from '../../i18n'

export default function Reports() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [month, setMonth] = useState(monthKeyOf(new Date()))
  const [fin, setFin] = useState<MonthlyFinanceReport | null>(null)
  const [apt, setApt] = useState<{ total: BudgetLine; lines: BudgetLine[] } | null>(null)
  const [stats, setStats] = useState<MemberTaskStats[]>([])
  const [loading, setLoading] = useState(true)

  const canViewFinance = !!me && (me.role === 'owner' || me.role === 'supervisor')

  useEffect(() => { getMyProfile().then(setMe) }, [])
  useEffect(() => {
    setLoading(true)
    Promise.all([
      monthlyFinanceReport(month).then(setFin).catch(() => setFin(null)),
      apartmentBudget().then(setApt).catch(() => setApt(null)),
      taskCompletionStats().then(setStats).catch(() => setStats([])),
    ]).finally(() => setLoading(false))
  }, [month])

  function moveMonth(n: number) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    setMonth(monthKeyOf(d))
  }

  const catKey = (c: string) => ('cat_' + c) as Key

  function exportFinanceCsv() {
    if (!fin) return
    const rows: (string | number | null)[][] = [
      [t('monthIncome'), formatAmount(fin.incomeCents)],
      [t('monthExpense'), formatAmount(fin.expenseCents)],
      [t('netThisMonth'), formatAmount(fin.netCents)],
      [t('salaries'), formatAmount(fin.salaryCents)],
      [],
      [t('topCategories')],
      ...fin.byCategory.map(c => [t(catKey(c.category)), formatAmount(c.cents)]),
      [],
      [t('byMember')],
      ...fin.byMember.map(x => [x.name, formatAmount(x.cents)]),
      [],
      [t('accounts')],
      ...fin.balances.map(b => [b.name, b.type, formatAmount(b.cents)]),
    ]
    downloadTextFile(`homeos-finance-${month}.csv`, toCsv(['HOME OS', month], rows))
  }

  function exportApartmentCsv() {
    if (!apt) return
    const lines = [apt.total, ...apt.lines]
    downloadTextFile(`homeos-apartment-budget.csv`, toCsv(
      [t('room'), t('planned'), t('actual'), t('remaining')],
      lines.map(l => [l.label, formatAmount(l.plannedCents), formatAmount(l.actualCents), formatAmount(l.plannedCents - l.actualCents)]),
    ))
  }

  function exportTasksCsv() {
    downloadTextFile(`homeos-task-stats.csv`, toCsv(
      [t('member'), t('assigned'), t('completedCount'), t('openCount'), t('overdue'), t('avgRating')],
      stats.map(s => [s.name, s.assigned, s.completed, s.open, s.overdue, s.avgRating?.toFixed(1) ?? '']),
    ))
  }

  const maxCat = fin?.byCategory[0]?.cents ?? 1

  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('reports')}</h1>

      <div className="flex items-center justify-center gap-4">
        <button onClick={() => moveMonth(-1)} className="text-muted hover:text-ivory px-2">‹</button>
        <p className="font-bold text-gold-soft">{month}</p>
        <button onClick={() => moveMonth(1)} className="text-muted hover:text-ivory px-2">›</button>
      </div>

      {loading && <p className="text-center text-muted text-sm">{t('loading')}</p>}

      {!loading && canViewFinance && fin && (
        <>
          <div className="flex items-center justify-between">
            <SectionTitle>{t('financeReport')}</SectionTitle>
            <GhostButton onClick={exportFinanceCsv} className="text-xs px-3 py-1.5">{t('exportCsv')}</GhostButton>
          </div>
          <GlassCard className="!p-4 space-y-3">
            <div className="flex justify-between"><span className="text-muted text-sm">{t('monthIncome')}</span><MoneyText cents={fin.incomeCents} className="text-emerald-300" /></div>
            <div className="flex justify-between"><span className="text-muted text-sm">{t('monthExpense')}</span><MoneyText cents={fin.expenseCents} className="text-red-300" /></div>
            <div className="flex justify-between"><span className="text-muted text-sm">{t('salariesPaid')}</span><MoneyText cents={fin.salaryCents} /></div>
            <div className="h-px bg-gold/15" />
            <div className="flex justify-between"><span className="font-bold">{t('netThisMonth')}</span><MoneyText cents={fin.netCents} signed className={fin.netCents >= 0 ? 'gold-text text-lg' : 'text-red-300 text-lg'} /></div>
          </GlassCard>

          <div className="space-y-2">
            <SectionTitle>{t('expensesByCategory')}</SectionTitle>
            {fin.byCategory.length === 0 && <EmptyState text={t('emptyTransactions')} />}
            {fin.byCategory.map(({ category, cents }) => (
              <GlassCard key={category} className="!p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{t(catKey(category))}</span>
                  <MoneyText cents={cents} />
                </div>
                <ProgressBar value={cents} max={maxCat} />
              </GlassCard>
            ))}
          </div>

          <div className="space-y-2">
            <SectionTitle>{t('expensesByMember')}</SectionTitle>
            {fin.byMember.length === 0 && <EmptyState text={t('emptyTransactions')} />}
            {fin.byMember.map(x => (
              <GlassCard key={x.memberId ?? 'family'} className="!p-3 flex justify-between text-sm">
                <span className="font-semibold">{x.name}</span>
                <MoneyText cents={x.cents} />
              </GlassCard>
            ))}
          </div>

          <div className="space-y-2">
            <SectionTitle>{t('walletBalances')}</SectionTitle>
            {fin.balances.map(b => (
              <GlassCard key={b.name} className="!p-3 flex justify-between text-sm">
                <span className="font-semibold">{b.name} <span className="text-xs text-muted">· {t(('t_' + b.type) as Key)}</span></span>
                <MoneyText cents={b.cents} />
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {!loading && apt && (apt.lines.length > 0 || apt.total.plannedCents > 0) && (
        <>
          <div className="flex items-center justify-between">
            <SectionTitle>{t('apartmentBudgetReport')}</SectionTitle>
            <GhostButton onClick={exportApartmentCsv} className="text-xs px-3 py-1.5">{t('exportCsv')}</GhostButton>
          </div>
          {[apt.total, ...apt.lines].map(l => (
            <GlassCard key={l.key} className="!p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{l.label}</span>
                <span className={`text-xs font-bold ${l.actualCents > l.plannedCents ? 'text-red-300' : 'text-emerald-300'}`}>
                  <MoneyText cents={l.actualCents} /> / <MoneyText cents={l.plannedCents} />
                </span>
              </div>
              <ProgressBar value={l.actualCents} max={l.plannedCents || 1} />
            </GlassCard>
          ))}
        </>
      )}

      {!loading && (
        <>
          <div className="flex items-center justify-between">
            <SectionTitle>{t('taskStats')}</SectionTitle>
            <GhostButton onClick={exportTasksCsv} className="text-xs px-3 py-1.5">{t('exportCsv')}</GhostButton>
          </div>
          {stats.length === 0 && <EmptyState text={t('emptyTasks')} />}
          {stats.map(s => (
            <GlassCard key={s.memberId ?? 'none'} className="!p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{s.name}</span>
                {s.avgRating != null && <span className="text-gold-electric text-xs font-bold">★ {s.avgRating.toFixed(1)}</span>}
              </div>
              <p className="text-xs text-muted">
                {t('completedCount')}: {s.completed} · {t('openCount')}: {s.open}
                {s.overdue > 0 ? ` · ${t('overdue')}: ${s.overdue}` : ''}
              </p>
            </GlassCard>
          ))}
        </>
      )}

      {!loading && me?.role === 'member' && (
        <p className="text-center text-xs text-muted">{t('reportsMemberNote')}</p>
      )}
    </div>
  )
}
