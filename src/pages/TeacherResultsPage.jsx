import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import { getExamAnalytics, listExamsForAnalytics } from '../services/resultsAnalytics'
import { exportExamResultsCsv, exportExamResultsExcel, getExamExportDetails } from '../services/resultsExport'
import { downloadAllTeacherAttemptPdfsZip, downloadTeacherAttemptPdf } from '../services/examPdfReport'
import { useAuth } from '../contexts/AuthContext'

const TABS = [
  ['overview', 'Resumen'],
  ['questions', 'Por pregunta'],
  ['students', 'Por estudiante'],
]

const TYPE_LABELS = {
  single_choice: 'Alternativa única',
  multiple_choice: 'Selección múltiple',
  true_false: 'Verdadero / Falso',
  short_text: 'Respuesta corta',
  numeric: 'Numérica',
  essay: 'Desarrollo',
  image_single_choice: 'Imagen + alternativas',
  image_essay: 'Imagen + desarrollo',
  calculation: 'Cálculo',
  calculation_evidence: 'Cálculo + evidencia',
  case_group: 'Caso práctico',
  attachment: 'Archivo adjunto',
}

function number(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function integer(value) {
  return Number(value || 0).toLocaleString('es-PE')
}

function percent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${number(value, 1)} %`
}

function time(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const total = Math.max(0, Math.round(Number(seconds)))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function attemptStatus(status) {
  if (status === 'submitted') return ['Entregado', 'success']
  if (status === 'time_expired') return ['Tiempo vencido', 'warning']
  if (status === 'in_progress') return ['En curso', 'info']
  if (status === 'created') return ['Sin iniciar', 'neutral']
  return [status || '—', 'neutral']
}

function truncate(text, max = 110) {
  const value = String(text || '').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function EmptyResults({ title, copy }) {
  return (
    <div className="analytics-empty">
      <strong>{title}</strong>
      <span>{copy}</span>
    </div>
  )
}

function OverviewPanel({ overview }) {
  const gradeScale = overview.gradeScaleMax ?? 20
  const closed = Number(overview.closedAttempts || 0)
  const graded = Number(overview.gradedAttempts || 0)

  return (
    <>
      <div className="card-grid analytics-card-grid">
        <StatCard label="Participantes" value={integer(overview.participants)} detail={`${integer(overview.attempts)} intentos registrados`} />
        <StatCard label="Intentos cerrados" value={integer(closed)} detail={`${integer(overview.submitted)} entregados · ${integer(overview.timeExpired)} por tiempo`} tone="accent" />
        <StatCard label="Promedio" value={number(overview.averageGrade, 2)} detail={graded ? `${graded} con nota final · escala 0–${number(gradeScale, 1)}` : 'Sin notas finales disponibles'} tone="accent" />
        <StatCard label="Aprobación" value={percent(overview.passRate)} detail={overview.passingGrade != null ? `Aprobación desde ${number(overview.passingGrade, 2)}` : 'Sin umbral configurado'} tone="default" />
      </div>

      <div className="analytics-summary-grid section-gap">
        <article className="surface analytics-stat-panel">
          <div className="surface-heading compact-heading">
            <div><h2>Distribución de notas</h2><p>Solo considera intentos cerrados con nota final calculada.</p></div>
          </div>
          <div className="analytics-mini-grid">
            <div><span>Mediana</span><strong>{number(overview.medianGrade, 2)}</strong></div>
            <div><span>Mínimo</span><strong>{number(overview.minGrade, 2)}</strong></div>
            <div><span>Máximo</span><strong>{number(overview.maxGrade, 2)}</strong></div>
            <div><span>Desv. estándar</span><strong>{number(overview.stddevGrade, 2)}</strong></div>
          </div>
        </article>

        <article className="surface analytics-stat-panel">
          <div className="surface-heading compact-heading">
            <div><h2>Seguimiento del examen</h2><p>Estados operativos y revisiones que todavía afectan la nota final.</p></div>
          </div>
          <div className="analytics-mini-grid">
            <div><span>En curso</span><strong>{integer(overview.inProgress)}</strong></div>
            <div><span>Sin iniciar</span><strong>{integer(overview.created)}</strong></div>
            <div><span>Revisiones pendientes</span><strong>{integer(overview.pendingManualReviews)}</strong></div>
            <div><span>Tiempo medio</span><strong>{time(overview.averageTimeSeconds)}</strong></div>
          </div>
        </article>
      </div>

      {graded === 0 && closed > 0 && (
        <div className="form-alert warning section-gap">
          Hay intentos cerrados, pero todavía no existen notas finales disponibles. Esto puede ocurrir cuando quedan respuestas pendientes de calificación manual.
        </div>
      )}
    </>
  )
}

function QuestionPanel({ questions, filter, setFilter }) {
  const normalized = filter.trim().toLowerCase()
  const filtered = useMemo(() => questions.filter((item) => {
    if (!normalized) return true
    return `${item.prompt || ''} ${TYPE_LABELS[item.type] || item.type || ''}`.toLowerCase().includes(normalized)
  }), [questions, normalized])

  if (!questions.length) return <EmptyResults title="Todavía no hay preguntas analizables" copy="El análisis aparecerá cuando existan intentos cerrados." />

  return (
    <section className="surface">
      <div className="surface-heading analytics-toolbar-heading">
        <div>
          <h2>Análisis por pregunta</h2>
          <p>La dificultad observada se expresa como 100 % menos la tasa de acierto. En preguntas manuales se muestra rendimiento por puntaje en lugar de inventar una clasificación correcta/incorrecta.</p>
        </div>
        <input className="search-input small" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar pregunta..." />
      </div>

      <div className="table-wrap">
        <table className="data-table analytics-table">
          <thead>
            <tr>
              <th>Pregunta</th>
              <th>Exposiciones</th>
              <th>Correctas</th>
              <th>Incorrectas</th>
              <th>Omitidas</th>
              <th>Acierto</th>
              <th>Dificultad observada</th>
              <th>Puntaje medio</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.questionKey}>
                <td className="analytics-question-cell">
                  <strong>{truncate(item.prompt)}</strong>
                  <span>{TYPE_LABELS[item.type] || item.type}</span>
                  {Number(item.pendingManual || 0) > 0 && <small>{integer(item.pendingManual)} revisión(es) pendiente(s)</small>}
                </td>
                <td>{integer(item.exposures)}</td>
                <td>{item.correctRate == null ? '—' : integer(item.correct)}</td>
                <td>{item.correctRate == null ? '—' : integer(item.incorrect)}</td>
                <td>{integer(item.omitted)}</td>
                <td>{percent(item.correctRate)}</td>
                <td>
                  {item.difficultyIndex == null ? '—' : (
                    <div className="metric-bar-cell">
                      <div className="analytics-bar"><span style={{ width: `${Math.min(100, Math.max(0, Number(item.difficultyIndex)))}%` }} /></div>
                      <small>{percent(item.difficultyIndex)}</small>
                    </div>
                  )}
                </td>
                <td>{percent(item.averageScoreRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <EmptyResults title="Sin coincidencias" copy="No hay preguntas que coincidan con la búsqueda actual." />}
    </section>
  )
}

function StudentPanel({ students, filter, setFilter, passingGrade, onPdf, pdfBusy }) {
  const normalized = filter.trim().toLowerCase()
  const filtered = useMemo(() => students.filter((item) => {
    if (!normalized) return true
    return `${item.studentCode || ''} ${item.firstName || ''} ${item.lastName || ''} ${item.section || ''}`.toLowerCase().includes(normalized)
  }), [students, normalized])

  if (!students.length) return <EmptyResults title="Todavía no hay participaciones" copy="Los intentos de los estudiantes aparecerán aquí cuando ingresen al examen." />

  return (
    <section className="surface">
      <div className="surface-heading analytics-toolbar-heading">
        <div>
          <h2>Resultados por estudiante</h2>
          <p>Cada fila representa un intento. Si el examen admite varios intentos, un estudiante puede aparecer más de una vez.</p>
        </div>
        <input className="search-input small" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar estudiante..." />
      </div>

      <div className="table-wrap">
        <table className="data-table analytics-table">
          <thead>
            <tr>
              <th>Estudiante</th>
              <th>Intento</th>
              <th>Estado</th>
              <th>Correctas</th>
              <th>Incorrectas</th>
              <th>Omitidas</th>
              <th>Puntos obtenidos</th>
              <th>Nota final</th>
              <th>Tiempo</th>
              <th>Incidencias</th>
              <th>PDF</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const [statusLabel, statusTone] = attemptStatus(item.status)
              const hasGrade = item.finalGrade != null
              const pending = hasGrade ? 0 : Number(item.pendingManualReviews || 0)
              const passed = hasGrade && passingGrade != null ? Number(item.finalGrade) >= Number(passingGrade) : null
              return (
                <tr key={item.attemptId}>
                  <td className="analytics-student-cell">
                    <strong>{`${item.lastName || ''}, ${item.firstName || ''}`.replace(/^,\s*/, '')}</strong>
                    <span>{item.section ? `Sección ${item.section}` : 'Examen individual'}</span>
                  </td>
                  <td>#{integer(item.attemptNumber)}</td>
                  <td><StatusBadge tone={statusTone}>{statusLabel}</StatusBadge></td>
                  <td>{integer(item.correct)}</td>
                  <td>{integer(item.incorrect)}</td>
                  <td>{integer(item.omitted)}</td>
                  <td>{item.rawScore == null ? '—' : `${number(item.rawScore, 2)} / ${number(item.maxRawScore, 2)}`}</td>
                  <td>
                    <div className="grade-cell">
                      <strong>{number(item.finalGrade, 2)}</strong>
                      {pending > 0 && <small>{pending} pendiente(s)</small>}
                      {pending === 0 && passed === true && <small className="positive-text">Aprobado</small>}
                      {pending === 0 && passed === false && <small className="danger-text">No aprobado</small>}
                    </div>
                  </td>
                  <td>{time(item.elapsedSeconds)}</td>
                  <td><span className={`security-count-pill ${Number(item.securityIncidents || 0) >= 3 ? 'critical' : ''}`}>{integer(item.securityIncidents || 0)}</span></td>
                  <td><button className="button tertiary compact" type="button" onClick={() => onPdf?.(item)} disabled={pdfBusy === item.attemptId || !['submitted', 'time_expired'].includes(item.status)}>{pdfBusy === item.attemptId ? 'Generando…' : 'Descargar PDF'}</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!filtered.length && <EmptyResults title="Sin coincidencias" copy="No hay estudiantes que coincidan con la búsqueda actual." />}
    </section>
  )
}

export default function TeacherResultsPage() {
  const { profile } = useAuth()
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [analytics, setAnalytics] = useState({ overview: {}, questions: [], students: [] })
  const [tab, setTab] = useState('overview')
  const [questionFilter, setQuestionFilter] = useState('')
  const [studentFilter, setStudentFilter] = useState('')
  const [loadingExams, setLoadingExams] = useState(true)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [pdfBusy, setPdfBusy] = useState('')
  const [zipProgress, setZipProgress] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoadingExams(true)
        const rows = await listExamsForAnalytics()
        if (!mounted) return
        setExams(rows)
        setExamId((current) => current || rows[0]?.id || '')
      } catch (cause) {
        if (mounted) setError(cause?.message || 'No se pudieron cargar los exámenes.')
      } finally {
        if (mounted) setLoadingExams(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!examId) {
      setAnalytics({ overview: {}, questions: [], students: [] })
      return undefined
    }
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        setError('')
        const data = await getExamAnalytics(examId)
        if (mounted) setAnalytics(data)
      } catch (cause) {
        if (mounted) setError(cause?.message || 'No se pudieron cargar los resultados del examen.')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [examId])

  const selectedExam = exams.find((exam) => exam.id === examId) || null
  const title = selectedExam?.title || 'Resultados y analítica'
  const course = selectedExam?.cursos?.name || 'Selecciona un examen para analizar sus resultados.'

  const reload = async () => {
    if (!examId) return
    try {
      setLoading(true)
      setError('')
      setAnalytics(await getExamAnalytics(examId))
    } catch (cause) {
      setError(cause?.message || 'No se pudieron actualizar los resultados.')
    } finally {
      setLoading(false)
    }
  }

  const downloadIndividualPdf = async (student) => {
    if (!selectedExam || !examId || !student?.attemptId) return
    try {
      setPdfBusy(student.attemptId)
      setError('')
      const [details, freshAnalytics] = await Promise.all([getExamExportDetails(examId), getExamAnalytics(examId)])
      const freshStudent = (freshAnalytics.students || []).find((row) => row.attemptId === student.attemptId) || student
      const filename = await downloadTeacherAttemptPdf({ exam: selectedExam, student: freshStudent, details, teacherName: profile?.display_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') })
      setAnalytics(freshAnalytics)
      setExportMessage(`PDF individual generado: ${filename}`)
    } catch (cause) {
      setError(cause?.message || 'No se pudo generar el PDF individual.')
    } finally {
      setPdfBusy('')
    }
  }

  const runZipExport = async () => {
    if (!selectedExam || !examId) return
    try {
      setExporting('zip')
      setError('')
      setExportMessage('')
      setZipProgress({ current: 0, total: (analytics.students || []).filter((row) => ['submitted', 'time_expired'].includes(row.status)).length })
      const [details, freshAnalytics] = await Promise.all([getExamExportDetails(examId), getExamAnalytics(examId)])
      setAnalytics(freshAnalytics)
      const result = await downloadAllTeacherAttemptPdfsZip({
        exam: selectedExam,
        students: freshAnalytics.students || [],
        details,
        teacherName: profile?.display_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' '),
        onProgress: (progress) => setZipProgress(progress),
      })
      setExportMessage(`ZIP generado: ${result.included} examen(es) individual(es). ${result.excluded ? `${result.excluded} intento(s) no finalizado(s) fueron excluidos.` : ''}`)
    } catch (cause) {
      setError(cause?.message || 'No se pudo generar el ZIP de exámenes individuales.')
    } finally {
      setExporting('')
      setZipProgress(null)
    }
  }

  const runExport = async (mode) => {
    if (!selectedExam || !examId) return
    try {
      setExporting(mode)
      setError('')
      setExportMessage('')
      const details = await getExamExportDetails(examId)
      if (mode === 'excel') {
        const result = await exportExamResultsExcel({ exam: selectedExam, students: analytics.students || [], details })
        setExportMessage(`Excel generado: ${result.generalCount} intento(s) y ${result.detailCount} respuesta(s) exportadas.`)
      } else {
        const result = await exportExamResultsCsv({
          exam: selectedExam,
          students: analytics.students || [],
          details,
          mode: mode === 'csv-detail' ? 'detail' : 'general',
        })
        setExportMessage(`CSV generado con ${result.rowCount} fila(s).`)
      }
    } catch (cause) {
      setError(cause?.message || 'No se pudo generar la exportación.')
    } finally {
      setExporting('')
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Resultados"
        title={title}
        description={selectedExam ? `${course}. Analítica calculada sobre datos reales del examen.` : course}
        action={(
          <div className="results-header-actions">
            <button className="button secondary" type="button" onClick={reload} disabled={!examId || loading || Boolean(exporting)}>Actualizar</button>
            <Link className="button secondary" to={examId ? `/docente/evidencias?exam=${encodeURIComponent(examId)}` : '/docente/evidencias'}>Revisar evidencias</Link>
            <button className="button primary" type="button" onClick={() => runExport('excel')} disabled={!examId || loading || Boolean(exporting)}>
              {exporting === 'excel' ? 'Generando Excel…' : 'Exportar Excel'}
            </button>
            <button className="button primary" type="button" onClick={runZipExport} disabled={!examId || loading || Boolean(exporting)}>
              {exporting === 'zip' ? (zipProgress?.total ? `Generando PDF ${zipProgress.current || 0} de ${zipProgress.total}…` : 'Preparando ZIP…') : 'Descargar todos los exámenes (ZIP)'}
            </button>
            <button className="button secondary" type="button" onClick={() => runExport('csv-general')} disabled={!examId || loading || Boolean(exporting)}>
              {exporting === 'csv-general' ? 'Generando…' : 'CSV general'}
            </button>
            <button className="button secondary" type="button" onClick={() => runExport('csv-detail')} disabled={!examId || loading || Boolean(exporting)}>
              {exporting === 'csv-detail' ? 'Generando…' : 'CSV detallado'}
            </button>
          </div>
        )}
      />

      <section className="surface analytics-selector">
        <label>
          Examen
          <select value={examId} onChange={(event) => setExamId(event.target.value)} disabled={loadingExams}>
            {!exams.length && <option value="">No hay exámenes disponibles</option>}
            {exams.map((exam) => (
              <option value={exam.id} key={exam.id}>
                {exam.title} · {exam.cursos?.name || 'Sin curso'}
              </option>
            ))}
          </select>
        </label>
        {selectedExam && (
          <div className="analytics-exam-meta">
            <span>Estado</span>
            <StatusBadge tone={selectedExam.status === 'active' ? 'success' : selectedExam.status === 'closed' ? 'neutral' : 'info'}>
              {selectedExam.status}
            </StatusBadge>
          </div>
        )}
      </section>

      {error && <div className="form-alert danger section-gap">{error}</div>}
      {exportMessage && <div className="form-alert success section-gap">{exportMessage}</div>}

      {!loadingExams && !exams.length && (
        <EmptyResults title="No existen exámenes" copy="Crea un examen antes de utilizar el módulo de resultados." />
      )}

      {examId && (
        <>
          <div className="results-tabs" role="tablist" aria-label="Secciones de resultados">
            {TABS.map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} aria-controls={`results-panel-${value}`} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>
            ))}
          </div>

          {loading ? (
            <div className="route-loading" role="status">Calculando resultados...</div>
          ) : (
            <div id={`results-panel-${tab}`} role="tabpanel" aria-live="polite">
              {tab === 'overview' && <OverviewPanel overview={analytics.overview || {}} />}
              {tab === 'questions' && <QuestionPanel questions={analytics.questions || []} filter={questionFilter} setFilter={setQuestionFilter} />}
              {tab === 'students' && <StudentPanel students={analytics.students || []} filter={studentFilter} setFilter={setStudentFilter} passingGrade={analytics.overview?.passingGrade} onPdf={downloadIndividualPdf} pdfBusy={pdfBusy} />}
            </div>
          )}
        </>
      )}
    </section>
  )
}
