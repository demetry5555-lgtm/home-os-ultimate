import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../components/ui'
import { SelectField, EmptyState, MoneyText } from '../components/finance'
import {
  getApartment, saveApartment, listRooms, addRoom, listStages, addStage, updateStage,
  listAssets, addAsset, listMaintenance, addMaintenance, setMaintenanceStatus,
  listSuppliers, addSupplier, apartmentBudget, canManageApartment,
  Apartment, Room, FinishingStage, Asset, MaintenanceJob, Supplier, BudgetLine,
  APARTMENT_STATUSES, ApartmentStatus, STAGE_STATUSES, StageStatus,
  ASSET_KINDS, AssetKind, MAINTENANCE_STATUSES, MaintenanceStatus,
} from '../lib/apartment'
import { listMembers, Profile } from '../lib/db'
import { parseAmount } from '../lib/money'
import { useT, Key } from '../i18n'

type Tab = 'rooms' | 'stages' | 'assets' | 'maintenance' | 'suppliers'

export default function ApartmentPage() {
  const { t } = useT()
  const [apt, setApt] = useState<Apartment | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [stages, setStages] = useState<FinishingStage[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [jobs, setJobs] = useState<MaintenanceJob[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [budget, setBudget] = useState<{ total: BudgetLine; lines: BudgetLine[] } | null>(null)
  const [manager, setManager] = useState(false)
  const [tab, setTab] = useState<Tab>('rooms')
  const [editProfile, setEditProfile] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // profile form
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [area, setArea] = useState('')
  const [roomsCount, setRoomsCount] = useState('')
  const [aptBudget, setAptBudget] = useState('')
  const [aptStatus, setAptStatus] = useState<ApartmentStatus>('planning')
  // room form
  const [roomName, setRoomName] = useState('')
  // stage form
  const [stageRoom, setStageRoom] = useState('')
  const [stageName, setStageName] = useState('')
  const [stageBudget, setStageBudget] = useState('')
  const [stageOwner, setStageOwner] = useState('')
  // asset form
  const [assetName, setAssetName] = useState('')
  const [assetKind, setAssetKind] = useState<AssetKind>('furniture')
  const [assetRoom, setAssetRoom] = useState('')
  const [assetBrand, setAssetBrand] = useState('')
  const [assetModel, setAssetModel] = useState('')
  const [assetPrice, setAssetPrice] = useState('')
  const [assetWarranty, setAssetWarranty] = useState('')
  const [assetSerial, setAssetSerial] = useState('')
  const [assetLocation, setAssetLocation] = useState('')
  // maintenance form
  const [jobTitle, setJobTitle] = useState('')
  const [jobRoom, setJobRoom] = useState('')
  const [jobSupplier, setJobSupplier] = useState('')
  const [jobCost, setJobCost] = useState('')
  const [jobDate, setJobDate] = useState('')
  // supplier form
  const [supName, setSupName] = useState('')
  const [supTrade, setSupTrade] = useState('')
  const [supPhone, setSupPhone] = useState('')

  async function refresh() {
    const [a, r, st, as_, j, su, m, b, mgr] = await Promise.all([
      getApartment(), listRooms(), listStages(), listAssets(), listMaintenance(),
      listSuppliers(), listMembers(), apartmentBudget(), canManageApartment(),
    ])
    setApt(a); setRooms(r); setStages(st); setAssets(as_); setJobs(j)
    setSuppliers(su); setMembers(m); setBudget(b); setManager(mgr)
    if (a) {
      setName(a.name); setAddress(a.address); setArea(a.areaSqm?.toString() ?? '')
      setRoomsCount(a.roomsCount?.toString() ?? '')
      setAptBudget(a.budgetCents != null ? (a.budgetCents / 100).toString() : '')
      setAptStatus(a.status)
    }
  }
  useEffect(() => { refresh().catch(() => {}) }, [])

  const memberName = (id: string | null) => members.find(m => m.id === id)?.full_name ?? '—'
  const roomNameOf = (id: string | null) => rooms.find(r => r.id === id)?.name ?? '—'
  const supplierNameOf = (id: string | null) => suppliers.find(s => s.id === id)?.name ?? '—'

  async function submitProfile(e: FormEvent) {
    e.preventDefault(); setError(null)
    try {
      await saveApartment({
        name: name.trim(), address: address.trim(),
        areaSqm: area ? parseFloat(area) : null,
        roomsCount: roomsCount ? parseInt(roomsCount, 10) : null,
        budgetCents: aptBudget ? parseAmount(aptBudget) : null,
        status: aptStatus,
      })
      setEditProfile(false)
      await refresh()
    } catch (err) { setError((err as Error).message) }
  }
  async function submitRoom(e: FormEvent) {
    e.preventDefault(); setError(null)
    try { await addRoom(roomName.trim()); setRoomName(''); await refresh() } catch (err) { setError((err as Error).message) }
  }
  async function submitStage(e: FormEvent) {
    e.preventDefault(); setError(null)
    try {
      await addStage({
        roomId: stageRoom, stage: stageName.trim(), status: 'planned', percentComplete: 0,
        budgetCents: stageBudget ? parseAmount(stageBudget) : null,
        ownerProfileId: stageOwner || null, startDate: null, endDate: null,
      })
      setStageName(''); setStageBudget(''); await refresh()
    } catch (err) { setError((err as Error).message) }
  }
  async function bumpStage(stage: FinishingStage, status: StageStatus, percent: number) {
    try {
      await updateStage(stage.id, {
        stage: stage.stage, status, percentComplete: percent, budgetCents: stage.budgetCents,
        ownerProfileId: stage.ownerProfileId, startDate: stage.startDate, endDate: stage.endDate,
      })
      await refresh()
    } catch (err) { setError((err as Error).message) }
  }
  async function submitAsset(e: FormEvent) {
    e.preventDefault(); setError(null)
    try {
      await addAsset({
        roomId: assetRoom || null, name: assetName.trim(), kind: assetKind,
        brand: assetBrand.trim(), model: assetModel.trim(),
        priceCents: assetPrice ? parseAmount(assetPrice) : null,
        warrantyUntil: assetWarranty || null, serial: assetSerial.trim(),
        invoicePath: '', location: assetLocation.trim(), purchasedAt: null,
      })
      setAssetName(''); setAssetBrand(''); setAssetModel(''); setAssetPrice('')
      setAssetSerial(''); setAssetLocation(''); setAssetWarranty('')
      await refresh()
    } catch (err) { setError((err as Error).message) }
  }
  async function submitJob(e: FormEvent) {
    e.preventDefault(); setError(null)
    try {
      await addMaintenance({
        assetId: null, roomId: jobRoom || null, supplierId: jobSupplier || null,
        title: jobTitle.trim(), description: '', status: jobDate ? 'scheduled' : 'open',
        costCents: jobCost ? parseAmount(jobCost) : null,
        scheduledAt: jobDate ? jobDate + 'T09:00:00' : null, doneDate: null,
      })
      setJobTitle(''); setJobCost(''); setJobDate(''); await refresh()
    } catch (err) { setError((err as Error).message) }
  }
  async function submitSupplier(e: FormEvent) {
    e.preventDefault(); setError(null)
    try {
      await addSupplier({ name: supName.trim(), trade: supTrade.trim(), phone: supPhone.trim(), notes: '', rating: null })
      setSupName(''); setSupTrade(''); setSupPhone(''); await refresh()
    } catch (err) { setError((err as Error).message) }
  }

  const tabs: Tab[] = ['rooms', 'stages', 'assets', 'maintenance', 'suppliers']
  const tabLabels: Record<Tab, Key> = { rooms: 'rooms', stages: 'stages', assets: 'assets', maintenance: 'maintenanceLog', suppliers: 'suppliers' }

  if (!apt && !manager) {
    return <EmptyState text={t('noApartment')} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black gold-text">{t('apartment')}</h1>
        {manager && <GhostButton onClick={() => setEditProfile(v => !v)} className="text-sm px-4 py-2">{apt ? t('edit') : t('createApartment')}</GhostButton>}
      </div>

      {(!apt || editProfile) && manager && (
        <GlassCard>
          <form onSubmit={submitProfile} className="space-y-3">
            <p className="font-bold">{t('apartmentProfile')}</p>
            <Field label={t('supplierName')} value={name} onChange={e => setName(e.target.value)} required />
            <Field label={t('address')} value={address} onChange={e => setAddress(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('areaSqm')} inputMode="decimal" value={area} onChange={e => setArea(e.target.value)} />
              <Field label={t('roomsCount')} inputMode="numeric" value={roomsCount} onChange={e => setRoomsCount(e.target.value)} />
              <Field label={t('budget')} inputMode="decimal" value={aptBudget} onChange={e => setAptBudget(e.target.value)} placeholder="0.00" />
              <SelectField label={t('status')} value={aptStatus} onChange={e => setAptStatus(e.target.value as ApartmentStatus)}>
                {APARTMENT_STATUSES.map(s => <option key={s} value={s}>{t(('aps_' + s) as Key)}</option>)}
              </SelectField>
            </div>
            <ErrorNote message={error} />
            <GoldButton disabled={!name.trim()}>{t('save')}</GoldButton>
          </form>
        </GlassCard>
      )}

      {apt && (
        <>
          <GlassCard>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-black text-lg">{apt.name}</p>
                {apt.address && <p className="text-sm text-muted">{apt.address}</p>}
                <p className="text-xs text-muted mt-1">
                  {apt.areaSqm ? `${apt.areaSqm} m² · ` : ''}{t(('aps_' + apt.status) as Key)}
                </p>
              </div>
            </div>
            {budget && (
              <div className="mt-4">
                <p className="label-glass">{t('plannedVsActual')}</p>
                <div className="flex justify-between text-sm font-bold">
                  <span>{t('planned')}: <MoneyText cents={budget.total.plannedCents} /></span>
                  <span className={budget.total.actualCents > budget.total.plannedCents && budget.total.plannedCents > 0 ? 'text-red-300' : 'text-emerald-300'}>
                    {t('actual')}: <MoneyText cents={budget.total.actualCents} />
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/10 mt-2 overflow-hidden">
                  <div className="h-full bg-gold-electric rounded-full"
                    style={{ width: `${budget.total.plannedCents > 0 ? Math.min(100, (budget.total.actualCents / budget.total.plannedCents) * 100) : 0}%` }} />
                </div>
                {budget.lines.map(l => (
                  <div key={l.key} className="flex justify-between text-xs text-muted mt-1">
                    <span>{l.label}</span>
                    <span><MoneyText cents={l.actualCents} /> / <MoneyText cents={l.plannedCents} /></span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <div className="flex gap-2 overflow-x-auto">
            {tabs.map(x => (
              <button key={x} onClick={() => setTab(x)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full border transition whitespace-nowrap ${tab === x ? 'border-gold-electric/60 text-gold-electric bg-gold-electric/10' : 'border-white/10 text-muted hover:text-ivory'}`}>
                {t(tabLabels[x])}
              </button>
            ))}
          </div>
          <ErrorNote message={error} />

          {tab === 'rooms' && (
            <div className="space-y-3">
              {manager && (
                <form onSubmit={submitRoom} className="flex gap-2">
                  <input className="input-glass flex-1" placeholder={t('roomName')} value={roomName} onChange={e => setRoomName(e.target.value)} />
                  <GhostButton className="px-4 py-2 text-sm" disabled={!roomName.trim()}>{t('addRoom')}</GhostButton>
                </form>
              )}
              {rooms.length === 0 && <EmptyState text={t('rooms')} />}
              {rooms.map(r => {
                const roomStages = stages.filter(s => s.roomId === r.id)
                const pct = roomStages.length ? Math.round(roomStages.reduce((a, s) => a + s.percentComplete, 0) / roomStages.length) : 0
                return (
                  <Link key={r.id} to={`/home/apartment/rooms/${r.id}`}>
                    <GlassCard className="mb-2 hover:border-gold/30 transition">
                      <div className="flex items-center justify-between">
                        <p className="font-bold">{r.name}</p>
                        <p className="text-xs text-gold-electric font-bold">{pct}%</p>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10 mt-2 overflow-hidden">
                        <div className="h-full bg-gold-electric rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </GlassCard>
                  </Link>
                )
              })}
            </div>
          )}

          {tab === 'stages' && (
            <div className="space-y-3">
              {manager && rooms.length > 0 && (
                <GlassCard>
                  <form onSubmit={submitStage} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <SelectField label={t('room')} value={stageRoom} onChange={e => setStageRoom(e.target.value)} required>
                        <option value="">—</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </SelectField>
                      <Field label={t('stageName')} value={stageName} onChange={e => setStageName(e.target.value)} required />
                      <Field label={t('budget')} inputMode="decimal" value={stageBudget} onChange={e => setStageBudget(e.target.value)} />
                      <SelectField label={t('stageOwner')} value={stageOwner} onChange={e => setStageOwner(e.target.value)}>
                        <option value="">—</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                      </SelectField>
                    </div>
                    <GoldButton disabled={!stageRoom || !stageName.trim()}>{t('addStage')}</GoldButton>
                  </form>
                </GlassCard>
              )}
              {stages.map(s => (
                <GlassCard key={s.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold">{s.stage}</p>
                      <p className="text-xs text-muted">{roomNameOf(s.roomId)} · {memberName(s.ownerProfileId)}</p>
                    </div>
                    <span className="text-xs font-bold px-3 py-1 rounded-full border border-gold-electric/40 text-gold-electric bg-gold-electric/10">
                      {t(('sgs_' + s.status) as Key)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 mt-2 overflow-hidden">
                    <div className="h-full bg-gold-electric rounded-full" style={{ width: `${s.percentComplete}%` }} />
                  </div>
                  {manager && (
                    <div className="flex gap-2 mt-3">
                      {s.status === 'planned' && <GhostButton onClick={() => bumpStage(s, 'in_progress', Math.max(s.percentComplete, 10))} className="text-xs px-3 py-1.5">{t('startTask')}</GhostButton>}
                      {s.status === 'in_progress' && (
                        <>
                          <GhostButton onClick={() => bumpStage(s, 'in_progress', Math.min(100, s.percentComplete + 25))} className="text-xs px-3 py-1.5">+25%</GhostButton>
                          <GhostButton onClick={() => bumpStage(s, 'done', 100)} className="text-xs px-3 py-1.5">{t('sgs_done')}</GhostButton>
                        </>
                      )}
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          )}

          {tab === 'assets' && (
            <div className="space-y-3">
              {manager && (
                <GlassCard>
                  <form onSubmit={submitAsset} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('assetName')} value={assetName} onChange={e => setAssetName(e.target.value)} required />
                      <SelectField label={t('assetKind')} value={assetKind} onChange={e => setAssetKind(e.target.value as AssetKind)}>
                        {ASSET_KINDS.map(k => <option key={k} value={k}>{t(('ak_' + k) as Key)}</option>)}
                      </SelectField>
                      <Field label={t('brand')} value={assetBrand} onChange={e => setAssetBrand(e.target.value)} />
                      <Field label={t('model')} value={assetModel} onChange={e => setAssetModel(e.target.value)} />
                      <Field label={t('price')} inputMode="decimal" value={assetPrice} onChange={e => setAssetPrice(e.target.value)} />
                      <Field label={t('warrantyUntil')} type="date" value={assetWarranty} onChange={e => setAssetWarranty(e.target.value)} />
                      <Field label={t('serial')} value={assetSerial} onChange={e => setAssetSerial(e.target.value)} />
                      <SelectField label={t('room')} value={assetRoom} onChange={e => setAssetRoom(e.target.value)}>
                        <option value="">—</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </SelectField>
                      <Field label={t('location')} value={assetLocation} onChange={e => setAssetLocation(e.target.value)} />
                    </div>
                    <GoldButton disabled={!assetName.trim()}>{t('addAsset')}</GoldButton>
                  </form>
                </GlassCard>
              )}
              {assets.map(a => (
                <GlassCard key={a.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold">{a.name}</p>
                      <p className="text-xs text-muted">
                        {t(('ak_' + a.kind) as Key)}{a.brand ? ` · ${a.brand}` : ''}{a.model ? ` ${a.model}` : ''}
                        {a.roomId ? ` · ${roomNameOf(a.roomId)}` : ''}
                      </p>
                      {a.warrantyUntil && <p className="text-[10px] text-muted">{t('warrantyUntil')}: {a.warrantyUntil}</p>}
                    </div>
                    {a.priceCents != null && <p className="text-sm font-bold text-gold-electric"><MoneyText cents={a.priceCents} /></p>}
                  </div>
                </GlassCard>
              ))}
            </div>
          )}

          {tab === 'maintenance' && (
            <div className="space-y-3">
              {manager && (
                <GlassCard>
                  <form onSubmit={submitJob} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('jobTitle')} value={jobTitle} onChange={e => setJobTitle(e.target.value)} required />
                      <Field label={t('scheduledAt')} type="date" value={jobDate} onChange={e => setJobDate(e.target.value)} />
                      <SelectField label={t('room')} value={jobRoom} onChange={e => setJobRoom(e.target.value)}>
                        <option value="">—</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </SelectField>
                      <SelectField label={t('suppliers')} value={jobSupplier} onChange={e => setJobSupplier(e.target.value)}>
                        <option value="">—</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </SelectField>
                      <Field label={t('cost')} inputMode="decimal" value={jobCost} onChange={e => setJobCost(e.target.value)} />
                    </div>
                    <GoldButton disabled={!jobTitle.trim()}>{t('addJob')}</GoldButton>
                  </form>
                </GlassCard>
              )}
              {jobs.map(j => (
                <GlassCard key={j.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold">{j.title}</p>
                      <p className="text-xs text-muted">
                        {j.scheduledAt ? `${t('scheduledAt')}: ${j.scheduledAt.slice(0, 10)} · ` : ''}
                        {j.roomId ? roomNameOf(j.roomId) : ''}{j.supplierId ? ` · ${supplierNameOf(j.supplierId)}` : ''}
                      </p>
                    </div>
                    <div className="text-end">
                      <span className="text-xs font-bold px-3 py-1 rounded-full border border-gold-electric/40 text-gold-electric bg-gold-electric/10">
                        {t(('ms_' + j.status) as Key)}
                      </span>
                      {j.costCents != null && <p className="text-xs text-muted mt-1"><MoneyText cents={j.costCents} /></p>}
                    </div>
                  </div>
                  {manager && j.status !== 'done' && j.status !== 'cancelled' && (
                    <div className="flex gap-2 mt-3">
                      <GhostButton onClick={() => setMaintenanceStatus(j.id, 'done', new Date().toISOString().slice(0, 10)).then(refresh)} className="text-xs px-3 py-1.5">{t('ms_done')}</GhostButton>
                      <GhostButton onClick={() => setMaintenanceStatus(j.id, 'cancelled').then(refresh)} className="text-xs px-3 py-1.5 text-red-300">{t('cancel')}</GhostButton>
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          )}

          {tab === 'suppliers' && (
            <div className="space-y-3">
              {manager && (
                <GlassCard>
                  <form onSubmit={submitSupplier} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('supplierName')} value={supName} onChange={e => setSupName(e.target.value)} required />
                      <Field label={t('trade')} value={supTrade} onChange={e => setSupTrade(e.target.value)} />
                      <Field label={t('phone')} value={supPhone} onChange={e => setSupPhone(e.target.value)} />
                    </div>
                    <GoldButton disabled={!supName.trim()}>{t('addSupplier')}</GoldButton>
                  </form>
                </GlassCard>
              )}
              {suppliers.map(s => (
                <GlassCard key={s.id}>
                  <p className="font-bold">{s.name}</p>
                  <p className="text-xs text-muted">{s.trade}{s.phone ? ` · ${s.phone}` : ''}</p>
                </GlassCard>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
