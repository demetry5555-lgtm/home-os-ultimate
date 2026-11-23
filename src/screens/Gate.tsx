import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { getMyProfileStrict } from '../lib/db'
import { GlassCard, GoldButton, Logo } from '../components/ui'
import { useT } from '../i18n'

// Decides where a signed-in user goes: profile exists -> home; none -> owner setup.
// A fetch error shows a retry instead of ever falling through to setup.
export default function Gate() {
  const { t } = useT()
  const [state, setState] = useState<'loading' | 'setup' | 'home' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    getMyProfileStrict()
      .then(p => { if (alive) setState(p ? 'home' : 'setup') })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [attempt])
  if (state === 'loading') {
    return <div className="h-full flex items-center justify-center"><Logo /></div>
  }
  if (state === 'error') {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <GlassCard className="w-full max-w-sm text-center space-y-4">
          <p className="text-sm text-muted">{t('connectionError')}</p>
          <GoldButton onClick={() => { setState('loading'); setAttempt(a => a + 1) }}>{t('tryAgain')}</GoldButton>
        </GlassCard>
      </div>
    )
  }
  return <Navigate to={state === 'setup' ? '/setup' : '/home/invitations'} replace />
}
