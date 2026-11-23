import { FormEvent, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../components/ui'
import { MoneyText } from '../components/finance'
import {
  listRooms, updateRoomDetails, listStages, listAssets, canManageApartment,
  Room, FinishingStage, Asset, RoomDetails,
} from '../lib/apartment'
import { listTasks, FamilyTask } from '../lib/tasks'
import { useT, Key } from '../i18n'
import { uploadDocument, signedUrl } from '../lib/documents'
import { addRoomPhoto } from '../lib/apartment'
import { useRef } from 'react'

const FIELDS: { key: keyof RoomDetails; label: Key }[] = [
  { key: 'dimensions', label: 'dimensions' },
  { key: 'flooring', label: 'flooring' },
  { key: 'paintColor', label: 'paintColor' },
  { key: 'paintCodes', label: 'paintCodes' },
  { key: 'gypsum', label: 'gypsum' },
  { key: 'lighting', label: 'lighting' },
  { key: 'doors', label: 'doors' },
  { key: 'windows', label: 'windows' },
  { key: 'electric', label: 'electric' },
  { key: 'plumbing', label: 'plumbing' },
  { key: 'furniture', label: 'furniture' },
  { key: 'appliances', label: 'appliances' },
  { key: 'notes', label: 'notes' },
]

export default function RoomDetail() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const [room, setRoom] = useState<Room | null>(null)
  const [stages, setStages] = useState<FinishingStage[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [tasks, setTasks] = useState<FamilyTask[]>([])
  const [manager, setManager] = useState(false)
  const [form, setForm] = useState<RoomDetails | null>(null)
  const [area, setArea] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const photoRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    const rooms = await listRooms()
    const r = rooms.find(x => x.id === id) ?? null
    setRoom(r)
    if (r) {
      setStages(await listStages(r.id))
      setAssets(await listAssets(r.id))
      setForm({
        areaSqm: r.areaSqm, dimensions: r.dimensions, flooring: r.flooring,
        paintColor: r.paintColor, paintCodes: r.paintCodes, gypsum: r.gypsum,
        lighting: r.lighting, doors: r.doors, windows: r.windows, electric: r.electric,
        plumbing: r.plumbing, furniture: r.furniture, appliances: r.appliances, notes: r.notes,
      })
      setArea(r.areaSqm?.toString() ?? '')
    }
    setTasks((await listTasks()).filter(x => x.roomId === id))
    setManager(await canManageApartment())
    if (r?.photos?.length) {
      const urls: string[] = []
      for (const p of r.photos) { try { urls.push(await signedUrl(p)) } catch { /* skip */ } }
      setPhotoUrls(urls)
    }
  }
  useEffect(() => { refresh().catch(() => {}) }, [id])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setError(null); setSaved(false)
    try {
      await updateRoomDetails(room!.id, { ...form, areaSqm: area ? parseFloat(area) : null })
      setSaved(true)
      await refresh()
    } catch (err) { setError((err as Error).message) }
  }

  if (!room || !form) return <div className="h-full" />

  return (
    <div className="space-y-4">
      <Link to="/home/apartment" className="text-sm text-muted hover:text-ivory"><span className="back-arrow">←</span> {t('apartment')}</Link>
      <h1 className="text-xl font-black gold-text">{room.name}</h1>

      <GlassCard>
        <p className="label-glass">{t('roomDetails')}</p>
        <form onSubmit={submit} className="space-y-3">
          <Field label={t('areaSqm')} inputMode="decimal" value={area} onChange={e => setArea(e.target.value)} disabled={!manager} />
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map(f => (
              <Field key={f.key} label={t(f.label)} value={String(form[f.key] ?? '')}
                disabled={!manager}
                onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
            ))}
          </div>
          {manager && <GoldButton>{t('save')}</GoldButton>}
          {saved && <p className="text-xs text-emerald-300">✓</p>}
          <ErrorNote message={error} />
        </form>
      </GlassCard>

      <GlassCard>
        <p className="label-glass">{t('roomPhotos')}</p>
        {photoUrls.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-2">
            {photoUrls.map(u => <img key={u} src={u} className="w-20 h-20 object-cover rounded-xl border border-gold/20" alt="" />)}
          </div>
        )}
        {manager && (
          <>
            <input ref={photoRef} type="file" accept="image/*" className="hidden"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (!f || !room) return
                try {
                  const path = await uploadDocument({
                    file: f, title: f.name, category: 'photo',
                    visibility: 'family', entityType: 'room', entityId: room.id, tags: ['room-photo'],
                  })
                  await addRoomPhoto(room.id, path)
                  await refresh()
                } catch (err) { setError((err as Error).message) }
                if (photoRef.current) photoRef.current.value = ''
              }} />
            <GhostButton type="button" className="text-sm px-4 py-2" onClick={() => photoRef.current?.click()}>{t('addPhoto')}</GhostButton>
          </>
        )}
      </GlassCard>

      <GlassCard>
        <p className="label-glass">{t('stages')}</p>
        {stages.length === 0 && <p className="text-xs text-muted">—</p>}
        {stages.map(s => (
          <div key={s.id} className="mb-2">
            <div className="flex justify-between text-sm">
              <span className="font-bold">{s.stage}</span>
              <span className="text-muted">{t(('sgs_' + s.status) as Key)} · {s.percentComplete}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 mt-1 overflow-hidden">
              <div className="h-full bg-gold-electric rounded-full" style={{ width: `${s.percentComplete}%` }} />
            </div>
            {s.budgetCents != null && <p className="text-[10px] text-muted mt-0.5">{t('budget')}: <MoneyText cents={s.budgetCents} /></p>}
          </div>
        ))}
      </GlassCard>

      <GlassCard>
        <p className="label-glass">{t('assets')}</p>
        {assets.length === 0 && <p className="text-xs text-muted">—</p>}
        {assets.map(a => (
          <div key={a.id} className="flex justify-between text-sm mb-1">
            <span>{a.name}{a.brand ? ` · ${a.brand}` : ''}</span>
            {a.priceCents != null && <MoneyText cents={a.priceCents} className="text-gold-electric" />}
          </div>
        ))}
      </GlassCard>

      {tasks.length > 0 && (
        <GlassCard>
          <p className="label-glass">{t('tasks')}</p>
          {tasks.map(x => (
            <Link key={x.id} to={`/home/tasks/${x.id}`} className="block text-sm text-gold-electric underline mb-1">{x.title}</Link>
          ))}
        </GlassCard>
      )}
    </div>
  )
}
