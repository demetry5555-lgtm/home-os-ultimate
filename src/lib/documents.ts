import { supabase, isCloud } from './supabase'
import { demo, uid, getMyProfile } from './db'

export const DOC_CATEGORIES = ['general','receipt','invoice','contract','photo','plan','other'] as const
export type DocCategory = typeof DOC_CATEGORIES[number]
export const DOC_ENTITY_TYPES = ['transaction','task','request','room','stage','asset','event','maintenance'] as const
export type DocEntityType = typeof DOC_ENTITY_TYPES[number]
export type DocVisibility = 'family' | 'owner_only'
export const BUCKET = 'homeos-docs'

export interface FamilyDocument {
  id: string; title: string; category: DocCategory; visibility: DocVisibility
  path: string; mimeType: string | null; byteSize: number | null
  entityType: DocEntityType | null; entityId: string | null; tags: string[]
  ownerId: string; createdAt: string
}

interface DemoDocument extends FamilyDocument { dataUrl?: string }

function dload() {
  const s = demo.load() as ReturnType<typeof demo.load> & { documents?: DemoDocument[] }
  if (!s.documents) s.documents = []
  return s
}

async function canSeeOwnerOnly(): Promise<boolean> {
  const me = await getMyProfile()
  return me?.role === 'owner'
}

function toDoc(d: DemoDocument): FamilyDocument {
  const { dataUrl: _ignored, ...doc } = d
  return doc
}

// Storage path layout: {family_id}/{visibility}/{uuid}-{safe filename}
function buildPath(familyId: string, visibility: DocVisibility, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  return `${familyId}/${visibility}/${uid()}-${safe}`
}

export interface UploadInput {
  file: File; title: string; category: DocCategory; visibility: DocVisibility
  entityType: DocEntityType | null; entityId: string | null; tags: string[]
}

// Uploads the binary to the private bucket and records metadata.
// Returns the storage path (stored in receipts/proofs/invoices fields).
export async function uploadDocument(input: UploadInput): Promise<string> {
  const me = await getMyProfile()
  if (!me) throw new Error('not authenticated')
  if (input.visibility === 'owner_only' && !(await canSeeOwnerOnly())) throw new Error('not allowed')
  const path = buildPath(me.family_id!, input.visibility, input.file.name)
  if (isCloud && supabase) {
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, { upsert: false })
    if (upErr) throw new Error(upErr.message)
    const { error } = await supabase.from('documents').insert({
      family_id: me.family_id, owner_id: me.id, bucket: BUCKET, path,
      title: input.title, category: input.category, visibility: input.visibility,
      mime_type: input.file.type || null, byte_size: input.file.size,
      entity_type: input.entityType, entity_id: input.entityId, tags: input.tags,
    })
    if (error) throw new Error(error.message)
    return path
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(input.file)
  })
  const s = dload()
  s.documents!.push({
    id: uid(), title: input.title, category: input.category, visibility: input.visibility,
    path, mimeType: input.file.type || null, byteSize: input.file.size,
    entityType: input.entityType, entityId: input.entityId, tags: input.tags,
    ownerId: me.id, createdAt: new Date().toISOString(), dataUrl,
  })
  demo.save(s)
  return path
}

// Metadata-only record for files that were uploaded through another flow.
export async function registerDocument(input: Omit<UploadInput, 'file'> & { path: string; mimeType: string | null; byteSize: number | null }): Promise<void> {
  const me = await getMyProfile()
  if (!me) return
  if (isCloud && supabase) {
    await supabase.from('documents').insert({
      family_id: me.family_id, owner_id: me.id, bucket: BUCKET, path: input.path,
      title: input.title, category: input.category, visibility: input.visibility,
      mime_type: input.mimeType, byte_size: input.byteSize,
      entity_type: input.entityType, entity_id: input.entityId, tags: input.tags,
    })
    return
  }
  const s = dload()
  s.documents!.push({
    id: uid(), title: input.title, category: input.category, visibility: input.visibility,
    path: input.path, mimeType: input.mimeType, byteSize: input.byteSize,
    entityType: input.entityType, entityId: input.entityId, tags: input.tags,
    ownerId: me.id, createdAt: new Date().toISOString(),
  })
  demo.save(s)
}

export async function listDocuments(query = '', category: DocCategory | '' = ''): Promise<FamilyDocument[]> {
  if (isCloud && supabase) {
    let q = supabase.from('documents').select('*').order('created_at', { ascending: false })
    if (category) q = q.eq('category', category)
    if (query) q = q.or(`title.ilike.%${query}%,path.ilike.%${query}%`)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []).map(d => ({
      id: d.id, title: d.title, category: d.category, visibility: d.visibility,
      path: d.path, mimeType: d.mime_type, byteSize: d.byte_size,
      entityType: d.entity_type, entityId: d.entity_id, tags: d.tags ?? [],
      ownerId: d.owner_id, createdAt: d.created_at,
    }))
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me) return []
  const q = query.toLowerCase()
  return s.documents!
    .filter(d => d.visibility === 'family' || me.role === 'owner')
    .filter(d => !category || d.category === category)
    .filter(d => !q || d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q) || d.tags.some(t => t.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toDoc)
}

// Short-lived signed URL for preview/download. Never a public link.
export async function signedUrl(path: string, expiresIn = 3600): Promise<string> {
  if (isCloud && supabase) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn)
    if (error) throw new Error(error.message)
    return data.signedUrl
  }
  const s = dload()
  const doc = s.documents!.find(d => d.path === path)
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!doc || !me) throw new Error('file not found')
  if (doc.visibility === 'owner_only' && me.role !== 'owner') throw new Error('not allowed')
  return doc.dataUrl ?? ''
}

export async function deleteDocument(doc: FamilyDocument): Promise<void> {
  if (isCloud && supabase) {
    await supabase.from('documents').delete().eq('id', doc.id)
    await supabase.storage.from(BUCKET).remove([doc.path])
    return
  }
  const s = dload()
  const me = s.profiles.find(p => p.id === s.session?.userId)
  if (!me || (me.role !== 'owner' && doc.ownerId !== me.id)) throw new Error('not allowed')
  s.documents = s.documents!.filter(d => d.id !== doc.id)
  demo.save(s)
}
