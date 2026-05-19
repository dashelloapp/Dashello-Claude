import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = async () => {
    if (!email || !password) return
    setLoading(true)
    setMessage('')
    const { error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    if (error) setMessage(error.message)
    else if (mode === 'signup') setMessage('Check your email to confirm your account!')
    setLoading(false)
  }

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://app.dashello.co' }
    })
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: '1.5px solid #e2e8f0', fontSize: 15, outline: 'none',
    boxSizing: 'border-box', marginBottom: 12, fontFamily: 'Inter, sans-serif'
  }
  const btn = (bg: string, color = '#fff'): React.CSSProperties => ({
    width: '100%', padding: '13px 0', borderRadius: 10, border: 'none',
    background: bg, color, fontSize: 15, fontWeight: 600, cursor: 'pointer',
    marginBottom: 10, fontFamily: 'Inter, sans-serif'
  })

  return (
    <div style={{
      display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)', fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{
        background: '#fff', borderRadius: 24, padding: '44px 40px 36px',
        width: '100%', maxWidth: 420, boxShadow: '0 32px 80px rgba(0,0,0,0.18)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="https://dashello.co/wp-content/uploads/2023/08/Logo.png"
            alt="Dashello"
            style={{ height: 48, marginBottom: 12, objectFit: 'contain' }}
          />
          <div style={{ fontSize: 15, color: '#94a3b8' }}>
            {mode === 'login' ? 'Sign in to your dashboard' : 'Create your account'}
          </div>
        </div>

        <input style={inp} placeholder="Email address" value={email}
          onChange={e => setEmail(e.target.value)} type="email" />
        <input style={inp} placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)} type="password" />

        <button style={btn('linear-gradient(135deg,#3B82F6,#06B6D4)')}
          onClick={handleSubmit} disabled={loading}>
          {loading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>

        <button style={btn('#fff', '#1a2332')}
          onClick={handleGoogle}>
          <span style={{ marginRight: 8 }}>G</span> Continue with Google
        </button>

        {message && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8,
            background: message.includes('Check') ? '#f0fdf4' : '#fef2f2',
            color: message.includes('Check') ? '#15803d' : '#dc2626', fontSize: 15
          }}>{message}</div>
        )}

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 15, color: '#94a3b8' }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <span onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage('') }}
            style={{ color: '#3B82F6', cursor: 'pointer', fontWeight: 600 }}>
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </span>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 15, color: '#cbd5e1' }}>
          <a href="https://dashello.co/terms-and-privacy/" target="_blank" rel="noreferrer"
            style={{ color: '#94a3b8', textDecoration: 'underline' }}>
            Privacy Policy & Terms
          </a>
        </div>
      </div>
    </div>
  )
}
