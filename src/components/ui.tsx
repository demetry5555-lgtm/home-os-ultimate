import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react'
import { Invitation } from '../lib/db'
import { useT, Key } from '../i18n'

export function GlassCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass p-6 ${className}`}>{children}</div>
}

export function GoldButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`btn-gold w-full ${props.className ?? ''}`} />
}

export function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`btn-ghost ${props.className ?? ''}`} />
}

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div>
      <label className="label-glass">{label}</label>
      <input {...props} className="input-glass" />
    </div>
  )
}

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { t, lang } = useT()
  const ar = lang === 'ar' // Arabic script must not be letter-spaced; Latin brand keeps the wide tracking
  return (
    <div className="text-center select-none whitespace-nowrap">
      <div className={`font-black gold-text ${ar ? 'tracking-normal' : 'tracking-[0.35em]'} ${size === 'lg' ? 'text-4xl' : size === 'sm' ? 'text-lg' : 'text-2xl'}`}>
        {t('appName')}
      </div>
      <div className={`${ar ? 'tracking-normal' : 'tracking-[0.6em]'} text-gold/70 font-semibold ${size === 'lg' ? 'text-sm mt-1' : size === 'sm' ? 'text-[9px] mt-0' : 'text-[10px] mt-0.5'}`}>
        {t('ultimate')}
      </div>
    </div>
  )
}

export function StatusBadge({ status }: { status: Invitation['status'] }) {
  const { t } = useT()
  const styles: Record<Invitation['status'], string> = {
    pending: 'text-gold-electric border-gold-electric/40 bg-gold-electric/10',
    accepted: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
    expired: 'text-muted border-muted/40 bg-muted/10',
    revoked: 'text-red-300 border-red-400/40 bg-red-400/10',
    draft: 'text-ivory/70 border-ivory/20 bg-white/5',
  }
  return (
    <span className={`text-xs font-bold px-3 py-1 rounded-full border ${styles[status]}`}>
      {t(('st_' + status) as Key)}
    </span>
  )
}

// Backend error strings -> UI language. Unknown messages pass through as-is.
const ERROR_KEYS: Record<string, Key> = {
  'not allowed': 'err_not_allowed',
  'not authenticated': 'err_not_authenticated',
  'insufficient funds': 'err_insufficient_funds',
  'invalid amount': 'err_invalid_amount',
  'account not found': 'err_account_not_found',
  'bill not found': 'err_bill_not_found',
  'bill is not active': 'err_bill_not_active',
  'task not found': 'err_task_not_found',
  'invalid transition': 'err_invalid_transition',
  'request not found': 'err_request_not_found',
  'file not found': 'err_file_not_found',
  'invalid or expired code': 'err_invalid_code',
  'code already used': 'err_code_used',
  'Invalid login credentials': 'err_bad_login',
}

export function ErrorNote({ message }: { message: string | null }) {
  const { t } = useT()
  if (!message) return null
  const key = ERROR_KEYS[message]
  return (
    <div className="rounded-2xl border border-red-400/30 bg-red-400/10 text-red-200 text-sm px-4 py-3">
      {key ? t(key) : message}
    </div>
  )
}
