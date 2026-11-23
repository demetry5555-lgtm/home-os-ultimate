import { supabase, isCloud } from './supabase'
import { demo, uid, getMyProfile } from './db'
import { Cents, dbToCents, centsToDb } from './money'

export const APARTMENT_STATUSES = ['planning','finishing','finished','living'] as const
export type ApartmentStatus = typeof APARTMENT_STATUSES[number]
export const STAGE_STATUSES = ['planned','in_progress','done'] as const
export type StageStatus = typeof STAGE_STATUSES[number]
export const ASSET_KINDS = ['furniture','appliance','other'] as const
export type AssetKind = typeof ASSET_KINDS[number]
export const MAINTENANCE_STATUSES = ['open','scheduled','in_progress','done','cancelled'] as const
export type MaintenanceStatus = typeof MAINTENANCE_STATUSES[number]

export interface Apartment {
  id: string; name: string; address: string; areaSqm: number | null
  roomsCount: number | null; photos: string[]; plans: string[]
  budgetCents: Cents | null; status: ApartmentStatus
}
export interface Room {
  id: string; apartmentId: string; name: string; floor: number
  areaSqm: number | null; dimensions: string; photos: string[]
  flooring: string; paintColor: string; paintCodes: string; gypsum: string
  lighting: string; doors: string; windows: string; electric: string
  plumbing: string; furniture: string; appliances: string; notes: string
}
export interface FinishingStage {
  id: string; roomId: string; stage: string; status: StageStatus
  percentComplete: number; budgetCents: Cents | null
  ownerProfileId: string | null; startDate: string | null; endDate: string | null
  beforePhotos: string[]; afterPhotos: string[]
}
export interface Asset {
  id: string; roomId: string | null; name: string; kind: AssetKind
  brand: string; model: string; priceCents: Cents | null
  warrantyUntil: string | null; serial: string; invoicePath: string
  location: string; purchasedAt: string | null
}
export interface MaintenanceJob {
  id: string; assetId: string | null; roomId: string | null; supplierId: string | null
  title: string; description: string; status: MaintenanceStatus
  costCents: Cents | null; scheduledAt: string | null; doneDate: string | null
  linkedTransactionId: string | null
}
export interface Supplier {
  id: string; name: string; trade: string; phone: string; notes: string; rating: number | null
}

interface DemoApartment {
  id: string; name: string; address: string; area_sqm: number | null
  rooms_count: number | null; photos: string[]; plans: string[]
  budget_cents: number | null; status: ApartmentStatus
}
interface DemoRoom {
  id: string; apartment_id: string; name: string; floor: number
  area_sqm: number | null; dimensions: string; photos: string[]
  flooring: string; paint_color: string; paint_codes: string; gypsum: string
  lighting: string; doors: string; windows: string; electric: string
  plumbing: string; furniture: string; appliances: string; notes: string
}
interface DemoStage {
  id: string; room_id: string; stage: string; status: StageStatus
  percent_complete: number; budget_cents: number | null
  owner_profile_id: string | null; start_date: string | null; end_date: string | null
  before_photos: string[]; after_photos: string[]
}
interface DemoAsset {
  id: string; room_id: string | null; name: string; kind: AssetKind
  brand: string; model: string; price_cents: number | null
  warranty_until: string | null; serial: string; invoice_path: string
  location: string; purchased_at: string | null
}
interface DemoMaintenance {
  id: string; asset_id: string | null; room_id: string | null; supplier_id: string | null
  title: string; description: string; status: MaintenanceStatus
  cost_cents: number | null; scheduled_at: string | null; done_date: string | null
  linked_transaction_id: string | null
}
interface DemoSupplier { id: string; name: string; trade: string; phone: string; notes: string; rating: number | null }

export function dloadApt() {
  const s = demo.load() as ReturnType<typeof demo.load> & {
    apartment?: DemoApartment | null; rooms?: DemoRoom[]; stages?: DemoStage[]
    assets?: DemoAsset[]; maintenanceJobs?: DemoMaintenance[]; suppliers?: DemoSupplier[]
  }
  if (s.apartment === undefined) s.apartment = null
  if (!s.rooms) s.rooms = []
  if (!s.stages) s.stages = []
  if (!s.assets) s.assets = []
  if (!s.maintenanceJobs) s.maintenanceJobs = []
  if (!s.suppliers) s.suppliers = []
  return s
}

export async function canManageApartment(): Promise<boolean> {
  const me = await getMyProfile()
  return !!me && me.status === 'active' && (me.role === 'owner' || me.role === 'supervisor')
}

/* ------------------------------ Apartment ------------------------------- */

export async function getApartment(): Promise<Apartment | null> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('apartments').select('*').limit(1)
    if (error) throw new Error(error.message)
    const a = data?.[0]
    if (!a) return null
    return {
      id: a.id, name: a.name, address: a.address ?? '', areaSqm: a.area_sqm,
      roomsCount: a.rooms_count, photos: a.photos ?? [], plans: a.plans ?? [],
      budgetCents: a.budget == null ? null : dbToCents(a.budget), status: a.status,
    }
  }
  const s = dloadApt()
  const a = s.apartment
  if (!a) return null
  return {
    id: a.id, name: a.name, address: a.address, areaSqm: a.area_sqm,
    roomsCount: a.rooms_count, photos: a.photos, plans: a.plans,
    budgetCents: a.budget_cents, status: a.status,
  }
}

export interface ApartmentInput {
  name: string; address: string; areaSqm: number | null; roomsCount: number | null
  budgetCents: Cents | null; status: ApartmentStatus
}

export async function saveApartment(input: ApartmentInput): Promise<void> {
  if (!isCloud || !supabase) {
    if (!(await canManageApartment())) throw new Error('not allowed')
    const s = dloadApt()
    if (s.apartment) {
      Object.assign(s.apartment, {
        name: input.name, address: input.address, area_sqm: input.areaSqm,
        rooms_count: input.roomsCount, budget_cents: input.budgetCents, status: input.status,
      })
    } else {
      s.apartment = {
        id: uid(), name: input.name, address: input.address, area_sqm: input.areaSqm,
        rooms_count: input.roomsCount, photos: [], plans: [], budget_cents: input.budgetCents, status: input.status,
      }
    }
    demo.save(s)
    return
  }
  const me = await getMyProfile()
  const existing = await getApartment()
  if (existing) {
    const { error } = await supabase.from('apartments').update({
      name: input.name, address: input.address, area_sqm: input.areaSqm,
      rooms_count: input.roomsCount,
      budget: input.budgetCents == null ? null : centsToDb(input.budgetCents),
      status: input.status,
    }).eq('id', existing.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('apartments').insert({
      family_id: me!.family_id, name: input.name, address: input.address,
      area_sqm: input.areaSqm, rooms_count: input.roomsCount,
      budget: input.budgetCents == null ? null : centsToDb(input.budgetCents),
      status: input.status,
    })
    if (error) throw new Error(error.message)
  }
}

/* -------------------------------- Rooms --------------------------------- */

function toRoom(r: DemoRoom): Room {
  return {
    id: r.id, apartmentId: r.apartment_id, name: r.name, floor: r.floor,
    areaSqm: r.area_sqm, dimensions: r.dimensions, photos: r.photos,
    flooring: r.flooring, paintColor: r.paint_color, paintCodes: r.paint_codes, gypsum: r.gypsum,
    lighting: r.lighting, doors: r.doors, windows: r.windows, electric: r.electric,
    plumbing: r.plumbing, furniture: r.furniture, appliances: r.appliances, notes: r.notes,
  }
}

export const EMPTY_ROOM = {
  areaSqm: null as number | null, dimensions: '', flooring: '', paintColor: '', paintCodes: '',
  gypsum: '', lighting: '', doors: '', windows: '', electric: '', plumbing: '',
  furniture: '', appliances: '', notes: '',
}

export async function listRooms(): Promise<Room[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('rooms').select('*').order('name')
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => toRoom({
      ...r, area_sqm: r.area_sqm, paint_color: r.paint_color ?? '', paint_codes: r.paint_codes ?? '',
    } as DemoRoom))
  }
  return dloadApt().rooms!.map(toRoom)
}

export async function addRoom(name: string, floor = 0): Promise<string> {
  if (isCloud && supabase) {
    const apt = await getApartment()
    if (!apt) throw new Error('create the apartment profile first')
    const { data, error } = await supabase.from('rooms').insert({ apartment_id: apt.id, name, floor }).select('id').single()
    if (error) throw new Error(error.message)
    return data.id as string
  }
  if (!(await canManageApartment())) throw new Error('not allowed')
  const s = dloadApt()
  if (!s.apartment) throw new Error('create the apartment profile first')
  const id = uid()
  s.rooms!.push({
    id, apartment_id: s.apartment.id, name, floor,
    area_sqm: null, dimensions: '', photos: [], flooring: '', paint_color: '', paint_codes: '',
    gypsum: '', lighting: '', doors: '', windows: '', electric: '', plumbing: '',
    furniture: '', appliances: '', notes: '',
  })
  demo.save(s)
  return id
}

export type RoomDetails = Omit<Room, 'id' | 'apartmentId' | 'name' | 'floor' | 'photos'>

export async function updateRoomDetails(roomId: string, d: RoomDetails): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('rooms').update({
      area_sqm: d.areaSqm, dimensions: d.dimensions, flooring: d.flooring,
      paint_color: d.paintColor, paint_codes: d.paintCodes, gypsum: d.gypsum,
      lighting: d.lighting, doors: d.doors, windows: d.windows, electric: d.electric,
      plumbing: d.plumbing, furniture: d.furniture, appliances: d.appliances, notes: d.notes,
    }).eq('id', roomId)
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canManageApartment())) throw new Error('not allowed')
  const s = dloadApt()
  const r = s.rooms!.find(x => x.id === roomId)
  if (!r) throw new Error('room not found')
  Object.assign(r, {
    area_sqm: d.areaSqm, dimensions: d.dimensions, flooring: d.flooring,
    paint_color: d.paintColor, paint_codes: d.paintCodes, gypsum: d.gypsum,
    lighting: d.lighting, doors: d.doors, windows: d.windows, electric: d.electric,
    plumbing: d.plumbing, furniture: d.furniture, appliances: d.appliances, notes: d.notes,
  })
  demo.save(s)
}

export async function addRoomPhoto(roomId: string, path: string): Promise<void> {
  if (isCloud && supabase) {
    const { data } = await supabase.from('rooms').select('photos').eq('id', roomId).single()
    const photos = [...((data?.photos as string[]) ?? []), path]
    const { error } = await supabase.from('rooms').update({ photos }).eq('id', roomId)
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canManageApartment())) throw new Error('not allowed')
  const s = dloadApt()
  const r = s.rooms!.find(x => x.id === roomId)
  if (!r) throw new Error('room not found')
  r.photos = [...r.photos, path]
  demo.save(s)
}

/* ------------------------------ Stages ---------------------------------- */

function toStage(x: DemoStage): FinishingStage {
  return {
    id: x.id, roomId: x.room_id, stage: x.stage, status: x.status,
    percentComplete: x.percent_complete, budgetCents: x.budget_cents,
    ownerProfileId: x.owner_profile_id, startDate: x.start_date, endDate: x.end_date,
    beforePhotos: x.before_photos, afterPhotos: x.after_photos,
  }
}

export async function listStages(roomId?: string): Promise<FinishingStage[]> {
  if (isCloud && supabase) {
    let q = supabase.from('finishing_stages').select('*').order('stage')
    if (roomId) q = q.eq('room_id', roomId)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => toStage(r as unknown as DemoStage))
  }
  const s = dloadApt()
  return s.stages!.filter(x => !roomId || x.room_id === roomId).map(toStage)
}

export interface StageInput {
  roomId: string; stage: string; status: StageStatus; percentComplete: number
  budgetCents: Cents | null; ownerProfileId: string | null
  startDate: string | null; endDate: string | null
}

export async function addStage(input: StageInput): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('finishing_stages').insert({
      room_id: input.roomId, stage: input.stage, status: input.status,
      percent_complete: input.percentComplete,
      cost: null,
      budget: input.budgetCents == null ? null : centsToDb(input.budgetCents),
      owner_profile_id: input.ownerProfileId, start_date: input.startDate, end_date: input.endDate,
    })
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canManageApartment())) throw new Error('not allowed')
  const s = dloadApt()
  s.stages!.push({
    id: uid(), room_id: input.roomId, stage: input.stage, status: input.status,
    percent_complete: input.percentComplete, budget_cents: input.budgetCents,
    owner_profile_id: input.ownerProfileId, start_date: input.startDate, end_date: input.endDate,
    before_photos: [], after_photos: [],
  })
  demo.save(s)
}

export async function updateStage(id: string, input: Omit<StageInput, 'roomId'>): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('finishing_stages').update({
      stage: input.stage, status: input.status, percent_complete: input.percentComplete,
      budget: input.budgetCents == null ? null : centsToDb(input.budgetCents),
      owner_profile_id: input.ownerProfileId, start_date: input.startDate, end_date: input.endDate,
    }).eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canManageApartment())) throw new Error('not allowed')
  const s = dloadApt()
  const x = s.stages!.find(v => v.id === id)
  if (!x) throw new Error('stage not found')
  Object.assign(x, {
    stage: input.stage, status: input.status, percent_complete: input.percentComplete,
    budget_cents: input.budgetCents, owner_profile_id: input.ownerProfileId,
    start_date: input.startDate, end_date: input.endDate,
  })
  demo.save(s)
}

/* ------------------------------- Assets --------------------------------- */

function toAsset(a: DemoAsset): Asset {
  return {
    id: a.id, roomId: a.room_id, name: a.name, kind: a.kind, brand: a.brand, model: a.model,
    priceCents: a.price_cents, warrantyUntil: a.warranty_until, serial: a.serial,
    invoicePath: a.invoice_path, location: a.location, purchasedAt: a.purchased_at,
  }
}

export async function listAssets(roomId?: string): Promise<Asset[]> {
  if (isCloud && supabase) {
    let q = supabase.from('assets').select('*').order('name')
    if (roomId) q = q.eq('room_id', roomId)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => toAsset(r as unknown as DemoAsset))
  }
  const s = dloadApt()
  return s.assets!.filter(a => !roomId || a.room_id === roomId).map(toAsset)
}

export interface AssetInput {
  roomId: string | null; name: string; kind: AssetKind; brand: string; model: string
  priceCents: Cents | null; warrantyUntil: string | null; serial: string
  invoicePath: string; location: string; purchasedAt: string | null
}

export async function addAsset(input: AssetInput): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('assets').insert({
      family_id: me!.family_id, room_id: input.roomId, name: input.name, kind: input.kind,
      brand: input.brand, model: input.model,
      price: input.priceCents == null ? null : centsToDb(input.priceCents),
      warranty_until: input.warrantyUntil, serial: input.serial,
      invoice_path: input.invoicePath, location: input.location, purchased_at: input.purchasedAt,
    })
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canManageApartment())) throw new Error('not allowed')
  const s = dloadApt()
  s.assets!.push({
    id: uid(), room_id: input.roomId, name: input.name, kind: input.kind,
    brand: input.brand, model: input.model, price_cents: input.priceCents,
    warranty_until: input.warrantyUntil, serial: input.serial,
    invoice_path: input.invoicePath, location: input.location, purchased_at: input.purchasedAt,
  })
  demo.save(s)
}

/* ----------------------------- Maintenance ------------------------------- */

function toJob(m: DemoMaintenance): MaintenanceJob {
  return {
    id: m.id, assetId: m.asset_id, roomId: m.room_id, supplierId: m.supplier_id,
    title: m.title, description: m.description, status: m.status,
    costCents: m.cost_cents, scheduledAt: m.scheduled_at, doneDate: m.done_date,
    linkedTransactionId: m.linked_transaction_id,
  }
}

export async function listMaintenance(): Promise<MaintenanceJob[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('maintenance').select('*').order('scheduled_at', { nullsFirst: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => toJob(r as unknown as DemoMaintenance))
  }
  return dloadApt().maintenanceJobs!.map(toJob)
}

export interface MaintenanceInput {
  assetId: string | null; roomId: string | null; supplierId: string | null
  title: string; description: string; status: MaintenanceStatus
  costCents: Cents | null; scheduledAt: string | null; doneDate: string | null
}

export async function addMaintenance(input: MaintenanceInput): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('maintenance').insert({
      family_id: me!.family_id, asset_id: input.assetId, room_id: input.roomId,
      supplier_id: input.supplierId, title: input.title, description: input.description,
      status: input.status, cost: input.costCents == null ? null : centsToDb(input.costCents),
      scheduled_at: input.scheduledAt, done_date: input.doneDate,
    })
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canManageApartment())) throw new Error('not allowed')
  const s = dloadApt()
  s.maintenanceJobs!.push({
    id: uid(), asset_id: input.assetId, room_id: input.roomId, supplier_id: input.supplierId,
    title: input.title, description: input.description, status: input.status,
    cost_cents: input.costCents, scheduled_at: input.scheduledAt, done_date: input.doneDate,
    linked_transaction_id: null,
  })
  demo.save(s)
}

export async function setMaintenanceStatus(id: string, status: MaintenanceStatus, doneDate: string | null = null): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('maintenance').update({ status, done_date: doneDate }).eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canManageApartment())) throw new Error('not allowed')
  const s = dloadApt()
  const m = s.maintenanceJobs!.find(x => x.id === id)
  if (!m) throw new Error('job not found')
  m.status = status
  m.done_date = doneDate
  demo.save(s)
}

/* ------------------------------ Suppliers -------------------------------- */

export async function listSuppliers(): Promise<Supplier[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('suppliers').select('*').order('name')
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => ({ id: r.id, name: r.name, trade: r.trade, phone: r.phone, notes: r.notes, rating: r.rating }))
  }
  return dloadApt().suppliers!
}

export async function addSupplier(input: Omit<Supplier, 'id'>): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    const { error } = await supabase.from('suppliers').insert({ family_id: me!.family_id, ...input })
    if (error) throw new Error(error.message)
    return
  }
  if (!(await canManageApartment())) throw new Error('not allowed')
  const s = dloadApt()
  s.suppliers!.push({ id: uid(), ...input })
  demo.save(s)
}

/* -------------------- Budget: planned vs actual ------------------------- */

export interface BudgetLine {
  key: string; label: string; plannedCents: Cents; actualCents: Cents
}

// Actual spending per room/stage comes from finance transactions tagged with
// room_id / stage_id (linked live to the finance module).
export async function apartmentBudget(): Promise<{ total: BudgetLine; lines: BudgetLine[] }> {
  const apt = await getApartment()
  const rooms = await listRooms()
  const stages = await listStages()
  let expenses: { roomId: string | null; stageId: string | null; amountCents: Cents }[] = []
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('transactions')
      .select('room_id, stage_id, amount, type')
      .eq('type', 'expense')
    if (error) throw new Error(error.message)
    expenses = (data ?? [])
      .filter(t => t.room_id || t.stage_id)
      .map(t => ({ roomId: t.room_id, stageId: t.stage_id, amountCents: dbToCents(t.amount) }))
  } else {
    const s = dloadApt() as ReturnType<typeof dloadApt> & {
      transactions: { type: string; amount_cents: number; room_id?: string | null; stage_id?: string | null }[]
    }
    expenses = (s.transactions ?? [])
      .filter(t => t.type === 'expense' && (t.room_id || t.stage_id))
      .map(t => ({ roomId: t.room_id ?? null, stageId: t.stage_id ?? null, amountCents: t.amount_cents }))
  }
  const lines: BudgetLine[] = []
  for (const room of rooms) {
    const roomStages = stages.filter(x => x.roomId === room.id)
    const planned = roomStages.reduce((sum, x) => sum + (x.budgetCents ?? 0), 0)
    const stageIds = new Set(roomStages.map(x => x.id))
    const actual = expenses
      .filter(e => e.roomId === room.id || (e.stageId != null && stageIds.has(e.stageId)))
      .reduce((sum, e) => sum + e.amountCents, 0)
    if (planned || actual) lines.push({ key: room.id, label: room.name, plannedCents: planned, actualCents: actual })
  }
  const total: BudgetLine = {
    key: 'total', label: 'Apartment',
    plannedCents: apt?.budgetCents ?? lines.reduce((sum, l) => sum + l.plannedCents, 0),
    actualCents: lines.reduce((sum, l) => sum + l.actualCents, 0),
  }
  return { total, lines }
}
