import { FormEvent, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../components/ui'
import { SelectField, EmptyState, SectionTitle, MoneyText } from '../components/finance'
import { RequestStatusBadge } from './Requests'
import {
  getRequest, decideRequest, cancelRequest, listComments, addComment, listEvents,
  nextStatuses, canCancel, isDecider, linkRequestTransaction,
  FamilyRequest, RequestComment, RequestEvent, RequestStatus,
} from '../lib/requests'
import { getMyProfile, listMembers, Profile } from '../lib/db'
import { listAccounts, recordExpense, listTransactions, Account } from '../lib/finance'
import { useT, Key } from '../i18n'

const ACTION_LABELS: Partial<Record<RequestStatus, Key>> = {
  under_review: 'underReview', needs_info: 'needInfo', approved: 'approve',
  partially_approved: 'approvePartial', rejected: 'reject', deferred: 'defer', completed: 'markComplete',
}

export default function RequestDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [req, setReq] = useState<FamilyRequest | null>(null)
  const [comments, setComments] = useState<RequestComment[]>([])
  const [events, setEvents] = useState<RequestEvent[]>([])
  const [decider, setDecider] = useState(false)
  const [actionFor, setActionFor] = useState<RequestStatus | null>(null)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [payAccount, setPayAccount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const r = await getRequest(id!)
    if (!r) { navigate('/home/requests', { replace: true }); return }
    setReq(r)
    setComments(await listComments(id!))
    setEvents(await listEvents(id!))
    setMembers(await listMembers())
    setDecider(await isDecider())
    const accs = await listAccounts().catch(() => [])
    setAccounts(accs)
    if (!payAccount && accs.length) setPayAccount(accs[0].id)
  }
  useEffect(() => { getMyProfile().then(setMe); refresh().catch(() => {}) }, [id])

  const name = (pid: string) => members.find(m => m.id === pid)?.full_name ?? '—'

  async function decide(to: RequestStatus) {
    setBusy(true); setError(null)
    try {
      await decideRequest(id!, to, reason.trim())
      setActionFor(null); setReason('')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') }
    finally { setBusy(false) }
  }

  async function recordExpenseAndLink() {
    if (!req?.amountCents) return
    setBusy(true); setError(null)
    try {
      await recordExpense(payAccount, req.amountCents, 'other', `${t('requests')}: ${req.title}`, null, req.requesterId)
      const txs = await listTransactions(1)
      if (txs[0]) await linkRequestTransaction(req.id, txs[0].id)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error'
      setError(msg === 'insufficient funds' ? t('insufficientFunds') : msg)
    } finally { setBusy(false) }
  }

  async function postComment(e: FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return
    setBusy(true)
    try { await addComment(id!, comment.trim()); setComment(''); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'error') }
    finally { setBusy(false) }
  }

  if (!req) return null
  const mine = me?.id === req.requesterId
  const actions = decider ? nextStatuses(req.status) : []

  return (
    <div className="space-y-5 fade-in">
      <button onClick={() => navigate('/home/requests')} className="text-sm text-muted hover:text-ivory"><span className="back-arrow">←</span> {t('requests')}</button>

      <GlassCard className="space-y-3">
        <div className="flex justify-between items-start gap-2">
          <div>
            <h1 className="text-xl font-black">
              <span className="text-muted text-sm font-mono" dir="ltr">#{req.requestNumber}</span> {req.title}
            </h1>
            <p className="text-xs text-muted mt-1">
              {t(('rq_' + req.type) as Key)} · {name(req.requesterId)} · {t(('pr_' + req.priority) as Key)} · {new Date(req.createdAt).toLocaleDateString()}
            </p>
          </div>
          <RequestStatusBadge status={req.status} />
        </div>
        {req.details && <p className="text-sm text-ivory/90">{req.details}</p>}
        {req.amountCents != null && <MoneyText cents={req.amountCents} className="text-lg gold-text" />}
        {req.linkedTransactionId && <p className="text-xs text-emerald-300">✓ {t('linkedToFinance')}</p>}
      </GlassCard>

      {actions.length > 0 && (
        <GlassCard className="space-y-3">
          <SectionTitle>{t('decide')}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {actions.map(a => (
              <GhostButton key={a} className="!px-4 !py-2 text-sm"
                onClick={() => { setActionFor(actionFor === a ? null : a); setReason('') }}>
                {t(ACTION_LABELS[a]!)}
              </GhostButton>
            ))}
          </div>
          {actionFor && (
            <div className="glass-inner p-3 space-y-3">
              <Field label={t('reason')} value={reason} onChange={e => setReason(e.target.value)} />
              <GoldButton disabled={busy} onClick={() => decide(actionFor)}>{t(ACTION_LABELS[actionFor]!)}</GoldButton>
            </div>
          )}
          {req.type === 'money' && req.amountCents != null
            && ['approved', 'partially_approved'].includes(req.status) && !req.linkedTransactionId && (
            <div className="glass-inner p-3 space-y-3">
              <SelectField label={t('account')} value={payAccount} onChange={e => setPayAccount(e.target.value)}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SelectField>
              <GoldButton disabled={busy || accounts.length === 0} onClick={recordExpenseAndLink}>
                {t('linkExpense')} — <MoneyText cents={req.amountCents} />
              </GoldButton>
            </div>
          )}
        </GlassCard>
      )}

      {mine && canCancel(req.status) && (
        <GhostButton className="w-full !border-red-400/40 !text-red-300"
          onClick={async () => { await cancelRequest(req.id); await refresh() }}>
          {t('cancelRequest')}
        </GhostButton>
      )}
      <ErrorNote message={error} />

      <GlassCard className="space-y-3">
        <SectionTitle>{t('comments')}</SectionTitle>
        {comments.length === 0 && <p className="text-sm text-muted">{t('emptyComments')}</p>}
        {comments.map(c => (
          <div key={c.id} className="glass-inner p-3">
            <p className="text-xs text-gold-soft">{name(c.authorId)} · {new Date(c.createdAt).toLocaleString()}</p>
            <p className="text-sm mt-1">{c.body}</p>
          </div>
        ))}
        <form onSubmit={postComment} className="flex gap-2">
          <input value={comment} onChange={e => setComment(e.target.value)}
            className="input-glass flex-1" placeholder={t('typeMessage')} />
          <GoldButton className="!w-auto !px-4" disabled={busy || !comment.trim()}>{t('send')}</GoldButton>
        </form>
      </GlassCard>

      <GlassCard className="space-y-2">
        <SectionTitle>{t('history')}</SectionTitle>
        {events.map(e => (
          <div key={e.id} className="text-xs text-muted border-s-2 border-gold/30 ps-3 py-1">
            <span className="text-ivory font-semibold">{name(e.actorId)}</span>
            {e.action === 'decision' && <> {t(('rs_' + e.toStatus!) as Key)}</>}
            {e.action === 'cancel' && <> {t('rs_cancelled')}</>}
            {e.action === 'link_transaction' && <> · {t('linkedToFinance')}</>}
            {e.reason && e.action === 'decision' && <>: {e.reason}</>}
            <span className="block" dir="ltr">{new Date(e.createdAt).toLocaleString()}</span>
          </div>
        ))}
        {events.length === 0 && <p className="text-xs text-muted">—</p>}
      </GlassCard>
    </div>
  )
}
