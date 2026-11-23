import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../components/ui'
import { SectionTitle, SelectField } from '../components/finance'
import { getMyProfile, getFamilySettings, updateFamilySettings, Profile, FamilySettings } from '../lib/db'
import { exportBackup } from '../lib/export'
import { useT, Key, Lang } from '../i18n'

const CURRENCIES = ['EGP', 'USD', 'EUR', 'SAR', 'AED'] as const

export default function Settings() {
  const { t, lang, setLang } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [form, setForm] = useState<FamilySettings | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canManage = !!me && (me.role === 'owner' || me.role === 'supervisor')

  useEffect(() => {
    getMyProfile().then(setMe)
    getFamilySettings().then(setForm).catch(() => {})
  }, [])

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!form) return
    setBusy(true); setError(null); setSaved(false)
    try {
      await updateFamilySettings(form)
      setSaved(true)
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('settings')}</h1>

      <div className="space-y-2">
        <SectionTitle>{t('familyProfile')}</SectionTitle>
        <GlassCard className="!p-4">
          {form ? (
            <form onSubmit={submit} className="space-y-3">
              <Field label={t('familyName')} value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!canManage} />
              <Field label={t('city')} value={form.city}
                onChange={e => setForm({ ...form, city: e.target.value })} disabled={!canManage} />
              <SelectField label={t('currency')} value={form.currency}
                onChange={e => setForm({ ...form, currency: e.target.value })} disabled={!canManage}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </SelectField>
              <SelectField label={t('defaultLanguage')} value={form.defaultLanguage}
                onChange={e => setForm({ ...form, defaultLanguage: e.target.value as Lang })} disabled={!canManage}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </SelectField>
              <ErrorNote message={error} />
              {saved && <p className="text-emerald-300 text-sm">{t('saved')}</p>}
              {canManage && <GoldButton disabled={busy}>{t('save')}</GoldButton>}
            </form>
          ) : <p className="text-muted text-sm">{t('loading')}</p>}
        </GlassCard>
      </div>

      <div className="space-y-2">
        <SectionTitle>{t('myLanguage')}</SectionTitle>
        <GlassCard className="!p-4 flex items-center justify-between">
          <p className="text-sm">{lang === 'en' ? 'English' : 'العربية'}</p>
          <GhostButton onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} className="text-sm px-4 py-2">
            {t('switchLanguage')}
          </GhostButton>
        </GlassCard>
      </div>

      <div className="space-y-2">
        <SectionTitle>{t('preferences')}</SectionTitle>
        <Link to="/home/notifications" className="glass p-4 flex justify-between items-center hover:border-gold-electric/40 transition">
          <span className="text-sm font-bold">{t('notificationPreferences')}</span>
          <span className="text-gold-electric">←</span>
        </Link>
        {me?.role === 'owner' && (
          <Link to="/home/profile" className="glass p-4 flex justify-between items-center hover:border-gold-electric/40 transition">
            <span className="text-sm font-bold">{t('memberManagement')}</span>
            <span className="text-gold-electric">←</span>
          </Link>
        )}
      </div>

      {me?.role === 'owner' && (
        <div className="space-y-2">
          <SectionTitle>{t('dataBackup')}</SectionTitle>
          <GlassCard className="!p-4 space-y-3">
            <p className="text-xs text-muted">{t('backupHint')}</p>
            <GoldButton onClick={() => exportBackup().catch(err => setError(err.message))}>{t('exportBackup')}</GoldButton>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
