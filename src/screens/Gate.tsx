import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { getMyProfile } from '../lib/db'
import { Logo } from '../components/ui'

// Decides where a signed-in user with no profile yet should go:
// no owner anywhere -> owner setup; has profile -> home.
export default function Gate() {
  const [state, setState] = useState<'loading' | 'setup' | 'home'>('loading')
  useEffect(() => {
    getMyProfile().then(p => setState(p ? 'home' : 'setup'))
  }, [])
  if (state === 'loading') {
    return <div className="h-full flex items-center justify-center"><Logo /></div>
  }
  return <Navigate to={state === 'setup' ? '/setup' : '/home/invitations'} replace />
}
