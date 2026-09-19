import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function TeacherLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, loading: authLoading, signIn, isConfigured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!authLoading && user && profile) {
      navigate(location.state?.from || '/docente/dashboard', { replace: true })
    }
  }, [authLoading, user, profile, navigate, location.state])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!email.trim() || !password) {
      setMessage('Ingresa el correo y la contraseña.')
      return
    }

    setSubmitting(true)
    setMessage('')
    const result = await signIn(email.trim(), password)
    setSubmitting(false)

    if (!result.ok) {
      setMessage(result.message)
      return
    }

    navigate(location.state?.from || '/docente/dashboard', { replace: true })
  }

  return (
    <section className="login-wrap">
      <form className="auth-card teacher-login" onSubmit={handleSubmit}>
        <p className="eyebrow">Área docente</p>
        <h1>Iniciar sesión</h1>
        <p>Acceso protegido mediante Supabase Auth. Solo las cuentas registradas como docente o administrador pueden entrar al panel.</p>

        {!isConfigured && (
          <div className="form-alert warning">
            Configura <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> antes de iniciar sesión.
          </div>
        )}

        {message && <div className="form-alert danger" role="alert">{message}</div>}

        <label>
          Correo institucional
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            placeholder="docente@universidad.edu.pe"
            disabled={!isConfigured || submitting}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            disabled={!isConfigured || submitting}
          />
        </label>
        <button className="button primary full" type="submit" disabled={!isConfigured || submitting}>
          {submitting ? 'Verificando…' : 'Ingresar al panel'}
        </button>
      </form>
    </section>
  )
}
