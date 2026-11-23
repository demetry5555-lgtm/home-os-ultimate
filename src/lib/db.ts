import { supabase, isCloud } from './supabase'

export type Role = 'owner' | 'supervisor' | 'member'

export interface Profile {
  id: string
  family_id: string | null
  full_name: string
  role: Role
  status: 'active' | 'suspended'
}

export interface Invitation {
  id: string
  code_hint: string
  intended_name: string
  status: 'draft' | 'pending' | 'accepted' | 'expired' | 'revoked'
  expires_at: string
  accepted_by: string | null
  created_at: string
}

export interface SessionInfo {
  userId: string
  email: string
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/* ==========================================================================
 * Local demo backend (no Supabase env): mirrors the SQL schema semantics in
 * localStorage so the whole stage-1 flow is testable before cloud deploy.
 * Codes are stored hashed, single-use, expiring - same rules as the database.
 * ======================================================================== */

interface DemoUser { id: string; email: string; passHash: string }
export interface DemoAccount {
  id: string; name: string; type: string; balance_cents: number
  currency: string; owner_profile_id: string | null
}
export interface DemoTransaction {
  id: string; account_id: string; type: 'income' | 'expense' | 'transfer'
  amount_cents: number; category: string; description: string
  member_id: string | null; receipt_path: string | null
  related_transaction_id: string | null; created_by: string; created_at: string
  room_id?: string | null; stage_id?: string | null; maintenance_id?: string | null
}
export interface DemoLoan {
  id: string; counterparty: string; direction: 'lent' | 'borrowed'
  principal_cents: number; remaining_cents: number; profile_id: string | null
}
export interface DemoLoanPayment { id: string; loan_id: string; transaction_id: string; amount_cents: number; paid_at: string }
export interface DemoSalary {
  id: string; profile_id: string; amount_cents: number; pay_type: 'monthly' | 'daily'
  payday: number; active: boolean
}
export interface DemoSalaryPayment {
  id: string; salary_id: string; profile_id: string; period: string
  base_cents: number; bonus_cents: number; deduction_cents: number; net_cents: number
  transaction_id: string; paid_at: string
}
export interface DemoBudget {
  id: string; category: string; limit_cents: number; month: string
  period: 'monthly' | 'annual'; scope: 'family' | 'apartment' | 'member'; scope_id: string | null
}

interface DemoStore {
  users: DemoUser[]
  profiles: Profile[]
  invitations: (Invitation & { code_hash: string })[]
  familyName: string | null
  familyCity?: string | null
  familyCurrency?: string
  familyDefaultLanguage?: 'ar' | 'en'
  session: SessionInfo | null
  accounts: DemoAccount[]
  transactions: DemoTransaction[]
  loans: DemoLoan[]
  loanPayments: DemoLoanPayment[]
  salaries: DemoSalary[]
  salaryPayments: DemoSalaryPayment[]
  budgets: DemoBudget[]
  goals?: import('./db').FamilyGoal[]
  goalProgress?: import('./db').GoalProgress[]
  checkins?: import('./db').DailyCheckin[]
}

const KEY = 'homeos.demo.v1'

function emptyStore(): DemoStore {
  return {
    users: [], profiles: [], invitations: [], familyName: null, session: null,
    accounts: [], transactions: [], loans: [], loanPayments: [], salaries: [],
    salaryPayments: [], budgets: [],
  }
}

function load(): DemoStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...emptyStore(), ...JSON.parse(raw) }
  } catch { /* corrupted store: reset */ }
  return emptyStore()
}
function save(s: DemoStore) { localStorage.setItem(KEY, JSON.stringify(s)) }

// Finance module access to the demo store (mirrors the SQL functions).
export const demo = { load, save }

function genCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `HOME-${hex.slice(0, 4)}-${hex.slice(4, 8)}`
}

export function uid(): string {
  return crypto.randomUUID()
}

/* ------------------------------ Auth API -------------------------------- */

export async function signUp(email: string, password: string): Promise<SessionInfo> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw new Error(error.message)
    if (!data.user) throw new Error('sign up failed')
    return { userId: data.user.id, email }
  }
  const s = load()
  if (s.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('email already registered')
  }
  const user: DemoUser = { id: uid(), email, passHash: await sha256hex(password + '::' + email) }
  s.users.push(user)
  s.session = { userId: user.id, email }
  save(s)
  return s.session
}

export async function signIn(email: string, password: string): Promise<SessionInfo> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
    return { userId: data.user.id, email }
  }
  const s = load()
  const passHash = await sha256hex(password + '::' + email)
  const user = s.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.passHash === passHash)
  if (!user) throw new Error('wrong email or password')
  const profile = s.profiles.find(p => p.id === user.id)
  if (profile && profile.status === 'suspended') throw new Error('account suspended')
  s.session = { userId: user.id, email }
  save(s)
  return s.session
}

export async function signOut(): Promise<void> {
  if (isCloud && supabase) { await supabase.auth.signOut(); return }
  const s = load(); s.session = null; save(s)
}

export async function getSession(): Promise<SessionInfo | null> {
  if (isCloud && supabase) {
    const { data } = await supabase.auth.getSession()
    return data.session ? { userId: data.session.user.id, email: data.session.user.email ?? '' } : null
  }
  return load().session
}

/* ---------------------------- Profile API ------------------------------- */

export async function getMyProfile(): Promise<Profile | null> {
  if (isCloud && supabase) {
    try {
      return await getMyProfileStrict()
    } catch {
      return null
    }
  }
  const s = load()
  if (!s.session) return null
  return s.profiles.find(p => p.id === s.session!.userId) ?? null
}

// Own profile only. Throws on fetch error so callers can tell "no profile yet"
// apart from "could not read" - never route to onboarding on an error.
export async function getMyProfileStrict(): Promise<Profile | null> {
  if (isCloud && supabase) {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth.user?.id
    if (!uid) return null
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as Profile) ?? null
  }
  return getMyProfile()
}

export async function bootstrapOwner(ownerName: string, familyName: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('bootstrap_owner', { p_owner_name: ownerName, p_family_name: familyName })
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  if (!s.session) throw new Error('not authenticated')
  if (s.profiles.some(p => p.id === s.session!.userId)) throw new Error('profile already exists')
  s.profiles.push({ id: s.session.userId, family_id: 'family-1', full_name: ownerName, role: 'owner', status: 'active' })
  s.familyName = familyName
  save(s)
}

export async function listMembers(): Promise<Profile[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('profiles').select('*')
    if (error) throw new Error(error.message)
    return data as Profile[]
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) return []
  return s.profiles.filter(p => p.family_id === me.family_id)
}

export async function setMemberRole(profileId: string, role: 'member' | 'supervisor'): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('set_member_role', { p_profile_id: profileId, p_role: role })
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  const target = s.profiles.find(p => p.id === profileId)
  if (!me || me.role !== 'owner' || me.status !== 'active' || !target
      || target.family_id !== me.family_id || target.role === 'owner') {
    throw new Error('not allowed')
  }
  target.role = role
  save(s)
}

export async function setMemberStatus(profileId: string, status: 'active' | 'suspended'): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('set_member_status', { p_profile_id: profileId, p_status: status })
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  const target = s.profiles.find(p => p.id === profileId)
  if (!me || me.role !== 'owner' || !target || target.family_id !== me.family_id || target.role === 'owner') {
    throw new Error('not allowed')
  }
  target.status = status
  save(s)
}

/* --------------------------- Invitations API ---------------------------- */

export async function createInvitation(intendedName: string): Promise<string> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.rpc('create_invitation', { p_intended_name: intendedName })
    if (error) throw new Error(error.message)
    return data as string
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me || me.role !== 'owner' || me.status !== 'active') throw new Error('only the owner can create invitations')
  const code = genCode()
  s.invitations.push({
    id: uid(),
    code_hash: await sha256hex(code),
    code_hint: code.slice(-4),
    intended_name: intendedName,
    status: 'pending',
    expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    accepted_by: null,
    created_at: new Date().toISOString(),
  })
  save(s)
  return code
}

export async function listInvitations(): Promise<Invitation[]> {
  if (isCloud && supabase) {
    const { data, error } = await supabase
      .from('invitations')
      .select('id, code_hint, intended_name, status, expires_at, accepted_by, created_at')
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data as Invitation[]
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me || me.role !== 'owner') return []
  const now = Date.now()
  return s.invitations
    .map(i => ({
      ...i,
      status: (i.status === 'pending' && Date.parse(i.expires_at) < now ? 'expired' : i.status) as Invitation['status'],
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function revokeInvitation(id: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: id })
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  const inv = s.invitations.find(i => i.id === id)
  if (!me || me.role !== 'owner' || !inv) throw new Error('not allowed')
  if (inv.status === 'pending') inv.status = 'revoked'
  save(s)
}

export async function acceptInvitation(code: string, fullName: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.rpc('accept_invitation', { p_code: code, p_full_name: fullName })
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  if (!s.session) throw new Error('not authenticated')
  if (s.profiles.some(p => p.id === s.session!.userId)) throw new Error('profile already exists')
  const hash = await sha256hex(code.trim().toUpperCase())
  const inv = s.invitations.find(i => i.code_hash === hash)
  if (!inv) throw new Error('invalid invitation code')
  if (inv.status === 'pending' && Date.parse(inv.expires_at) < Date.now()) {
    inv.status = 'expired'; save(s)
    throw new Error('invitation expired')
  }
  if (inv.status !== 'pending') throw new Error('invitation already used or revoked')
  const owner = s.profiles.find(p => p.role === 'owner')
  s.profiles.push({
    id: s.session.userId,
    family_id: owner?.family_id ?? 'family-1',
    full_name: fullName,
    role: 'member',
    status: 'active',
  })
  inv.status = 'accepted'
  inv.accepted_by = s.session.userId
  const s2 = s as typeof s & { notifications?: { id: number; profile_id: string; kind: string; title: string; body: string; read_at: string | null; created_at: string }[] }
  if (!s2.notifications) s2.notifications = []
  if (owner && owner.id !== s.session.userId) {
    s2.notifications.push({
      id: s2.notifications.length + 1, profile_id: owner.id, kind: 'invitation',
      title: 'Invitation accepted', body: fullName + ' joined the family',
      read_at: null, created_at: new Date().toISOString(),
    })
  }
  save(s)
}

export async function getFamilyName(): Promise<string | null> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    if (!me?.family_id) return null
    const { data } = await supabase.from('families').select('name').eq('id', me.family_id).single()
    return data?.name ?? null
  }
  return load().familyName
}

export interface FamilySettings {
  name: string; city: string; currency: string; defaultLanguage: 'ar' | 'en'
}

export async function getFamilySettings(): Promise<FamilySettings | null> {
  if (isCloud && supabase) {
    const me = await getMyProfile()
    if (!me?.family_id) return null
    const { data } = await supabase.from('families').select('name, city, currency, default_language').eq('id', me.family_id).single()
    if (!data) return null
    return { name: data.name, city: data.city ?? '', currency: data.currency ?? 'EGP', defaultLanguage: (data.default_language as 'ar' | 'en') ?? 'en' }
  }
  const s = load()
  if (!s.familyName) return null
  return { name: s.familyName, city: s.familyCity ?? '', currency: s.familyCurrency ?? 'EGP', defaultLanguage: s.familyDefaultLanguage ?? 'en' }
}

// Mirrors families_update_owner + families_update_manage policies.
export async function updateFamilySettings(input: FamilySettings): Promise<void> {
  const me = await getMyProfile()
  if (!me || me.status !== 'active') throw new Error('not allowed')
  if (me.role !== 'owner' && me.role !== 'supervisor') throw new Error('not allowed')
  if (isCloud && supabase) {
    const { error } = await supabase.from('families').update({
      name: input.name, city: input.city || null, currency: input.currency, default_language: input.defaultLanguage,
    }).eq('id', me.family_id!)
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  s.familyName = input.name
  s.familyCity = input.city || null
  s.familyCurrency = input.currency
  s.familyDefaultLanguage = input.defaultLanguage
  save(s)
}

// ============ FAMILY GOALS + DAILY CHECK-INS (stage 7) ============

export type Mood = 'great' | 'good' | 'okay' | 'tired' | 'stressed' | 'sad'

export interface FamilyGoal {
  id: string
  family_id: string
  title: string
  unit: string
  target_value: number
  deadline: string | null
  status: 'active' | 'achieved' | 'archived'
  created_by: string
  created_at: string
}
export interface GoalProgress {
  id: string
  goal_id: string
  member_id: string
  amount: number
  note: string
  created_at: string
}
export interface GoalWithProgress extends FamilyGoal {
  total: number
  entries: (GoalProgress & { member_name: string })[]
}
export interface DailyCheckin {
  id: string
  family_id: string
  member_id: string
  checkin_date: string
  mood: Mood
  note: string
  created_at: string
  updated_at: string
}
export interface CheckinWithName extends DailyCheckin { member_name: string }

function todayStr(): string { return new Date().toISOString().slice(0, 10) }

export async function listGoals(): Promise<GoalWithProgress[]> {
  if (isCloud && supabase) {
    const { data: goals, error } = await supabase.from('family_goals').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    const { data: progress, error: e2 } = await supabase.from('goal_progress').select('*').order('created_at', { ascending: false })
    if (e2) throw new Error(e2.message)
    const members = await listMembers()
    const nameOf = (id: string) => members.find(m => m.id === id)?.full_name ?? ''
    return (goals as FamilyGoal[]).map(g => {
      const entries = (progress as GoalProgress[]).filter(p => p.goal_id === g.id).map(p => ({ ...p, member_name: nameOf(p.member_id) }))
      return { ...g, entries, total: entries.reduce((a, p) => a + Number(p.amount), 0) }
    })
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) return []
  const nameOf = (id: string) => s.profiles.find(p => p.id === id)?.full_name ?? ''
  return (s.goals ?? [])
    .filter(g => g.family_id === me.family_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(g => {
      const entries = (s.goalProgress ?? []).filter(p => p.goal_id === g.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(p => ({ ...p, member_name: nameOf(p.member_id) }))
      return { ...g, entries, total: entries.reduce((a, p) => a + p.amount, 0) }
    })
}

export async function createGoal(input: { title: string; unit: string; target: number; deadline: string | null }): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfileStrict()
    if (!me) throw new Error('no profile')
    const { error } = await supabase.from('family_goals').insert({
      family_id: me.family_id, title: input.title, unit: input.unit,
      target_value: input.target, deadline: input.deadline, created_by: me.id,
    })
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) throw new Error('not authenticated')
  s.goals = s.goals ?? []
  s.goals.push({
    id: uid(), family_id: me.family_id!, title: input.title, unit: input.unit,
    target_value: input.target, deadline: input.deadline, status: 'active',
    created_by: me.id, created_at: new Date().toISOString(),
  })
  save(s)
}

export async function addGoalProgress(goalId: string, amount: number, note: string): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfileStrict()
    if (!me) throw new Error('no profile')
    const { error } = await supabase.from('goal_progress').insert({ goal_id: goalId, member_id: me.id, amount, note })
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) throw new Error('not authenticated')
  s.goalProgress = s.goalProgress ?? []
  s.goalProgress.push({ id: uid(), goal_id: goalId, member_id: me.id, amount, note, created_at: new Date().toISOString() })
  // mirror goal_mark_achieved trigger
  const goal = (s.goals ?? []).find(g => g.id === goalId)
  if (goal && goal.status === 'active') {
    const total = s.goalProgress.filter(p => p.goal_id === goalId).reduce((a, p) => a + p.amount, 0)
    if (total >= goal.target_value) goal.status = 'achieved'
  }
  save(s)
}

export async function deleteGoal(goalId: string): Promise<void> {
  if (isCloud && supabase) {
    const { error } = await supabase.from('family_goals').delete().eq('id', goalId)
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  const goal = (s.goals ?? []).find(g => g.id === goalId)
  if (!me || !goal) return
  if (goal.created_by !== me.id && me.role !== 'owner') throw new Error('not allowed')
  s.goals = (s.goals ?? []).filter(g => g.id !== goalId)
  s.goalProgress = (s.goalProgress ?? []).filter(p => p.goal_id !== goalId)
  save(s)
}

export async function myCheckinToday(): Promise<DailyCheckin | null> {
  if (isCloud && supabase) {
    const me = await getMyProfileStrict()
    if (!me) return null
    const { data, error } = await supabase.from('daily_checkins').select('*')
      .eq('member_id', me.id).eq('checkin_date', todayStr()).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as DailyCheckin) ?? null
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) return null
  return (s.checkins ?? []).find(c => c.member_id === me.id && c.checkin_date === todayStr()) ?? null
}

export async function upsertCheckin(mood: Mood, note: string): Promise<void> {
  if (isCloud && supabase) {
    const me = await getMyProfileStrict()
    if (!me) throw new Error('no profile')
    const { error } = await supabase.from('daily_checkins').upsert({
      family_id: me.family_id, member_id: me.id, checkin_date: todayStr(),
      mood, note, updated_at: new Date().toISOString(),
    }, { onConflict: 'family_id,member_id,checkin_date' })
    if (error) throw new Error(error.message)
    return
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) throw new Error('not authenticated')
  s.checkins = s.checkins ?? []
  const existing = s.checkins.find(c => c.member_id === me.id && c.checkin_date === todayStr())
  if (existing) {
    existing.mood = mood; existing.note = note; existing.updated_at = new Date().toISOString()
  } else {
    s.checkins.push({
      id: uid(), family_id: me.family_id!, member_id: me.id, checkin_date: todayStr(),
      mood, note, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
  }
  save(s)
}

export async function listTodayCheckins(): Promise<CheckinWithName[]> {
  const members = await listMembers()
  const nameOf = (id: string) => members.find(m => m.id === id)?.full_name ?? ''
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('daily_checkins').select('*')
      .eq('checkin_date', todayStr()).order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data as DailyCheckin[]).map(c => ({ ...c, member_name: nameOf(c.member_id) }))
  }
  const s = load()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) return []
  return (s.checkins ?? [])
    .filter(c => c.family_id === me.family_id && c.checkin_date === todayStr())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(c => ({ ...c, member_name: nameOf(c.member_id) }))
}

// Consecutive days with a check-in, counting back from today (yesterday counts if today is not done yet).
export async function myCheckinStreak(): Promise<number> {
  const me = await getMyProfile()
  if (!me) return 0
  let dates: string[]
  if (isCloud && supabase) {
    const { data, error } = await supabase.from('daily_checkins').select('checkin_date')
      .eq('member_id', me.id).order('checkin_date', { ascending: false }).limit(120)
    if (error) return 0
    dates = (data as { checkin_date: string }[]).map(r => r.checkin_date)
  } else {
    const s = load()
    dates = (s.checkins ?? []).filter(c => c.member_id === me.id).map(c => c.checkin_date).sort().reverse()
  }
  const set = new Set(dates)
  let streak = 0
  let cursor = new Date()
  if (!set.has(cursor.toISOString().slice(0, 10))) cursor = new Date(cursor.getTime() - 864e5)
  while (set.has(cursor.toISOString().slice(0, 10))) {
    streak++
    cursor = new Date(cursor.getTime() - 864e5)
  }
  return streak
}
