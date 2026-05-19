import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { supabase } from './lib/supabase'
import AuthScreen from './components/AuthScreen'
import DashelloDashboard from './DashelloDashboard'

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div style={{
      display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)',
      fontSize: 18, color: '#fff', fontFamily: 'Inter, sans-serif'
    }}>
      Loading...
    </div>
  )

  if (!session) return (
    <>
      <AuthScreen />
      <Analytics />
    </>
  )

  return (
    <>
      <DashelloDashboard />
      <Analytics />
    </>
  )
}
