import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function TeacherProtectedRoute() {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="route-loading">Verificando sesión docente…</div>
  if (!user || !profile) return <Navigate to="/docente/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
