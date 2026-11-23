import { useEffect, useState } from 'react'
import { GlassCard } from '../components/ui'
import { getMyProfile, listMembers, setMemberStatus, setMemberRole, Profile } from '../lib/db'
import { useT } from '../i18n'

const OWNER_PERMS = ['family.manage','invitations.manage','finance.view','finance.manage','requests.create','requests.decide','tasks.manage','apartment.manage','assets.manage','documents.manage','members.suspend']
const MEMBER_PERMS = ['finance.view','requests.create','tasks.manage']

export default function ProfilePage() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])

  async function refresh() {
    setMe(await getMyProfile())
    try { setMembers(await listMembers()) } catch { setMembers([]) }
  }
  useEffect(() => { refresh() }, [])

  if (!me) return null
  const perms = me.role === 'owner' ? OWNER_PERMS : MEMBER_PERMS

  return (
    <div className="space-y-6 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('profile')}</h1>
      <GlassCard className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gold-soft to-gold flex items-center justify-center text-obsidian text-2xl font-black">
            {me.full_name.charAt(0)}
          </div>
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
