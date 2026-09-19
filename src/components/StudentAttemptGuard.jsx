import { Navigate, Outlet } from 'react-router-dom'
import { useStudentAttempt } from '../contexts/StudentAttemptContext'
import { readRecoveryMarker } from '../utils/examRecovery'

export default function StudentAttemptGuard() {
  const { sessionToken, loading } = useStudentAttempt()

  if (loading) return <div className="route-loading">Recuperando tu intento…</div>
  if (!sessionToken) {
    const marker = readRecoveryMarker()
    return <Navigate to="/acceso" replace state={{ recoveryRequired: Boolean(marker), reason: marker ? 'SESSION_MISSING' : null }} />
  }
  return <Outlet />
}
