import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GlassCard, GoldButton, Field, Logo, ErrorNote } from '../components/ui'
import { bootstrapOwner } from '../lib/db'
import { useT } from '../i18n'

export default function OwnerSetup() {
  const { t } = useT()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [family, setFamily] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await bootstrapOwner(name.trim(), family.trim())
      navigate('/home', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 fade-in">
        <Logo />
        <GlassCard className="space-y-4">
          <div>
            <h1 className="text-xl font-bold">{t('ownerSetupTitle')}</h1>
            <p className="text-sm text-muted mt-1">{t('ownerSetupSub')}</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('yourName')} required value={name} onChange={e => setName(e.target.value)} placeholder="عبدالله" />
            <Field label={t('familyName')} required value={family} onChange={e => setFamily(e.target.value)} placeholder="عائلة عبدالله" />
            <ErrorNote message={error} />
            <GoldButton disabled={busy || !name.trim() || !family.trim()}>{t('startFamily')}</GoldButton>
          </form>
          <p className="text-xs text-muted leading-relaxed">{t('secureInit')}</p>
        </GlassCard>
      </div>
    </div>
  )
}
