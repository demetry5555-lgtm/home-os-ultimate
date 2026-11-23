import { FormEvent, useEffect, useRef, useState } from 'react'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../components/ui'
import { SelectField, EmptyState } from '../components/finance'
import {
  uploadDocument, listDocuments, signedUrl, deleteDocument,
  FamilyDocument, DocCategory, DOC_CATEGORIES, DocVisibility,
} from '../lib/documents'
import { getMyProfile, Profile } from '../lib/db'
import { useT, Key } from '../i18n'

export default function Documents() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [docs, setDocs] = useState<FamilyDocument[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<DocCategory | ''>('')
  const [showForm, setShowForm] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [cat, setCat] = useState<DocCategory>('general')
  const [vis, setVis] = useState<DocVisibility>('family')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<FamilyDocument | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function refresh(q = query, c = category) {
    setDocs(await listDocuments(q, c))
  }
  useEffect(() => { getMyProfile().then(setMe); refresh('', '').catch(() => {}) }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true); setError(null)
    try {
      await uploadDocument({
        file, title: title.trim() || file.name, category: cat, visibility: vis,
        entityType: null, entityId: null, tags: [],
      })
      setFile(null); setTitle(''); setShowForm(false)
      if (fileRef.current) fileRef.current.value = ''
      await refresh()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  async function openPreview(doc: FamilyDocument) {
    setError(null)
    try {
      const url = await signedUrl(doc.path)
      if (doc.mimeType?.startsWith('image/')) {
        setPreviewDoc(doc); setPreviewUrl(url)
      } else {
        window.open(url, '_blank')
      }
    } catch (err) { setError((err as Error).message) }
  }

  async function download(doc: FamilyDocument) {
    try {
      const url = await signedUrl(doc.path)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.title
      a.click()
    } catch (err) { setError((err as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black gold-text">{t('documents')}</h1>
        <GhostButton onClick={() => setShowForm(v => !v)} className="text-sm px-4 py-2">{t('upload')}</GhostButton>
      </div>

      <div className="flex gap-2">
        <input className="input-glass flex-1" placeholder={t('searchDocs')} value={query}
          onChange={e => { setQuery(e.target.value); refresh(e.target.value, category).catch(() => {}) }} />
        <select className="input-glass !w-auto" value={category}
          onChange={e => { const c = e.target.value as DocCategory | ''; setCategory(c); refresh(query, c).catch(() => {}) }}>
          <option value="">{t('allCategories')}</option>
          {DOC_CATEGORIES.map(c => <option key={c} value={c}>{t(('dcat_' + c) as Key)}</option>)}
        </select>
      </div>

      {showForm && (
        <GlassCard>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label-glass">{t('chooseFile')}</label>
              <input ref={fileRef} type="file" accept="image/*,.pdf"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted file:btn-ghost file:border-0 file:text-sm file:me-3" />
            </div>
            <Field label={t('docTitle')} value={title} onChange={e => setTitle(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <SelectField label={t('category')} value={cat} onChange={e => setCat(e.target.value as DocCategory)}>
                {DOC_CATEGORIES.map(c => <option key={c} value={c}>{t(('dcat_' + c) as Key)}</option>)}
              </SelectField>
              <SelectField label={t('visibility')} value={vis} onChange={e => setVis(e.target.value as DocVisibility)}>
                <option value="family">{t('vis_family')}</option>
                {me?.role === 'owner' && <option value="owner_only">{t('vis_owner_only')}</option>}
              </SelectField>
            </div>
            <ErrorNote message={error} />
            <GoldButton disabled={busy || !file}>{t('upload')}</GoldButton>
          </form>
        </GlassCard>
      )}

      {docs.length === 0 && !showForm && <EmptyState text={t('noDocuments')} />}

      {docs.map(d => (
        <GlassCard key={d.id} className="!p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">{d.title}</p>
              <p className="text-xs text-muted">
                {t(('dcat_' + d.category) as Key)}
                {d.visibility === 'owner_only' ? ` · ${t('vis_owner_only')}` : ''}
                {d.byteSize != null ? ` · ${Math.ceil(d.byteSize / 1024)} KB` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openPreview(d)} className="text-xs text-gold-electric hover:underline">{t('preview')}</button>
              <button onClick={() => download(d)} className="text-xs text-muted hover:text-ivory">{t('download')}</button>
              {me && (me.role === 'owner' || d.ownerId === me.id) && (
                <button onClick={() => deleteDocument(d).then(() => refresh()).catch(err => setError(err.message))}
                  className="text-xs text-red-300 hover:underline">{t('delete')}</button>
              )}
            </div>
          </div>
        </GlassCard>
      ))}

      {previewUrl && previewDoc && (
        <div className="fixed inset-0 z-30 bg-obsidian/90 flex flex-col items-center justify-center p-4"
          onClick={() => { setPreviewUrl(null); setPreviewDoc(null) }}>
          <p className="text-sm font-bold mb-2">{previewDoc.title}</p>
          <img src={previewUrl} alt={previewDoc.title} className="max-w-full max-h-[70vh] rounded-2xl border border-gold/20" />
        </div>
      )}
    </div>
  )
}
