import { FormEvent, useEffect, useState } from 'react'
import { GlassCard, GoldButton, Field, StatusBadge, ErrorNote } from '../components/ui'
import { createInvitation, listInvitations, revokeInvitation, Invitation } from '../lib/db'
import { useT } from '../i18n'

export default function Invitations() {
  const { t } = useT()
  const [items, setItems] = useState<Invitation[]>([])
  const [name, setName] = useState('')
  const [newCode, setNewCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try { setItems(await listInvitations()) } catch (e) { setError(e instanceof Error ? e.message : 'error') }
  }
  useEffect(() => { refresh() }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNewCode(null)
    try {
      const code = await createInvitation(name.trim())
      setNewCode(code); setCopied(false); setName('')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') }
    finally { setBusy(false) }
  }

  async function copyCode() {
    if (!newCode) return
    await navigator.clipboard.writeText(newCode)
    setCopied(true)
  }

  async function shareCode() {
    if (!newCode) return
    if (navigator.share) {
      try { await navigator.share({ title: 'HOME OS', text: newCode }) } catch { /* dismissed */ }
    } else { await copyCode() }
  }

  async function revoke(id: string) {
    setError(null)
    try { await revokeInvitation(id); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'error') }
  }

  return (
    <div className="space-y-6 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('invitations')}</h1>

      <GlassCard className="space-y-4">
        <h2 className="font-bold">{t('newInvitation')}</h2>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('intendedName')} value={name} onChange={e => setName(e.target.value)} />
          <GoldButton disabled={busy}>{t('create')}</GoldButton>
        </form>
        <ErrorNote message={error} />
        {newCode && (
          <div className="glass-inner p-4 space-y-3 border-gold-electric/30">
            <p className="text-xs text-gold-soft">{t('codeShownOnce')}</p>
            <p dir="ltr" className="text-center font-mono text-2xl font-black tracking-[0.2em] gold-text select-all">
              {newCode}
            </p>
            <div className="flex gap-2">
              <button onClick={copyCode} className="btn-ghost flex-1 text-sm">{copied ? t('copied') : t('copy')}</button>
              <button onClick={shareCode} className="btn-ghost flex-1 text-sm">{t('share')}</button>
            </div>
          </div>
        )}
      </GlassCard>

      <div className="space-y-3">
        {items.map(inv => (
          <GlassCard key={inv.id} className="flex items-center justify-between gap-3 !p-4">
            <div className="min-w-0">
              <p className="font-bold truncate">{inv.intended_name || t('member')}</p>
              <p className="text-xs text-muted font-mono" dir="ltr">•••-{inv.code_hint} · {t('expiresAt')} {new Date(inv.expires_at).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={inv.status} />
              {inv.status === 'pending' && (
                <button onClick={() => revoke(inv.id)} className="text-xs text-red-300 hover:text-red-200 font-bold">
                  {t('revoke')}
                </button>
              )}
            </div>
          </GlassCard>
        ))}
        {items.length === 0 && <p className="text-center text-muted text-sm">—</p>}
      </div>
    </div>
  )
}
