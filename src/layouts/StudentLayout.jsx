import { Outlet, useLocation } from 'react-router-dom'
import Brand from '../components/Brand'
import { useStudentAttempt } from '../contexts/StudentAttemptContext'

export default function StudentLayout() {
  const { attemptData } = useStudentAttempt()
  const location = useLocation()
  const studentName = attemptData?.student?.displayName || 'Estudiante'
  const instructionsPage = location.pathname === '/estudiante/instrucciones'

  return (
    <>
      <a className="skip-link" href="#main-content">Saltar al contenido principal</a>
      <div className={`student-shell ${instructionsPage ? 'student-shell-instructions' : ''}`}>
      <header className="student-topbar">
        <Brand />
        <div className="student-identity">
          <span>Estudiante</span>
          <strong>{studentName}</strong>
        </div>
      </header>
      <main id="main-content" className="student-content">
        <Outlet />
      </main>
      </div>
    </>
  )
}
