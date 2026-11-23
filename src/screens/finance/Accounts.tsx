import { FormEvent, useEffect, useState } from 'react'
import { GlassCard, GoldButton, Field, ErrorNote } from '../../components/ui'
import { MoneyText, SelectField, EmptyState, SectionTitle } from '../../components/finance'
import { listAccounts, addAccount, Account, ACCOUNT_TYPES } from '../../lib/finance'
import { getMyProfile, Profile } from '../../lib/db'
import { useT, Key } from '../../i18n'

export default function Accounts() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [items, setItems] = useState<Account[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState<string>('cash')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canManage = me?.role === 'owner'

  async function refresh() { setItems(await listAccounts()) }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => setItems([])) }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await addAccount(name.trim(), type)
      setName('')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') }
    finally { setBusy(false) }
  }

  const typeKey = (ty: string) => ('t_' + ty) as Key

  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('accounts')}</h1>
      {canManage && (
        <GlassCard className="space-y-4">
          <SectionTitle>{t('addAccount')}</SectionTitle>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('accountName')} required value={name} onChange={e => setName(e.target.value)} />
            <SelectField label={t('accType')} value={type} onChange={e => setType(e.target.value)}>
              {ACCOUNT_TYPES.map(ty => <option key={ty} value={ty}>{t(typeKey(ty))}</option>)}
            </SelectField>
            <ErrorNote message={error} />
            <GoldButton disabled={busy || !name.trim()}>{t('create')}</GoldButton>
          </form>
        </GlassCard>
      )}
      <div className="space-y-3">
        {items.length === 0 && <EmptyState text={t('emptyAccounts')} />}
        {items.map(a => (
          <GlassCard key={a.id} className="!p-4 flex items-center justify-between">
            <div>
              <p className="font-bold">{a.name}</p>
              <p className="text-xs text-muted">{t(typeKey(a.type))}</p>
            </div>
            <MoneyText cents={a.balanceCents} className="text-lg gold-text" />
          </GlassCard>
        ))}
      </div>
    </div>
  )
}
