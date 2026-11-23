import { FormEvent, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { GlassCard, GoldButton, Field, Logo, ErrorNote } from '../components/ui'
import { acceptInvitation, getSession, signUp } from '../lib/db'
import { useT } from '../i18n'

export default function InviteRegister() {
  const { t } = useT()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      // New family member: create their account first, then claim the code.
      const session = await getSession()
      if (!session) await signUp(email, password)
      await acceptInvitation(code, name.trim())
      navigate('/home', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invalidCode'))
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 fade-in">
        <Logo />
        <GlassCard className="space-y-4">
          <h1 className="text-xl font-bold">{t('joinWithCode')}</h1>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('inviteCode')} required value={code} dir="ltr"
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder={t('codePlaceholder')}
              pattern="HOME-[A-Z0-9]{4}-[A-Z0-9]{4}" />
            <Field label={t('fullName')} required value={name} onChange={e => setName(e.target.value)} />
            <Field label={t('email')} type="email" required value={email} dir="ltr"
              onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            <Field label={t('password')} type="password" required minLength={8} value={password} dir="ltr"
              onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            <ErrorNote message={error} />
            <GoldButton disabled={busy}>{t('join')}</GoldButton>
          </form>
        </GlassCard>
        <div className="text-center">
          <Link to="/login" className="text-muted hover:text-ivory text-sm transition">{t('login')} ←</Link>
        </div>
      </div>
    </div>
  )
}
