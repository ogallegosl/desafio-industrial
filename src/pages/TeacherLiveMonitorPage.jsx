import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'
import {
  extendAttemptTime,
  extendExamTime,
  forceCloseExam,
  forceSubmitAttempt,
  getLiveExamMonitor,
  setExamAdmissions,
  subscribeLiveExam,
} from '../services/liveExamMonitoring'

const STATUS_LABELS = {
  created: ['Preparado', 'info'],
  in_progress: ['Rindiendo', 'success'],
  submitted: ['Entregado', 'dark'],
  time_expired: ['Tiempo agotado', 'warning'],
  cancelled: ['Cancelado', 'danger'],
}

function secondsLabel(value) {
  if (value === null || value === undefined) return '—'
  const seconds = Math.max(0, Number(value || 0))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function relativeActivity(iso, nowMs) {
  if (!iso) return 'Sin actividad'
  const delta = Math.max(0, nowMs - new Date(iso).getTime())
  if (delta < 15_000) return 'Ahora'
  if (delta < 60_000) return `${Math.floor(delta / 1000)} s`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min`
  return `${Math.floor(delta / 3_600_000)} h`
}

function connectionTone(attempt, nowMs) {
  if (attempt.status !== 'in_progress') return 'closed'
  const sync = attempt.lastServerSyncAt ? new Date(attempt.lastServerSyncAt).getTime() : 0
  const delta = nowMs - sync
  if (delta <= 20_000) return 'online'
  if (delta <= 90_000) return 'delayed'
  return 'offline'
}

function confirmed(promptText, fallback) {
  const value = window.prompt(promptText, fallback || '')
  return value === null ? null : value.trim()
}

export default function TeacherLiveMonitorPage() {
  const { examId } = useParams()
  const { formatDateTime } = useGlobalSettings()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState(null)
  const [realtimeStatus, setRealtimeStatus] = useState('CONNECTING')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('status')
  const refreshTimer = useRef(null)
  const [clock, setClock] = useState(Date.now())

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const result = await getLiveExamMonitor(examId)
      setData(result)
      setMessage((current) => current?.sticky ? current : null)
    } catch (error) {
      setMessage({ type: 'danger', text: error.message })
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [examId])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => load({ quiet: true }), 250)
  }, [load])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const stop = subscribeLiveExam(examId, scheduleRefresh, setRealtimeStatus)
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
      stop?.()
    }
  }, [examId, scheduleRefresh])

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Fallback polling keeps the dashboard useful even when Realtime is disabled.
  useEffect(() => {
    const id = window.setInterval(() => load({ quiet: true }), 15_000)
    return () => window.clearInterval(id)
  }, [load])

  const serverOffsetMs = useMemo(() => {
    const server = data?.serverNow ? new Date(data.serverNow).getTime() : NaN
    return Number.isFinite(server) ? server - Date.now() : 0
  }, [data?.serverNow])

  const remainingNow = useCallback((attempt) => {
    if (attempt.status !== 'in_progress' || !attempt.deadlineAt) return null
    return Math.max(0, Math.floor((new Date(attempt.deadlineAt).getTime() - (clock + serverOffsetMs)) / 1000))
  }, [clock, serverOffsetMs])

  const attempts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es')
    const source = [...(data?.attempts || [])]
      .filter((item) => !normalized || String(item.studentName || '').toLocaleLowerCase('es').includes(normalized))
      .filter((item) => filter === 'all' || item.status === filter || (filter === 'incidents' && Number(item.securityIncidents || 0) > 0))

    source.sort((a, b) => {
      if (sort === 'name') return String(a.studentName).localeCompare(String(b.studentName), 'es')
      if (sort === 'progress') return Number(a.answeredCount || 0) - Number(b.answeredCount || 0)
      if (sort === 'incidents') return Number(b.securityIncidents || 0) - Number(a.securityIncidents || 0)
      if (sort === 'activity') return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime()
      const rank = { in_progress: 0, created: 1, submitted: 2, time_expired: 3, cancelled: 4 }
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(a.studentName).localeCompare(String(b.studentName), 'es')
    })
    return source
  }, [data?.attempts, query, filter, sort])

  const maxQuestions = Math.max(0, ...attempts.map((item) => Number(item.totalQuestions || 0)), Number(data?.exam?.targetQuestionCount || 0))

  async function action(key, fn, success) {
    if (busy) return
    setBusy(key)
    setMessage(null)
    try {
      await fn()
      setMessage({ type: 'success', text: success })
      await load({ quiet: true })
    } catch (error) {
      setMessage({ type: 'danger', text: error.message })
    } finally {
      setBusy('')
    }
  }

  const toggleAdmissions = () => {
    const next = data?.exam?.acceptNewAttempts === false
    action('admissions', () => setExamAdmissions(examId, next), next ? 'Ingreso de nuevos estudiantes habilitado.' : 'Ingreso de nuevos estudiantes cerrado. Quienes ya iniciaron pueden continuar.')
  }

  const addGlobalTime = (minutes) => {
    if (!window.confirm(`¿Agregar ${minutes} minutos a todos los intentos que están rindiendo?`)) return
    action(`global-${minutes}`, () => extendExamTime(examId, minutes), `Se agregaron ${minutes} minutos a los intentos en curso.`)
  }

  const closeAll = () => {
    const active = Number(data?.summary?.inProgress || 0)
    const reason = confirmed(`Esta acción finalizará inmediatamente ${active} intento${active === 1 ? '' : 's'} en curso y cerrará el ingreso.\n\nEscribe un motivo breve para dejarlo registrado:`, 'Finalización indicada por el docente')
    if (reason === null) return
    if (!window.confirm('Confirmación final: ¿cerrar el examen para todos? Esta acción no se puede deshacer.')) return
    action('close-all', () => forceCloseExam(examId, reason), 'El examen fue finalizado para todos los estudiantes.')
  }

  const finishOne = (attempt) => {
    const reason = confirmed(`Finalizar el intento de ${attempt.studentName}.\nMotivo:`, 'Finalización indicada por el docente')
    if (reason === null) return
    if (!window.confirm(`¿Finalizar ahora el intento de ${attempt.studentName}?`)) return
    action(`finish-${attempt.attemptId}`, () => forceSubmitAttempt(attempt.attemptId, reason), `Intento de ${attempt.studentName} finalizado.`)
  }

  const addTime = (attempt, minutes) => {
    action(`extend-${attempt.attemptId}-${minutes}`, () => extendAttemptTime(attempt.attemptId, minutes), `Se agregaron ${minutes} minutos a ${attempt.studentName}.`)
  }

  const exam = data?.exam || {}
  const summary = data?.summary || {}
  const realtimeOk = realtimeStatus === 'SUBSCRIBED'

  return (
    <section className="live-monitor-page">
      <PageHeader
        eyebrow="Supervisión"
        title="Monitoreo en vivo"
        description={exam.title || 'Sigue el avance de los estudiantes mientras rinden.'}
        action={<div className="header-actions"><Link className="button secondary" to="/docente/examenes">Volver a exámenes</Link><button className="button secondary" type="button" onClick={() => load()} disabled={loading}>Actualizar</button></div>}
      />

      {message && <div className={`form-alert ${message.type === 'success' ? 'success' : 'danger'} page-alert`} role="status">{message.text}</div>}

      <div className="live-monitor-statusbar surface compact-surface">
        <div className={`live-connection ${realtimeOk ? 'connected' : 'fallback'}`}><span aria-hidden="true" />{realtimeOk ? 'Tiempo real conectado' : 'Actualización automática de respaldo'}</div>
        <div><span>Estado</span><strong>{exam.status || '—'}</strong></div>
        <div><span>Ingreso</span><strong>{exam.acceptNewAttempts === false ? 'Cerrado' : 'Abierto'}</strong></div>
        <div><span>Última actualización</span><strong>{data?.serverNow ? formatDateTime(data.serverNow) : '—'}</strong></div>
      </div>

      <div className="stat-grid live-stat-grid">
        <StatCard label="Participantes" value={summary.participants ?? 0} detail="estudiantes únicos" />
        <StatCard label="Rindiendo" value={summary.inProgress ?? 0} detail="con intento activo" />
        <StatCard label="Entregados" value={summary.submitted ?? 0} detail="finalizados" />
        <StatCard label="Incidencias" value={summary.securityIncidents ?? 0} detail="eventos de integridad" />
      </div>

      <section className="surface live-control-panel" aria-label="Controles del examen">
        <div className="live-control-copy">
          <p className="eyebrow">Control docente</p>
          <h2>Acciones durante la evaluación</h2>
          <p>Cerrar ingreso no interrumpe a quienes ya comenzaron. “Finalizar para todos” sí envía y cierra los intentos en curso.</p>
        </div>
        <div className="live-control-actions">
          <button className="button secondary" type="button" onClick={toggleAdmissions} disabled={Boolean(busy) || ['closed', 'archived'].includes(exam.status)}>
            {exam.acceptNewAttempts === false ? 'Abrir ingreso' : 'Cerrar nuevos ingresos'}
          </button>
          <button className="button secondary" type="button" onClick={() => addGlobalTime(5)} disabled={Boolean(busy) || Number(summary.inProgress || 0) === 0}>+5 min a todos</button>
          <button className="button secondary" type="button" onClick={() => addGlobalTime(10)} disabled={Boolean(busy) || Number(summary.inProgress || 0) === 0}>+10 min a todos</button>
          <button className="button danger-button" type="button" onClick={closeAll} disabled={Boolean(busy) || ['closed', 'archived'].includes(exam.status)}>Finalizar para todos</button>
        </div>
      </section>

      <div className="toolbar surface compact-surface live-toolbar">
        <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar estudiante…" />
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">Todos</option>
          <option value="in_progress">Rindiendo</option>
          <option value="created">Preparados</option>
          <option value="submitted">Entregados</option>
          <option value="time_expired">Tiempo agotado</option>
          <option value="incidents">Con incidencias</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="status">Ordenar por estado</option>
          <option value="name">Nombre</option>
          <option value="progress">Menor avance</option>
          <option value="incidents">Más incidencias</option>
          <option value="activity">Actividad reciente</option>
        </select>
      </div>

      <section className="surface live-table-surface">
        {loading && !data ? <div className="table-state">Cargando monitoreo…</div> : attempts.length === 0 ? (
          <div className="table-state"><strong>Aún no hay estudiantes para mostrar.</strong><span>Esta pantalla se actualizará automáticamente cuando ingresen.</span></div>
        ) : (
          <div className="table-wrap live-table-wrap">
            <table className="data-table live-monitor-table">
              <thead><tr><th>Estudiante</th><th>Estado</th><th>Avance</th><th>Pregunta</th><th>Tiempo</th><th>Conexión</th><th>Integridad</th><th>Acciones</th></tr></thead>
              <tbody>{attempts.map((attempt) => {
                const statusMeta = STATUS_LABELS[attempt.status] || [attempt.status, 'neutral']
                const connection = connectionTone(attempt, clock)
                const active = attempt.status === 'in_progress'
                return (
                  <tr key={attempt.attemptId}>
                    <td><strong>{attempt.studentName || 'Estudiante'}</strong><span>Intento {attempt.attemptNumber}</span></td>
                    <td><StatusBadge tone={statusMeta[1]}>{statusMeta[0]}</StatusBadge></td>
                    <td><div className="live-progress-cell"><strong>{attempt.answeredCount} / {attempt.totalQuestions || maxQuestions}</strong><div className="mini-progress"><span style={{ width: `${Math.min(100, (Number(attempt.answeredCount || 0) / Math.max(1, Number(attempt.totalQuestions || maxQuestions))) * 100)}%` }} /></div></div></td>
                    <td>{attempt.currentOrder || '—'} / {attempt.totalQuestions || maxQuestions || '—'}</td>
                    <td><strong className={active && Number(remainingNow(attempt) || 0) < 300 ? 'time-warning' : ''}>{active ? secondsLabel(remainingNow(attempt)) : '—'}</strong>{Number(attempt.extraTimeSeconds || 0) > 0 && <span>+{Math.round(Number(attempt.extraTimeSeconds) / 60)} min</span>}</td>
                    <td><div className={`connection-state ${connection}`}><span aria-hidden="true" />{connection === 'online' ? 'Conectado' : connection === 'delayed' ? 'Demora' : active ? 'Sin señal reciente' : 'Cerrado'}</div><span>{relativeActivity(attempt.lastActivityAt || attempt.lastServerSyncAt, clock)}</span></td>
                    <td><strong className={Number(attempt.securityIncidents || 0) >= 3 ? 'incident-high' : ''}>{attempt.securityIncidents || 0}</strong></td>
                    <td><div className="row-actions live-row-actions">{active && <><button className="text-button" disabled={Boolean(busy)} onClick={() => addTime(attempt, 5)}>+5 min</button><button className="text-button" disabled={Boolean(busy)} onClick={() => addTime(attempt, 10)}>+10 min</button><button className="text-button danger-text" disabled={Boolean(busy)} onClick={() => finishOne(attempt)}>Finalizar</button></>}</div></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      {attempts.length > 0 && maxQuestions > 0 && (
        <section className="surface live-matrix-section">
          <div className="section-heading-row"><div><p className="eyebrow">Vista rápida</p><h2>Matriz de avance</h2><p>Solo muestra si una pregunta fue respondida; no revela la alternativa elegida ni si es correcta.</p></div><div className="matrix-legend"><span><i className="matrix-dot answered" />Respondida</span><span><i className="matrix-dot current" />Actual</span><span><i className="matrix-dot pending" />Pendiente</span></div></div>
          <div className="live-matrix-wrap">
            <table className="live-matrix-table">
              <thead><tr><th>Estudiante</th>{Array.from({ length: maxQuestions }, (_, index) => <th key={index}>P{index + 1}</th>)}</tr></thead>
              <tbody>{attempts.map((attempt) => {
                const answered = new Set((attempt.answeredOrders || []).map(Number))
                return <tr key={`matrix-${attempt.attemptId}`}><th>{attempt.studentName}</th>{Array.from({ length: maxQuestions }, (_, index) => {
                  const order = index + 1
                  const state = attempt.status === 'in_progress' && Number(attempt.currentOrder) === order ? 'current' : answered.has(order) ? 'answered' : 'pending'
                  return <td key={order}><span className={`matrix-dot ${state}`} title={`Pregunta ${order}: ${state === 'answered' ? 'respondida' : state === 'current' ? 'actual' : 'pendiente'}`} /></td>
                })}</tr>
              })}</tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  )
}
