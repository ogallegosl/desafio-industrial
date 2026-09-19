import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import ExamPackageImportModal from '../components/ExamPackageImportModal'
import StatusBadge from '../components/StatusBadge'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { createSafetyDemo } from '../services/demoData'
import {
  changeExamStatus,
  duplicateTeacherExam,
  listTeacherExams,
  softDeleteTeacherExam,
} from '../services/examManagement'
import { forceCloseExam, setExamAdmissions } from '../services/liveExamMonitoring'

const STATUS_META = {
  draft: ['Borrador', 'neutral'],
  scheduled: ['Programado', 'info'],
  active: ['Activo', 'success'],
  closed: ['Cerrado', 'dark'],
  archived: ['Archivado', 'dark'],
}

function configOf(exam) {
  return Array.isArray(exam.configuraciones_examen) ? exam.configuraciones_examen[0] : exam.configuraciones_examen
}

export default function TeacherExamsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { settings, formatDateTime } = useGlobalSettings()
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [demoBusy, setDemoBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [courseFilter, setCourseFilter] = useState('all')
  const [importOpen, setImportOpen] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const data = await listTeacherExams()
      setExams(data)
    } catch (error) {
      setMessage({ type: 'danger', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const courseOptions = useMemo(() => {
    const map = new Map()
    exams.forEach((exam) => { if (exam.cursos?.id) map.set(exam.cursos.id, exam.cursos.name) })
    return [...map.entries()]
  }, [exams])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return exams.filter((exam) => {
      const matchQuery = !normalized || `${exam.title} ${exam.cursos?.name || ''} ${exam.cursos?.code || ''}`.toLowerCase().includes(normalized)
      const matchStatus = statusFilter === 'all' || exam.status === statusFilter
      const matchCourse = courseFilter === 'all' || exam.course_id === courseFilter
      return matchQuery && matchStatus && matchCourse
    })
  }, [exams, query, statusFilter, courseFilter])

  async function createDemo() {
    if (demoBusy) return
    setDemoBusy(true)
    setMessage(null)
    try {
      const result = await createSafetyDemo()
      setMessage({
        type: 'success',
        text: `${result?.created ? 'Examen DEMO creado' : 'Examen DEMO reactivado'}. Código de acceso: ${result?.accessCode || 'revisa la configuración del examen'}.`,
      })
      await reload()
    } catch (error) {
      setMessage({ type: 'danger', text: error.message })
    } finally {
      setDemoBusy(false)
    }
  }

  async function runAction(exam, action) {
    setBusyId(exam.id)
    setMessage(null)
    try {
      if (action === 'duplicate') {
        const newId = await duplicateTeacherExam(exam.id)
        setMessage({ type: 'success', text: 'Examen duplicado como borrador. El código y el horario no se copiaron.' })
        await reload()
        navigate(`/docente/examenes/${newId}/editar`)
        return
      }
      if (action === 'delete') {
        if (!window.confirm(`¿Eliminar lógicamente “${exam.title}”? Los intentos históricos se conservarán.`)) return
        await softDeleteTeacherExam(exam.id)
        setMessage({ type: 'success', text: 'Examen eliminado de la lista activa. Los datos históricos se conservaron.' })
      }
      if (action === 'archive') {
        if (!window.confirm(`¿Archivar “${exam.title}”?`)) return
        await changeExamStatus(exam.id, 'archived')
        setMessage({ type: 'success', text: 'Examen archivado.' })
      }
      if (action === 'activate') {
        await changeExamStatus(exam.id, 'active')
        setMessage({ type: 'success', text: 'Examen activado.' })
      }
      if (action === 'deactivate') {
        if (!window.confirm(`¿Volver “${exam.title}” a borrador? Si ya existen intentos, el sistema bloqueará esta acción para proteger el historial.`)) return
        await changeExamStatus(exam.id, 'draft')
        setMessage({ type: 'success', text: 'Examen devuelto a borrador.' })
      }
      if (action === 'admissions') {
        const next = exam.accept_new_attempts === false
        await setExamAdmissions(exam.id, next)
        setMessage({ type: 'success', text: next ? 'Ingreso de nuevos estudiantes habilitado.' : 'Ingreso de nuevos estudiantes cerrado. Los intentos en curso continúan.' })
      }
      if (action === 'close') {
        if (!window.confirm(`¿Finalizar “${exam.title}” para todos? Los intentos que estén rindiendo se enviarán inmediatamente y se cerrará el ingreso.`)) return
        if (!window.confirm('Esta acción no se puede deshacer. ¿Confirmas la finalización global?')) return
        await forceCloseExam(exam.id, 'Finalización global indicada desde la lista de exámenes')
        setMessage({ type: 'success', text: 'Examen finalizado para todos los estudiantes.' })
      }
      await reload()
    } catch (error) {
      setMessage({ type: 'danger', text: error.message })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section>
      <PageHeader eyebrow="Evaluaciones" title="Exámenes" description="Crea, importa, programa, activa, duplica y administra las evaluaciones de tus cursos." action={<div className="header-actions"><button className="button secondary" type="button" onClick={createDemo} disabled={demoBusy}>{demoBusy ? 'Creando DEMO…' : 'Crear examen DEMO'}</button><button className="button secondary" type="button" onClick={() => setImportOpen(true)}>Importar examen</button><Link className="button primary" to="/docente/examenes/nuevo">+ Crear examen</Link></div>} />

      {message && <div className={`form-alert ${message.type === 'success' ? 'success' : 'danger'} page-alert`}>{message.text}</div>}

      <div className="toolbar surface compact-surface exam-toolbar">
        <input className="search-input" placeholder="Buscar examen o curso…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Todos los estados</option><option value="active">Activo</option><option value="scheduled">Programado</option><option value="draft">Borrador</option><option value="closed">Cerrado</option><option value="archived">Archivado</option></select>
        <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}><option value="all">Todos los cursos</option>{courseOptions.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select>
        <button className="button secondary button-small" onClick={reload} disabled={loading}>Actualizar</button>
      </div>

      <section className="surface">
        {loading ? <div className="table-state">Cargando exámenes…</div> : filtered.length === 0 ? (
          <div className="table-state"><strong>No hay exámenes que coincidan.</strong><span>Crea uno nuevo o cambia los filtros.</span></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table exam-table">
              <thead><tr><th>Examen</th><th>Curso</th><th>Estado</th><th>Inicio</th><th>Duración</th><th>Preguntas</th><th>Acciones</th></tr></thead>
              <tbody>{filtered.map((exam) => {
                const cfg = configOf(exam) || {}
                const status = STATUS_META[exam.status] || STATUS_META.draft
                const disabled = busyId === exam.id
                return (
                  <tr key={exam.id}>
                    <td><strong>{exam.title}</strong><span>{exam.id.slice(0, 8).toUpperCase()}</span></td>
                    <td>{exam.cursos?.name || 'Curso no disponible'}{exam.cursos?.section && <span>Sección {exam.cursos.section}</span>}</td>
                    <td><StatusBadge tone={status[1]}>{status[0]}</StatusBadge></td>
                    <td>{exam.starts_at ? formatDateTime(exam.starts_at) : 'Sin programar'}</td>
                    <td>{cfg.duration_minutes ? `${cfg.duration_minutes} min` : '—'}</td>
                    <td>{cfg.target_question_count ?? '—'}</td>
                    <td>
                      <div className="row-actions">
                        <Link className="text-button" to={`/docente/examenes/${exam.id}/editar`}>Editar</Link>
                        {!['draft', 'archived'].includes(exam.status) && <Link className="text-button live-link" to={`/docente/examenes/${exam.id}/monitoreo`}>En vivo</Link>}
                        <button className="text-button" disabled={disabled} onClick={() => runAction(exam, 'duplicate')}>Duplicar</button>
                        {['scheduled', 'active'].includes(exam.status) && <button className="text-button" disabled={disabled} onClick={() => runAction(exam, 'admissions')}>{exam.accept_new_attempts === false ? 'Abrir ingresos' : 'Cerrar ingresos'}</button>}
                        {['scheduled', 'active'].includes(exam.status) && <button className="text-button" disabled={disabled} onClick={() => runAction(exam, 'deactivate')}>Volver a borrador</button>}
                        {exam.status === 'draft' && <button className="text-button" disabled={disabled} onClick={() => runAction(exam, 'activate')}>Activar</button>}
                        {['scheduled', 'active'].includes(exam.status) && <button className="text-button" disabled={disabled} onClick={() => runAction(exam, 'close')}>Finalizar todos</button>}
                        {exam.status !== 'archived' && <button className="text-button" disabled={disabled} onClick={() => runAction(exam, 'archive')}>Archivar</button>}
                        <button className="text-button danger-text" disabled={disabled} onClick={() => runAction(exam, 'delete')}>Eliminar</button>
                      </div>
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      <ExamPackageImportModal
        open={importOpen}
        userId={user?.id}
        settings={settings}
        onClose={() => setImportOpen(false)}
        onImported={async (result) => {
          setMessage({ type: 'success', text: 'Examen importado en borrador. Revísalo antes de programarlo o activarlo.' })
          await reload()
          setImportOpen(false)
          navigate(`/docente/examenes/${result.examId}/editar`)
        }}
      />
    </section>
  )
}
