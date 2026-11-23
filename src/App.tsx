import { useEffect, useMemo, useState } from 'react'
import { HashRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { LangContext, Lang, translate, Key } from './i18n'
import { getSession } from './lib/db'
import Splash from './screens/Splash'
import Login from './screens/Login'
import Gate from './screens/Gate'
import OwnerSetup from './screens/OwnerSetup'
import InviteRegister from './screens/InviteRegister'
import Home from './screens/Home'
import Invitations from './screens/Invitations'
import ProfilePage from './screens/Profile'
import Dashboard from './screens/finance/Dashboard'
import Goals from './screens/Goals'
import CheckIn from './screens/CheckIn'
import FinanceHub from './screens/finance/FinanceHub'
import Accounts from './screens/finance/Accounts'
import Transactions from './screens/finance/Transactions'
import Loans from './screens/finance/Loans'
import Salaries from './screens/finance/Salaries'
import Budgets from './screens/finance/Budgets'
import Reports from './screens/finance/Reports'
import Bills from './screens/finance/Bills'
import Settings from './screens/Settings'
import Requests from './screens/Requests'
import RequestDetail from './screens/RequestDetail'
import Chat from './screens/Chat'
import ChatThread from './screens/ChatThread'
import Tasks from './screens/Tasks'
import TaskDetail from './screens/TaskDetail'
import Calendar from './screens/Calendar'
import ApartmentPage from './screens/Apartment'
import RoomDetail from './screens/RoomDetail'
import Documents from './screens/Documents'
import Notifications from './screens/Notifications'
import Search from './screens/Search'

function RequireAuth() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading')
  useEffect(() => { getSession().then(s => setState(s ? 'in' : 'out')) }, [])
  if (state === 'loading') return <div className="h-full" />
  return state === 'in' ? <Outlet /> : <Navigate to="/login" replace />
}

const LANG_KEY = 'homeos.lang'

export default function App() {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_KEY)
    return saved === 'ar' || saved === 'en' ? saved : 'en'   // English-first per owner decision
  })
  const setLang = (l: Lang) => { localStorage.setItem(LANG_KEY, l); setLangState(l) }
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])
  const ctx = useMemo(() => ({
    lang,
    setLang,
    t: (k: Key) => translate(lang, k),
  }), [lang])

  return (
    <LangContext.Provider value={ctx}>
      <div className="electric-bg" />
      <div className="relative h-full">
        <button
          onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          className="fixed safe-top-lg end-3 z-20 text-xs font-bold text-muted hover:text-gold-electric transition border border-white/10 rounded-full px-3 py-1 backdrop-blur"
        >
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Splash />} />
            <Route path="/login" element={<Login />} />
            <Route path="/join" element={<InviteRegister />} />
            <Route element={<RequireAuth />}>
              <Route path="/gate" element={<Gate />} />
              <Route path="/setup" element={<OwnerSetup />} />
              <Route path="/home" element={<Home />}>
                <Route index element={<Dashboard />} />
                <Route path="goals" element={<Goals />} />
                <Route path="checkin" element={<CheckIn />} />
                <Route path="invitations" element={<Invitations />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="finance" element={<FinanceHub />} />
                <Route path="finance/accounts" element={<Accounts />} />
                <Route path="finance/transactions" element={<Transactions />} />
                <Route path="finance/loans" element={<Loans />} />
                <Route path="finance/salaries" element={<Salaries />} />
                <Route path="finance/budgets" element={<Budgets />} />
                <Route path="finance/reports" element={<Reports />} />
                <Route path="finance/bills" element={<Bills />} />
                <Route path="settings" element={<Settings />} />
                <Route path="requests" element={<Requests />} />
                <Route path="requests/:id" element={<RequestDetail />} />
                <Route path="chat" element={<Chat />} />
                <Route path="chat/:id" element={<ChatThread />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="tasks/:id" element={<TaskDetail />} />
                <Route path="calendar" element={<Calendar />} />
                <Route path="apartment" element={<ApartmentPage />} />
                <Route path="apartment/rooms/:id" element={<RoomDetail />} />
                <Route path="documents" element={<Documents />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="search" element={<Search />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </div>
    </LangContext.Provider>
  )
}
