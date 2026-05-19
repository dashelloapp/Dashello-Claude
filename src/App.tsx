import { useEffect, useState, useRef } from 'react'
import { supabase } from './lib/supabase'
import AuthScreen from './components/AuthScreen'
import DashelloDashboard from './DashelloDashboard'
import { TranslationProvider } from './i18n'

function DashelloLoader({ color = '#fafafa', size = 80 }: { color?: string; size?: number }) {
  const s = size / 321;
  const dots = [
    { w: 16.2*s, h: 15.2*s, ml: 0 },
    { w: 22.9*s, h: 25.2*s, ml: 1*s },
    { w: 28.4*s, h: 34.1*s, ml: 2*s },
  ];
  return (
    <div style={{ display:'flex', alignItems:'flex-end', background:'transparent' }}>
      {dots.map((d, i) => (
        <div key={i} style={{
          width: d.w, height: d.h,
          marginLeft: d.ml,
          borderRadius: '50%',
          background: color,
          animation: `dashPop${i+1} 2.4s cubic-bezier(0.34,1.56,0.64,1) infinite`,
        }} />
      ))}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const loadStartRef = useRef(Date.now())

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const elapsed = Date.now() - loadStartRef.current;
      const remaining = 1200 - elapsed;
      if (remaining > 0) {
        setTimeout(() => { setSession(session); setLoading(false); }, remaining);
      } else {
        setSession(session);
        setLoading(false);
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div style={{
      display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)'
    }}>
      <DashelloLoader size={180} />
    </div>
  )

  if (!session) return <AuthScreen />

  return <TranslationProvider><DashelloDashboard /></TranslationProvider>
}
