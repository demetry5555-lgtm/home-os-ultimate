import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassCard, GoldButton, Field, ErrorNote } from '../components/ui'
import { SelectField, EmptyState } from '../components/finance'
import { MoneyText } from '../components/finance'
import {
  createRequest, listRequests, FamilyRequest,
  REQUEST_TYPES, PRIORITIES, RequestType, Priority, RequestStatus,
} from '../lib/requests'
import { getMyProfile, listMembers, Profile } from '../lib/db'
import { parseAmount } from '../lib/money'
import { useT, Key } from '../i18n'

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useT()
  const styles: Record<RequestStatus, string> = {
    new: 'text-gold-electric border-gold-electric/40 bg-gold-electric/10',
    under_review: 'text-sky-300 border-sky-400/40 bg-sky-400/10',
    needs_info: 'text-amber-300 border-amber-400/40 bg-amber-400/10',
    approved: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
    partially_approved: 'text-emerald-200 border-emerald-300/40 bg-emerald-300/10',
    rejected: 'text-red-300 border-red-400/40 bg-red-400/10',
    deferred: 'text-muted border-muted/40 bg-muted/10',
    completed: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
    cancelled: 'text-muted border-muted/40 bg-muted/10',
  }
  return <span className={`text-xs font-bold px-3 py-1 rounded-full border ${styles[status]}`}>{t(('rs_' + status) as Key)}</span>
}

export default function Requests() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [items, setItems] = useState<FamilyRequest[]>([])
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState<RequestType>('money')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [amount, setAmount] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setItems(await listRequests())
    setMembers(await listMembers())
  }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => {}) }, [])

  const name = (id: string) => members.find(m => m.id === id)?.full_name ?? '—'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await createRequest({
        type, title: title.trim(), details: details.trim(),
        amountCents: amount ? parseAmount(amount) : null, priority,
      })
      setTitle(''); setDetails(''); setAmount(''); setShowForm(false)
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black gold-text">{t('requests')}</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-ghost !px-4 !py-2 text-sm">
          {showForm ? '×' : '+ ' + t('newRequest')}
        </button>
      </div>

      {showForm && (
        <GlassCard className="space-y-4">
          <form onSubmit={submit} className="space-y-4">
            <SelectField label={t('accType')} value={type} onChange={e => setType(e.target.value as RequestType)}>
              {REQUEST_TYPES.map(ty => <option key={ty} value={ty}>{t(('rq_' + ty) as Key)}</option>)}
            </SelectField>
            <Field label={t('title')} required value={title} onChange={e => setTitle(e.target.value)} />
            <Field label={t('description')} value={details} onChange={e => setDetails(e.target.value)} />
            {type === 'money' && (
              <Field label={t('amount')} inputMode="decimal" dir="ltr" value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            )}
            <SelectField label={t('priority')} value={priority} onChange={e => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{t(('pr_' + p) as Key)}</option>)}
            </SelectField>
            <ErrorNote message={error} />
            <GoldButton disabled={busy || !title.trim()}>{t('submit')}</GoldButton>
          </form>
        </GlassCard>
      )}

      <div className="space-y-3">
        {items.length === 0 && <EmptyState text={t('emptyRequests')} />}
        {items.map(r => (
          <Link key={r.id} to={`/home/requests/${r.id}`}>
            <GlassCard className="!p-4 space-y-2 hover:border-gold-electric/40 transition">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <p className="font-bold truncate">
                    <span className="text-muted text-xs font-mono" dir="ltr">#{r.requestNumber}</span> {r.title}
                  </p>
                  <p className="text-xs text-muted">
                    {t(('rq_' + r.type) as Key)} · {name(r.requesterId)} · {t(('pr_' + r.priority) as Key)}
                  </p>
                </div>
                <RequestStatusBadge status={r.status} />
              </div>
              {r.amountCents != null && <MoneyText cents={r.amountCents} className="text-gold-electric text-sm" />}
            </GlassCard>
          </Link>
        ))}
      </div>
    </div>
  )
}
