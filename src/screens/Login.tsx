import { FormEvent, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { GlassCard, GoldButton, GhostButton, Field, Logo, ErrorNote } from '../components/ui'
import { signIn, signUp } from '../lib/db'
import { useT } from '../i18n'
import { isCloud } from '../lib/supabase'

export default function Login() {
  const { t } = useT()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (mode === 'signin') await signIn(email, password)
      else await signUp(email, password)
      navigate('/gate', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 fade-in">
        <Logo />
        <GlassCard className="space-y-4">
          <h1 className="text-xl font-bold text-ivory">{t('welcomeBack')}</h1>
          {!isCloud && <p className="text-xs text-gold/70">{t('demoMode')}</p>}
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('email')} type="email" required value={email}
              onChange={e => setEmail(e.target.value)} dir="ltr" placeholder="you@example.com" />
            <Field label={t('password')} type="password" required minLength={8} value={password}
              onChange={e => setPassword(e.target.value)} dir="ltr" placeholder="••••••••" />
            <ErrorNote message={error} />
            <GoldButton disabled={busy}>{mode === 'signin' ? t('login') : t('createAccount')}</GoldButton>
          </form>
          <GhostButton className="w-full" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? t('createAccount') : t('login')}
          </GhostButton>
        </GlassCard>
        <div className="text-center">
          <Link to="/join" className="text-gold-soft hover:text-gold-electric transition text-sm font-semibold">
            {t('haveInvite')} ←
          </Link>
        </div>
      </div>
    </div>
  )
}
