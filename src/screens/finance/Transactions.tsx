import { FormEvent, useEffect, useRef, useState } from 'react'
import { GlassCard, GoldButton, Field, ErrorNote } from '../../components/ui'
import { MoneyText, SelectField, EmptyState, SectionTitle } from '../../components/finance'
import { listRooms, listStages, Room, FinishingStage } from '../../lib/apartment'
import { uploadDocument } from '../../lib/documents'
import {
  listAccounts, listTransactions, recordIncome, recordExpense, transfer,
  canManageFinance, Account, Transaction, EXPENSE_CATEGORIES, INCOME_CATEGORIES,
} from '../../lib/finance'
import { getMyProfile, Profile } from '../../lib/db'
import { parseAmount } from '../../lib/money'
import { useT, Key } from '../../i18n'

type Mode = 'expense' | 'income' | 'transfer'

export default function Transactions() {
  const { t } = useT()
  const [me, setMe] = useState<Profile | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [items, setItems] = useState<Transaction[]>([])
  const [mode, setMode] = useState<Mode>('expense')
  const [accountId, setAccountId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [receiptName, setReceiptName] = useState<string | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [stages, setStages] = useState<FinishingStage[]>([])
  const [roomId, setRoomId] = useState('')
  const [stageId, setStageId] = useState('')
  const receiptRef = useRef<HTMLInputElement>(null)
  const [limit, setLimit] = useState(50)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canManage = me ? canManageFinance(me.role) : false

  async function refresh() {
    const [accs, txs] = await Promise.all([listAccounts(), listTransactions(limit)])
    setAccounts(accs); setItems(txs)
    listRooms().then(setRooms).catch(() => {})
    listStages().then(setStages).catch(() => {})
    if (!accountId && accs.length) setAccountId(accs[0].id)
    if (!toId && accs.length > 1) setToId(accs[1].id)
  }
  useEffect(() => { getMyProfile().then(setMe) }, [])
  useEffect(() => { refresh().catch(() => {}) }, [limit])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const cents = parseAmount(amount)
      if (mode === 'transfer') {
        await transfer(accountId, toId, cents, description)
      } else if (mode === 'income') {
        await recordIncome(accountId, cents, category, description)
      } else {
        let receiptPath: string | null = receiptName
        if (receiptFile) {
          receiptPath = await uploadDocument({
            file: receiptFile, title: receiptFile.name, category: 'receipt',
            visibility: 'family', entityType: 'transaction', entityId: null, tags: [],
          })
        }
        await recordExpense(accountId, cents, category, description, receiptPath, null, roomId || null, stageId || null)
      }
      setAmount(''); setDescription(''); setReceiptName(null); setReceiptFile(null)
      if (receiptRef.current) receiptRef.current.value = ''
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error'
      setError(msg === 'insufficient funds' ? t('insufficientFunds') : msg)
    } finally { setBusy(false) }
  }

  const catKey = (c: string) => ('cat_' + c) as Key
  const cats = mode === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? ''

  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-black gold-text">{t('recentTransactions')}</h1>

      {canManage && (
        <GlassCard className="space-y-4">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-white/[0.04]">
            {(['expense', 'income', 'transfer'] as Mode[]).map(m => (
              <button key={m} type="button" onClick={() => { setMode(m); setCategory(m === 'income' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]) }}
                className={`py-2 rounded-xl text-sm font-bold transition ${mode === m ? 'bg-gold/20 text-gold-electric' : 'text-muted'}`}>
                {t(m as Key)}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-4">
            <SelectField label={mode === 'transfer' ? t('from') : t('account')} value={accountId}
              onChange={e => {
                const v = e.target.value
                setAccountId(v)
                if (toId === v) setToId(accounts.find(a => a.id !== v)?.id ?? '')
              }}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </SelectField>
            {mode === 'transfer' && (
              <SelectField label={t('to')} value={toId} onChange={e => setToId(e.target.value)}>
                {accounts.filter(a => a.id !== accountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SelectField>
            )}
            <Field label={t('amount')} required inputMode="decimal" dir="ltr" value={amount}
              onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            {mode !== 'transfer' && (
              <SelectField label={t('category')} value={category} onChange={e => setCategory(e.target.value)}>
                {cats.map(c => <option key={c} value={c}>{t(catKey(c))}</option>)}
              </SelectField>
            )}
            <Field label={t('description')} value={description} onChange={e => setDescription(e.target.value)} />
            {mode === 'expense' && rooms.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <SelectField label={t('room')} value={roomId} onChange={e => { setRoomId(e.target.value); setStageId('') }}>
                  <option value="">—</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </SelectField>
                <SelectField label={t('stage')} value={stageId} onChange={e => setStageId(e.target.value)}>
                  <option value="">—</option>
                  {stages.filter(st => !roomId || st.roomId === roomId).map(st => <option key={st.id} value={st.id}>{st.stage}</option>)}
                </SelectField>
              </div>
            )}
            {mode === 'expense' && (
              <div>
                <label className="label-glass">{t('receipt')}</label>
                <input ref={receiptRef} type="file" accept="image/*,.pdf"
                  onChange={e => { const f = e.target.files?.[0] ?? null; setReceiptFile(f); setReceiptName(f?.name ?? null) }}
                  className="block w-full text-sm text-muted file:btn-ghost file:border-0 file:text-sm file:me-3" />
                {receiptName && <p className="text-xs text-gold-soft mt-1">✓ {receiptName}</p>}
              </div>
            )}
            <ErrorNote message={error} />
            <GoldButton disabled={busy || accounts.length === 0}>
              {mode === 'expense' ? t('addExpense') : mode === 'income' ? t('addIncome') : t('transfer')}
            </GoldButton>
          </form>
        </GlassCard>
      )}

      <div className="space-y-2">
        {items.length === 0 && <EmptyState text={t('emptyTransactions')} />}
        {items.map(x => (
          <GlassCard key={x.id} className="!p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{x.description || t(catKey(x.category))}</p>
              <p className="text-xs text-muted">
                {t(catKey(x.category))} · {accountName(x.accountId)} · {new Date(x.createdAt).toLocaleDateString()}
                {x.receiptPath && <span className="text-gold-soft"> · {t('receiptAttached')}</span>}
              </p>
            </div>
            <MoneyText
              cents={x.type === 'expense' ? -x.amountCents : x.amountCents}
              signed
              className={x.type === 'expense' ? 'text-red-300 shrink-0' : 'text-emerald-300 shrink-0'}
            />
          </GlassCard>
        ))}
        {items.length >= limit && (
          <button onClick={() => setLimit(l => l + 50)} className="w-full text-center text-xs text-gold-electric hover:underline py-2">{t('loadMore')}</button>
        )}
      </div>
    </div>
  )
}
