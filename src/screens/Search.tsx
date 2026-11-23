import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassCard } from '../components/ui'
import { EmptyState } from '../components/finance'
import { globalSearch, SearchHit } from '../lib/search'
import { useT, Key } from '../i18n'

const SECTIONS = ['members','requests','tasks','finance','apartment','calendar','documents'] as const

export default function Search() {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); return }
    setSearching(true)
    const timer = setTimeout(() => {
      globalSearch(query).then(h => { setHits(h); setSearching(false) }).catch(() => setSearching(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-black gold-text">{t('search')}</h1>
      <input autoFocus className="input-glass w-full" placeholder={t('searchPlaceholder')}
        value={query} onChange={e => setQuery(e.target.value)} />
      {query.trim().length >= 2 && hits.length === 0 && !searching && <EmptyState text={t('noResults')} />}
      {SECTIONS.map(sec => {
        const secHits = hits.filter(h => h.section === sec)
        if (!secHits.length) return null
        return (
          <div key={sec}>
            <p className="label-glass">{t(('sec_' + sec) as Key)}</p>
            {secHits.map(h => (
              <Link key={sec + h.id} to={h.link}>
                <GlassCard className="!p-3 mb-2 hover:border-gold/30 transition">
                  <p className="font-bold text-sm">{h.title}</p>
                  <p className="text-xs text-muted">{h.subtitle}</p>
                </GlassCard>
              </Link>
            ))}
          </div>
        )
      })}
    </div>
  )
}
