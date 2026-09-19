import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import { getTeacherExamDashboard } from '../services/examManagement'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'

const STATUS_META = {
  draft: ['Borrador', 'neutral'],
  scheduled: ['Programado', 'info'],
  active: ['Activo', 'success'],
  closed: ['Cerrado', 'dark'],
  archived: ['Archivado', 'dark'],
}

export default function TeacherDashboardPage() {
  const { formatDateTime } = useGlobalSettings()
  const [data, setData] = useState({ active: 0, upcoming: 0, participants: 0, pendingReviews: 0, recentExams: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getTeacherExamDashboard()
      .then((next) => { if (active) setData(next) })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <section>
      <PageHeader
        eyebrow="Resumen académico"
        title="Panel docente"
        description="Control central de evaluaciones, participaciones y revisiones pendientes."
        action={<Link className="button primary" to="/docente/examenes/nuevo">+ Crear examen</Link>}
      />

      {error && <div className="form-alert danger page-alert">{error}</div>}

      <div className="card-grid">
        <StatCard label="Exámenes activos" value={loading ? '…' : String(data.active)} detail="Disponibles según su estado" tone="accent" />
        <StatCard label="Próximos exámenes" value={loading ? '…' : String(data.upcoming)} detail="Programados en los próximos 7 días" />
        <StatCard label="Participantes" value={loading ? '…' : String(data.participants)} detail="Estudiantes únicos con intentos registrados" />
        <StatCard label="Pendientes de revisión" value={loading ? '…' : String(data.pendingReviews)} detail="Respuestas que requieren corrección manual" tone="warning" />
      </div>

      <div className="dashboard-two-col">
        <section className="surface">
          <div className="surface-heading">
            <div><h2>Exámenes recientes</h2><p>Información obtenida de la base de datos.</p></div>
            <Link to="/docente/examenes">Ver todos</Link>
          </div>
          {loading ? <div className="table-state">Cargando…</div> : data.recentExams.length === 0 ? <div className="table-state"><strong>Aún no hay exámenes.</strong><span>Crea el primero desde el panel docente.</span></div> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Examen</th><th>Estado</th><th>Participantes</th><th>Inicio</th><th>Acción</th></tr></thead>
                <tbody>
                  {data.recentExams.map((exam) => {
                    const meta = STATUS_META[exam.status] || STATUS_META.draft
                    return (
                      <tr key={exam.id}>
                        <td><strong>{exam.title}</strong><span>{exam.cursos?.name || 'Curso no disponible'}</span></td>
                        <td><StatusBadge tone={meta[1]}>{meta[0]}</StatusBadge></td>
                        <td>{exam.participants}</td>
                        <td>{formatDateTime(exam.starts_at)}</td>
                        <td>{['active', 'scheduled'].includes(exam.status) ? <Link className="text-button live-link" to={`/docente/examenes/${exam.id}/monitoreo`}>En vivo</Link> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="surface quick-panel">
          <div className="surface-heading"><div><h2>Acciones rápidas</h2><p>Accesos frecuentes.</p></div></div>
          <Link className="quick-action" to="/docente/examenes/nuevo"><b>01</b><span><strong>Crear examen</strong><small>Configura una nueva evaluación.</small></span></Link>
          <Link className="quick-action" to="/docente/bancos"><b>02</b><span><strong>Gestionar preguntas</strong><small>Accede a los bancos del curso.</small></span></Link>
          <Link className="quick-action" to="/docente/evidencias"><b>03</b><span><strong>Revisar evidencias</strong><small>{data.pendingReviews} respuestas pendientes.</small></span></Link>
          <Link className="quick-action" to="/docente/resultados"><b>04</b><span><strong>Consultar resultados</strong><small>Analiza evaluaciones finalizadas.</small></span></Link>
        </aside>
      </div>
    </section>
  )
}
