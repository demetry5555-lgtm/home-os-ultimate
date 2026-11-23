import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassCard } from '../../components/ui'
import { MoneyText, EmptyState, SectionTitle } from '../../components/finance'
import { financeSummary, listTransactions, FinanceSummary, Transaction } from '../../lib/finance'
import { getMyProfile, Profile } from '../../lib/db'
import { useT, Key } from '../../i18n'

const SECTIONS: { to: string; key: Key }[] = [
  { to: '/home/finance/accounts', key: 'accounts' },
  { to: '/home/finance/transactions', key: 'recentTransactions' },
  { to: '/home/finance/loans', key: 'loans' },
  { to: '/home/finance/bills', key: 'bills' },
  { to: '/home/finance/salaries', key: 'salaries' },
  { to: '/home/finance/budgets', key: 'budgets' },
  { to: '/home/finance/reports', key: 'reports' },
]

export default function FinanceHub() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [s, setS] = useState<FinanceSummary | null>(null)
  const [tx, setTx] = useState<Transaction[]>([])
  useEffect(() => {
    getMyProfile().then(setMe)
    financeSummary().then(setS).catch(() => setS(null))
    listTransactions(5).then(setTx).catch(() => setTx([]))
  }, [])

  const catKey = (c: string) => ('cat_' + c) as Key

  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('finance')}</h1>

      <div className="grid grid-cols-3 gap-2">
        {SECTIONS.map(sec => (
          <Link key={sec.to} to={sec.to} className="glass p-3 text-center text-sm font-bold text-ivory hover:border-gold-electric/40 transition">
            {t(sec.key)}
          </Link>
        ))}
      </div>

      {s && (
        <GlassCard className="!p-4 flex justify-between items-center">
          <div>
            <p className="text-xs text-muted">{t('netThisMonth')}</p>
            <MoneyText cents={s.monthIncomeCents - s.monthExpenseCents} signed className="text-xl gold-text" />
          </div>
          <div className="text-end">
            <p className="text-xs text-muted">{t('totalBalance')}</p>
            <MoneyText cents={s.totalBalanceCents} className="text-lg" />
          </div>
        </GlassCard>
      )}

      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <SectionTitle>{t('recentTransactions')}</SectionTitle>
          <Link to="/home/finance/transactions" className="text-xs text-gold-soft">{t('viewAll')} ←</Link>
        </div>
        {tx.length === 0 && <EmptyState text={t('emptyTransactions')} />}
        {tx.map(x => (
          <GlassCard key={x.id} className="!p-3 flex items-center justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{x.description || t(catKey(x.category))}</p>
              <p className="text-xs text-muted">{t(catKey(x.category))} · {new Date(x.createdAt).toLocaleDateString()}</p>
            </div>
            <MoneyText
              cents={x.type === 'expense' ? -x.amountCents : x.amountCents}
              signed
              className={x.type === 'expense' ? 'text-red-300' : 'text-emerald-300'}
            />
          </GlassCard>
        ))}
      </div>

      {me?.role !== 'owner' && (
        <p className="text-center text-xs text-muted">view only</p>
      )}
    </div>
  )
}
