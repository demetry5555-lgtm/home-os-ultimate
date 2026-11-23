import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Logo } from '../components/ui'
import { useT } from '../i18n'

export default function Splash() {
  const navigate = useNavigate()
  const { t } = useT()
  useEffect(() => {
    const timer = setTimeout(() => navigate('/login', { replace: true }), 2200)
    return () => clearTimeout(timer)
  }, [navigate])
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6">
      <div className="splash-veil"><Logo size="lg" /></div>
      <p className="text-muted text-sm tracking-widest">{t('tagline')}</p>
      <div className="w-40 h-px bg-gradient-to-r from-transparent via-gold-electric/70 to-transparent shadow-goldglow" />
    </div>
  )
}
