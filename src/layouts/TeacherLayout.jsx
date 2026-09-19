import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Brand from '../components/Brand'
import { useAuth } from '../contexts/AuthContext'

const navItems = [
  ['/docente/dashboard', 'Inicio'],
  ['/docente/cursos', 'Cursos'],
  ['/docente/bancos', 'Banco de preguntas'],
  ['/docente/examenes', 'Exámenes'],
  ['/docente/resultados', 'Resultados'],
  ['/docente/evidencias', 'Evidencias'],
  ['/docente/calificacion', 'Calificación'],
  ['/docente/configuracion', 'Configuración'],
]

function initials(profile) {
  const source = profile?.display_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || profile?.email || 'D'
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'D'
}

export default function TeacherLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, signOut } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const displayName = profile?.display_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || profile?.email || 'Docente'
  const roleLabel = profile?.role === 'admin' ? 'Administrador' : 'Docente'
  const avatar = initials(profile)

  useEffect(() => { setMobileMenuOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!mobileMenuOpen) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event) => { if (event.key === 'Escape') setMobileMenuOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileMenuOpen])

  const handleLogout = async () => {
    await signOut()
    navigate('/docente/login', { replace: true })
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Saltar al contenido principal</a>
      <div className="dashboard-layout">
      {mobileMenuOpen && <button type="button" className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`} aria-label="Menú docente">
        <div className="sidebar-brand"><Brand to="/docente/dashboard" /></div>
        <nav className="sidebar-nav" aria-label="Navegación docente">
          {navItems.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-dot" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-profile">
          <div className="avatar">{avatar}</div>
          <div className="sidebar-profile-copy">
            <strong>{displayName}</strong>
            <span>{roleLabel}</span>
            <button type="button" className="sidebar-logout" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="teacher-topbar">
          <div>
            <button type="button" className="mobile-menu-button" aria-label="Abrir menú docente" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)}>
              <span aria-hidden="true">☰</span>
            </button>
            <span className="mobile-brand"><Brand compact to="/docente/dashboard" /></span>
            <strong>Panel docente</strong>
          </div>
          <div className="topbar-actions">
            <span className="environment-pill">Sesión protegida</span>
            <button className="avatar-button" type="button" aria-label="Cerrar sesión" onClick={handleLogout}>{avatar}</button>
          </div>
        </header>
        <main id="main-content" className="dashboard-content">
          <Outlet />
        </main>
      </div>
      </div>
    </>
  )
}
