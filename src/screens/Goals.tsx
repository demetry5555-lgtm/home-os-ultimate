import { FormEvent, useEffect, useState } from 'react'
import { GlassCard, GoldButton, GhostButton, Field, ErrorNote } from '../components/ui'
import { addGoalProgress, createGoal, deleteGoal, GoalWithProgress, listGoals } from '../lib/db'
import { useT } from '../i18n'

export default function Goals() {
  const { t, lang } = useT()
  const [goals, setGoals] = useState<GoalWithProgress[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [unit, setUnit] = useState('')
  const [target, setTarget] = useState('')
  const [deadline, setDeadline] = useState('')
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() { setGoals(await listGoals()) }
  useEffect(() => { refresh().catch(() => {}) }, [])

  async function submitGoal(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await createGoal({ title: title.trim(), unit: unit.trim(), target: Number(target), deadline: deadline || null })
      setTitle(''); setUnit(''); setTarget(''); setDeadline(''); setShowForm(false)
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') } finally { setBusy(false) }
  }

  async function submitProgress(e: FormEvent, goalId: string) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await addGoalProgress(goalId, Number(amount), note.trim())
      setAmount(''); setNote(''); setOpenFor(null)
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') } finally { setBusy(false) }
  }

  async function removeGoal(goalId: string) {
    try { await deleteGoal(goalId); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'error') }
  }

  const fmt = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 })

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">{t('goals')}</h1>
        <GhostButton className="!py-2 !px-4 text-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? t('close') : `+ ${t('newGoal')}`}
        </GhostButton>
      </div>
      <ErrorNote message={error} />

      {showForm && (
        <GlassCard className="space-y-3 fade-in">
          <form onSubmit={submitGoal} className="space-y-3">
            <Field label={t('goalTitle')} required value={title} onChange={e => setTitle(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('target')} required type="number" min="0.01" step="any" value={target} onChange={e => setTarget(e.target.value)} dir="ltr" />
              <Field label={t('unit')} value={unit} onChange={e => setUnit(e.target.value)} placeholder={t('unitPh')} />
            </div>
            <Field label={t('deadline')} type="date" value={deadline} onChange={e => setDeadline(e.target.value)} dir="ltr" />
            <GoldButton disabled={busy || !title.trim() || !(Number(target) > 0)}>{t('addGoal')}</GoldButton>
          </form>
        </GlassCard>
      )}

      {goals.length === 0 && !showForm && (
        <GlassCard className="glass-inner border-dashed text-center py-8">
          <p className="text-muted">{t('noGoals')}</p>
        </GlassCard>
      )}

      {goals.map(g => {
        const pct = Math.min(100, Math.round((g.total / g.target_value) * 100))
        const done = g.status === 'achieved'
        return (
          <GlassCard key={g.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-lg leading-tight">{g.title}</p>
                {g.deadline && <p className="text-[11px] text-muted mt-0.5" dir="ltr">{g.deadline}</p>}
              </div>
              {done
                ? <span className="shrink-0 text-xs font-black px-3 py-1 rounded-full border border-gold/40 gold-text">{t('achieved')}</span>
                : <span className="shrink-0 text-xs font-bold text-gold-electric" dir="ltr">{pct}%</span>}
            </div>

            <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden border border-white/[0.07]">
              <div className="h-full rounded-full transition-all duration-700 spring"
                style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #E0C184, #FFDD8F)', boxShadow: '0 0 14px rgba(255,221,143,0.45)' }} />
            </div>
            <p className="text-sm text-muted" dir="ltr">
              <span className="text-ivory font-bold">{fmt(g.total)}</span> / {fmt(g.target_value)} {g.unit}
            </p>

            {g.entries.slice(0, 3).map(p => (
              <div key={p.id} className="glass-inner px-3 py-2 flex items-center justify-between text-sm">
                <span className="text-muted truncate">{p.member_name}{p.note ? ` · ${p.note}` : ''}</span>
                <span className="font-bold text-gold-soft shrink-0" dir="ltr">{p.amount > 0 ? '+' : ''}{fmt(p.amount)}</span>
              </div>
            ))}

            {openFor === g.id ? (
              <form onSubmit={e => submitProgress(e, g.id)} className="space-y-2 fade-in">
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('amount')} required type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} dir="ltr" />
                  <Field label={t('noteOptional')} value={note} onChange={e => setNote(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <GoldButton disabled={busy || !(Number(amount) !== 0)}>{t('addProgress')}</GoldButton>
                  <GhostButton type="button" onClick={() => setOpenFor(null)}>{t('close')}</GhostButton>
                </div>
              </form>
            ) : (
              <div className="flex gap-2">
                {!done && <GhostButton className="!py-2 text-sm" onClick={() => { setOpenFor(g.id); setAmount(''); setNote('') }}>+ {t('addProgress')}</GhostButton>}
                <GhostButton className="!py-2 text-sm" onClick={() => removeGoal(g.id)}>{t('delete')}</GhostButton>
              </div>
            )}
          </GlassCard>
        )
      })}
    </div>
  )
}
