import { FormEvent, useEffect, useRef, useState } from 'react'
import { GlassCard, GoldButton, Field, ErrorNote } from '../components/ui'
import { avatarDisplayUrl, getMyProfile, listMembers, setMemberStatus, setMemberRole, updateMyProfile, uploadMyAvatar, Profile } from '../lib/db'
import { useT } from '../i18n'

const OWNER_PERMS = ['family.manage','invitations.manage','finance.view','finance.manage','requests.create','requests.decide','tasks.manage','apartment.manage','assets.manage','documents.manage','members.suspend']
const MEMBER_PERMS = ['finance.view','requests.create','tasks.manage']

export default function ProfilePage() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    const p = await getMyProfile()
    setMe(p)
    setEditName(p?.full_name ?? '')
    setEditPhone(p?.phone ?? '')
    setAvatarSrc(await avatarDisplayUrl(p?.avatar_url))
    try { setMembers(await listMembers()) } catch { setMembers([]) }
  }
  useEffect(() => { refresh() }, [])

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setEditError(null)
    try {
      await updateMyProfile({ full_name: editName.trim(), phone: editPhone.trim() })
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800)
      await refresh()
    } catch (err) { setEditError(err instanceof Error ? err.message : 'error') } finally { setBusy(false) }
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return
    setUploading(true); setEditError(null)
    try {
      await uploadMyAvatar(file)
      await refresh()
    } catch (err) { setEditError(err instanceof Error ? err.message : 'error') } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!me) return null
  const perms = me.role === 'owner' ? OWNER_PERMS : MEMBER_PERMS

  return (
    <div className="space-y-6 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('profile')}</h1>
      <GlassCard className="space-y-4">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => fileRef.current?.click()} aria-label={t('changePhoto')}
            className="tappable relative w-16 h-16 rounded-full overflow-hidden shrink-0 border border-gold/30"
            style={{ boxShadow: '0 6px 20px rgba(255,221,143,0.20)' }}>
            {avatarSrc
              ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-gradient-to-br from-gold-soft to-gold flex items-center justify-center text-obsidian text-2xl font-black">
                  {me.full_name.charAt(0)}
                </div>}
            <span className="absolute inset-x-0 bottom-0 text-center text-[9px] font-black bg-obsidian/60 text-gold-soft py-0.5">
              {uploading ? '…' : '📷'}
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => pickAvatar(e.target.files?.[0])} />
          <div>
            <p className="text-xl font-bold">{me.full_name}</p>
            <p className="text-sm text-gold-soft">{me.role === 'owner' ? t('owner') : me.role === 'supervisor' ? t('supervisor') : t('member')}</p>
            <p className={`text-xs ${me.status === 'active' ? 'text-emerald-300' : 'text-red-300'}`}>
              {me.status === 'active' ? t('active') : t('suspended')}
            </p>
          </div>
        </div>
        <div>
          <p className="label-glass">{t('permissions')}</p>
          <div className="flex flex-wrap gap-2">
            {perms.map(p => (
              <span key={p} dir="ltr" className="text-[11px] font-mono px-2.5 py-1 rounded-full border border-gold/25 text-gold-soft/90 bg-gold/5">
                {p}
              </span>
            ))}
          </div>
        </div>
        <form onSubmit={saveProfile} className="space-y-3 border-t border-white/10 pt-4">
          <Field label={t('yourName')} required value={editName} onChange={e => setEditName(e.target.value)} />
          <Field label={t('phoneNumber')} type="tel" dir="ltr" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="01xxxxxxxxx" />
          <ErrorNote message={editError} />
          <GoldButton disabled={busy || uploading || !editName.trim()}>
            {savedFlash ? `✓ ${t('saved')}` : t('saveChanges')}
          </GoldButton>
        </form>
      </GlassCard>

      {me.role === 'owner' && (
        <GlassCard className="space-y-3">
          <h2 className="font-bold">{t('members')}</h2>
          {members.filter(m => m.id !== me.id).map(m => (
            <div key={m.id} className="glass-inner p-3 flex items-center justify-between">
              <div>
                <p className="font-semibold">{m.full_name}</p>
                <p className="text-xs text-gold-soft">{m.role === 'supervisor' ? t('supervisor') : t('member')}</p>
                <p className={`text-xs ${m.status === 'active' ? 'text-emerald-300' : 'text-red-300'}`}>
                  {m.status === 'active' ? t('active') : t('suspended')}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  className="btn-ghost !px-3 !py-1.5 text-xs"
                  onClick={async () => { await setMemberStatus(m.id, m.status === 'active' ? 'suspended' : 'active'); await refresh() }}
                >
                  {m.status === 'active' ? t('suspend') : t('reactivate')}
                </button>
                <button
                  className="btn-ghost !px-3 !py-1.5 text-xs"
                  onClick={async () => { await setMemberRole(m.id, m.role === 'supervisor' ? 'member' : 'supervisor'); await refresh() }}
                >
                  {m.role === 'supervisor' ? t('demoteMember') : t('promoteSupervisor')}
                </button>
              </div>
            </div>
          ))}
          {members.length <= 1 && <p className="text-sm text-muted">—</p>}
        </GlassCard>
      )}
    </div>
  )
}
