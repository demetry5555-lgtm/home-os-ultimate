import { ReactNode, SelectHTMLAttributes } from 'react'
import { Cents, formatAmount } from '../lib/money'
import { useT } from '../i18n'

export function MoneyText({ cents, signed = false, className = '' }: { cents: Cents; signed?: boolean; className?: string }) {
  const { t } = useT()
  const sign = signed && cents !== 0 ? (cents > 0 ? '+' : '-') : ''
  return (
    <span dir="ltr" className={`font-mono font-bold ${className}`}>
      {sign}{formatAmount(Math.abs(cents))} <span className="text-[0.65em] font-semibold opacity-70">{t('egp')}</span>
    </span>
  )
}

export function SelectField({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label-glass">{label}</label>
      <select {...props} className="input-glass appearance-none">{children}</select>
    </div>
  )
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const over = max > 0 && value > max
  return (
    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${over ? 'bg-red-400' : 'bg-gradient-to-l from-gold-soft to-gold-electric'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="glass-inner p-6 text-center text-muted text-sm border-dashed">
      {text}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-black gold-text">{children}</h2>
}
