import { useEffect, useState } from 'react'
import { GlassCard, GoldButton, ErrorNote } from '../components/ui'
import { CheckinWithName, listTodayCheckins, Mood, myCheckinStreak, myCheckinToday, upsertCheckin } from '../lib/db'
import { useT } from '../i18n'

const MOODS: { key: Mood; emoji: string; labelKey: 'moodGreat' | 'moodGood' | 'moodOkay' | 'moodTired' | 'moodStressed' | 'moodSad' }[] = [
  { key: 'great', emoji: '🤩', labelKey: 'moodGreat' },
  { key: 'good', emoji: '🙂', labelKey: 'moodGood' },
  { key: 'okay', emoji: '😐', labelKey: 'moodOkay' },
  { key: 'tired', emoji: '😴', labelKey: 'moodTired' },
  { key: 'stressed', emoji: '😰', labelKey: 'moodStressed' },
  { key: 'sad', emoji: '😢', labelKey: 'moodSad' },
]
const moodEmoji = (m: Mood) => MOODS.find(x => x.key === m)?.emoji ?? '❔'

export default function CheckIn() {
  const { t } = useT()
  const [mine, setMine] = useState<{ mood: Mood; note: string } | null>(null)
  const [mood, setMood] = useState<Mood | null>(null)
  const [note, setNote] = useState('')
  const [feed, setFeed] = useState<CheckinWithName[]>([])
  const [streak, setStreak] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  async function refresh() {
    const [m, f, s] = await Promise.all([myCheckinToday(), listTodayCheckins(), myCheckinStreak()])
    setMine(m ? { mood: m.mood, note: m.note } : null)
    if (m) { setMood(m.mood); setNote(m.note) }
    setFeed(f)
    setStreak(s)
  }
  useEffect(() => { refresh().catch(() => {}) }, [])

  async function save() {
    if (!mood) return
    setBusy(true); setError(null)
    try {
      await upsertCheckin(mood, note.trim())
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800)
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'error') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">{t('dailyCheckIn')}</h1>
        {streak > 0 && (
          <span className="text-xs font-black px-3 py-1.5 rounded-full border border-gold/40 gold-text" dir="ltr">
            🔥 {streak} {t('streakDays')}
          </span>
        )}
      </div>
      <ErrorNote message={error} />

      <GlassCard className="space-y-4">
        <p className="font-bold">{t('moodQuestion')}</p>
        <div className="grid grid-cols-6 gap-2">
          {MOODS.map(m => (
            <button key={m.key} type="button" onClick={() => setMood(m.key)} aria-label={t(m.labelKey)}
              className={`tappable flex flex-col items-center gap-1 py-2 rounded-[16px] border transition-all duration-200 ${mood === m.key ? 'border-gold/60 scale-110' : 'border-white/10 hover:border-white/25'}`}
              style={mood === m.key ? { background: 'linear-gradient(150deg, rgba(255,221,143,0.20), rgba(224,193,132,0.08))', boxShadow: '0 6px 20px rgba(255,221,143,0.18)' } : {}}>
              <span className="text-2xl">{m.emoji}</span>
              <span className={`text-[10px] font-bold ${mood === m.key ? 'text-gold-soft' : 'text-muted'}`}>{t(m.labelKey)}</span>
            </button>
          ))}
        </div>
        <input className="input-glass" value={note} onChange={e => setNote(e.target.value)} placeholder={t('noteOptional')} maxLength={140} />
        <GoldButton disabled={busy || !mood} onClick={save}>
          {savedFlash ? `✓ ${t('saved')}` : mine ? t('updateCheckin') : t('saveCheckin')}
        </GoldButton>
      </GlassCard>

      <h2 className="font-bold text-lg">{t('familyToday')}</h2>
      {feed.length === 0 && (
        <GlassCard className="glass-inner border-dashed text-center py-6">
          <p className="text-muted">{t('noCheckins')}</p>
        </GlassCard>
      )}
      {feed.map(c => (
        <GlassCard key={c.id} className="flex items-center gap-3 !py-3">
          <span className="text-3xl shrink-0">{moodEmoji(c.mood)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate">{c.member_name}</p>
            {c.note && <p className="text-sm text-muted truncate">{c.note}</p>}
          </div>
          <span className="text-[11px] text-muted shrink-0" dir="ltr">
            {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </GlassCard>
      ))}
    </div>
  )
}
