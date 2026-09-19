import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import ExamQuestionPlan from '../components/ExamQuestionPlan'
import { useAuth } from '../contexts/AuthContext'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'
import { datetimeLocalToZonedIso, toZonedDatetimeLocal, toZonedInputParts, zonedLocalToIso } from '../utils/dateFormatting'
import {
  changeExamStatus,
  createTeacherExam,
  getTeacherExam,
  listTeacherCourses,
  updateTeacherExam,
} from '../services/examManagement'

const EMPTY_FORM = {
  title: '',
  courseId: '',
  description: '',
  instructions: '',
  accessCode: '',
  clearAccessCode: false,
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  durationMinutes: 45,
  maxAttempts: 1,
  targetQuestionCount: 20,
  randomizeQuestions: true,
  randomizeOptions: true,
  navigation: 'sequential',
  allowBacktrack: false,
  autoSubmitOnTimeout: true,
  resultVisibility: 'confirmation_only',
  showResultsAfter: '',
  gradeScaleMax: 20,
  passingGrade: 10.5,
  requireStudentCode: false,
  requireFirstName: true,
  requireLastName: true,
  requireEmail: false,
  requireSection: false,
  restrictToEnrolledStudents: false,
  securityEnabled: true,
  securityRequireFullscreen: true,
  securityDetectVisibility: true,
  securityDetectBlur: true,
  securityBlockClipboard: true,
  securityBlockContextMenu: true,
  securityBlockShortcuts: true,
  securityWatermark: true,
  securityDetectExtendedDisplay: true,
  securityRequireSeb: false,
  securityMaxIncidents: 3,
}

const STATUS_META = {
  draft: ['Borrador', 'neutral'],
  scheduled: ['Programado', 'info'],
  active: ['Activo', 'success'],
  closed: ['Cerrado', 'dark'],
  archived: ['Archivado', 'dark'],
}

function getConfig(exam) {
  return Array.isArray(exam?.configuraciones_examen)
    ? exam.configuraciones_examen[0]
    : exam?.configuraciones_examen
}

function validateForm(form, publishStatus, timezone) {
  const errors = []
  if (!form.title.trim()) errors.push('Ingresa el título del examen.')
  if (!form.courseId) errors.push('Selecciona un curso.')
  if (Number(form.durationMinutes) <= 0) errors.push('La duración debe ser mayor que cero.')
  if (Number(form.maxAttempts) <= 0) errors.push('El número de intentos debe ser mayor que cero.')
  if (Number(form.targetQuestionCount) <= 0) errors.push('La cantidad de preguntas debe ser mayor que cero.')
  if (Number(form.gradeScaleMax) <= 0) errors.push('La escala de nota debe ser mayor que cero.')
  if (!form.requireFirstName || !form.requireLastName) errors.push('La identificación del estudiante requiere apellidos y nombres.')
  if (Number(form.passingGrade) < 0 || Number(form.passingGrade) > Number(form.gradeScaleMax)) {
    errors.push('La nota aprobatoria debe estar dentro de la escala configurada.')
  }

  const startsAt = zonedLocalToIso(form.startDate, form.startTime, timezone)
  const endsAt = zonedLocalToIso(form.endDate, form.endTime, timezone)
  if ((form.startDate || form.startTime) && !startsAt) errors.push('Completa correctamente la fecha y hora de inicio.')
  if ((form.endDate || form.endTime) && !endsAt) errors.push('Completa correctamente la fecha y hora de cierre.')
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) errors.push('El cierre debe ser posterior al inicio.')

  if (['scheduled', 'active'].includes(publishStatus)) {
    if (!startsAt || !endsAt) errors.push('Para programar o activar debes indicar inicio y cierre.')
  }

  return errors
}

export default function TeacherExamEditorPage() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { settings: globalSettings, loading: globalSettingsLoading } = useGlobalSettings()
  const isNew = !examId
  const [form, setForm] = useState(EMPTY_FORM)
  const [courses, setCourses] = useState([])
  const [status, setStatus] = useState('draft')
  const [hasAccessCode, setHasAccessCode] = useState(false)
  const [questionStats, setQuestionStats] = useState({ fixedCount: 0, randomCount: 0, configuredCount: 0 })
  const [attemptCount, setAttemptCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [existingSettings, setExistingSettings] = useState({})

  useEffect(() => {
    let active = true
    async function load() {
      if (globalSettingsLoading) return
      setLoading(true)
      setMessage(null)
      try {
        const courseData = await listTeacherCourses()
        if (!active) return
        if (!isNew) {
          const exam = await getTeacherExam(examId)
          if (!active) return
          const cfg = getConfig(exam) || {}
          setExistingSettings(cfg.settings && typeof cfg.settings === 'object' ? cfg.settings : {})
          const start = toZonedInputParts(exam.starts_at, globalSettings.timezone)
          const end = toZonedInputParts(exam.ends_at, globalSettings.timezone)
          const activeCourses = courseData.filter((course) => course.is_active)
          const currentCourse = courseData.find((course) => course.id === exam.course_id)
          setCourses(currentCourse && !currentCourse.is_active && !activeCourses.some((course) => course.id === currentCourse.id) ? [...activeCourses, currentCourse] : activeCourses)
          setStatus(exam.status)
          setAttemptCount(Number(exam.attemptCount || 0))
          setHasAccessCode(Boolean(exam.access_code_lookup))
          setQuestionStats(exam.questionStats)
          setForm({
            title: exam.title || '',
            courseId: exam.course_id || '',
            description: exam.description || '',
            instructions: exam.instructions || '',
            accessCode: '',
            clearAccessCode: false,
            startDate: start.date,
            startTime: start.time,
            endDate: end.date,
            endTime: end.time,
            durationMinutes: cfg.duration_minutes ?? 45,
            maxAttempts: cfg.max_attempts ?? 1,
            targetQuestionCount: cfg.target_question_count ?? 20,
            randomizeQuestions: cfg.randomize_questions ?? true,
            randomizeOptions: cfg.randomize_options ?? true,
            navigation: cfg.navigation ?? 'free',
            allowBacktrack: cfg.allow_backtrack ?? true,
            autoSubmitOnTimeout: true,
            resultVisibility: cfg.result_visibility ?? 'confirmation_only',
            showResultsAfter: toZonedDatetimeLocal(cfg.show_results_after, globalSettings.timezone),
            gradeScaleMax: cfg.grade_scale_max ?? 20,
            passingGrade: cfg.passing_grade ?? 10.5,
            requireStudentCode: false,
            requireFirstName: true,
            requireLastName: true,
            requireEmail: false,
            requireSection: false,
            restrictToEnrolledStudents: cfg.restrict_to_enrolled_students ?? false,
            securityEnabled: cfg.settings?.security?.enabled ?? true,
            securityRequireFullscreen: cfg.settings?.security?.requireFullscreen ?? true,
            securityDetectVisibility: cfg.settings?.security?.detectVisibility ?? true,
            securityDetectBlur: cfg.settings?.security?.detectBlur ?? true,
            securityBlockClipboard: cfg.settings?.security?.blockClipboard ?? true,
            securityBlockContextMenu: cfg.settings?.security?.blockContextMenu ?? true,
            securityBlockShortcuts: cfg.settings?.security?.blockShortcuts ?? true,
            securityWatermark: cfg.settings?.security?.watermark ?? true,
            securityDetectExtendedDisplay: cfg.settings?.security?.detectExtendedDisplay ?? true,
            securityRequireSeb: cfg.settings?.security?.requireSeb ?? false,
            securityMaxIncidents: cfg.settings?.security?.maxIncidents ?? 3,
          })
        } else {
          setExistingSettings({})
          setCourses(courseData.filter((course) => course.is_active))
          setForm((current) => ({
            ...current,
            courseId: current.courseId || courseData[0]?.id || '',
            gradeScaleMax: Number(globalSettings.gradeScaleMax ?? 20),
            passingGrade: Number(globalSettings.passingGrade ?? 10.5),
          }))
        }
      } catch (error) {
        if (active) setMessage({ type: 'danger', text: error.message })
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [examId, isNew, globalSettingsLoading, globalSettings.timezone, globalSettings.gradeScaleMax, globalSettings.passingGrade])

  const statusMeta = STATUS_META[status] || STATUS_META.draft
  const hasCodeForPublish = Boolean(form.accessCode.trim()) || (hasAccessCode && !form.clearAccessCode)
  const configuredQuestions = questionStats.configuredCount
  const hasAttemptHistory = attemptCount > 0
  const structureLocked = !isNew && (status !== 'draft' || hasAttemptHistory)
  const scheduleLocked = !isNew && hasAttemptHistory
  const structureLockReason = hasAttemptHistory
    ? `Este examen ya tiene ${attemptCount} intento${attemptCount === 1 ? '' : 's'}. Su estructura queda congelada para conservar la igualdad entre alumnos.`
    : status !== 'draft'
      ? 'Devuelve el examen a borrador antes de cambiar su estructura. Una vez que existan intentos, ya no podrá modificarse.'
      : ''

  const configPayload = useMemo(() => ({
    duration_minutes: Number(form.durationMinutes),
    max_attempts: Number(form.maxAttempts),
    target_question_count: Number(form.targetQuestionCount),
    randomize_questions: Boolean(form.randomizeQuestions),
    randomize_options: Boolean(form.randomizeOptions),
    navigation: form.navigation,
    allow_backtrack: form.navigation === 'free' ? true : Boolean(form.allowBacktrack),
    auto_submit_on_timeout: true,
    result_visibility: form.resultVisibility,
    show_results_after: form.showResultsAfter ? datetimeLocalToZonedIso(form.showResultsAfter, globalSettings.timezone) : null,
    require_student_code: false,
    require_first_name: true,
    require_last_name: true,
    require_email: false,
    require_section: false,
    restrict_to_enrolled_students: Boolean(form.restrictToEnrolledStudents),
    grade_scale_max: Number(form.gradeScaleMax),
    passing_grade: Number(form.passingGrade),
    settings: {
      ...existingSettings,
      security: {
        ...(existingSettings.security || {}),
        enabled: Boolean(form.securityEnabled),
        requireFullscreen: Boolean(form.securityRequireFullscreen),
        detectVisibility: Boolean(form.securityDetectVisibility),
        detectBlur: Boolean(form.securityDetectBlur),
        blockClipboard: Boolean(form.securityBlockClipboard),
        blockContextMenu: Boolean(form.securityBlockContextMenu),
        blockShortcuts: Boolean(form.securityBlockShortcuts),
        watermark: Boolean(form.securityWatermark),
        detectExtendedDisplay: Boolean(form.securityDetectExtendedDisplay),
        requireSeb: Boolean(form.securityRequireSeb),
        maxIncidents: Math.max(1, Number(form.securityMaxIncidents || 3)),
      },
    },
  }), [form, globalSettings.timezone, existingSettings])

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function saveExam(targetStatus = null) {
    const validationErrors = validateForm(form, targetStatus || status, globalSettings.timezone)
    const publishStatus = targetStatus || status
    if (['scheduled', 'active'].includes(publishStatus) && !hasCodeForPublish) {
      validationErrors.push('Configura un código de acceso antes de mantener, programar o activar este examen.')
    }
    if (['scheduled', 'active'].includes(publishStatus) && isNew) {
      validationErrors.push('Guarda primero el examen como borrador y configura su plan de preguntas antes de programarlo o activarlo.')
    }
    if (['scheduled', 'active'].includes(publishStatus) && !isNew
        && Number(questionStats.configuredCount) !== Number(form.targetQuestionCount)) {
      validationErrors.push(`El plan contiene ${questionStats.configuredCount} preguntas y el objetivo es ${form.targetQuestionCount}. Deben coincidir.`)
    }
    if (validationErrors.length) {
      setMessage({ type: 'danger', text: validationErrors.join(' ') })
      return null
    }

    setSaving(true)
    setMessage(null)
    try {
      const examPayload = {
        courseId: form.courseId,
        title: form.title,
        description: form.description,
        instructions: form.instructions,
        startsAt: zonedLocalToIso(form.startDate, form.startTime, globalSettings.timezone),
        endsAt: zonedLocalToIso(form.endDate, form.endTime, globalSettings.timezone),
      }

      let savedId = examId
      if (isNew) {
        savedId = await createTeacherExam({
          exam: examPayload,
          config: configPayload,
          accessCode: form.accessCode,
          ownerUserId: user.id,
        })
        setHasAccessCode(Boolean(form.accessCode.trim()))
      } else {
        await updateTeacherExam({
          examId,
          exam: examPayload,
          config: configPayload,
          accessCode: form.accessCode,
          clearAccessCode: form.clearAccessCode,
        })
        if (form.clearAccessCode) setHasAccessCode(false)
        if (form.accessCode.trim()) setHasAccessCode(true)
      }

      if (targetStatus && targetStatus !== status) {
        await changeExamStatus(savedId, targetStatus)
        setStatus(targetStatus)
      }

      setForm((current) => ({ ...current, accessCode: '', clearAccessCode: false }))
      setMessage({ type: 'success', text: targetStatus ? 'Examen guardado y estado actualizado.' : 'Cambios guardados correctamente.' })
      if (isNew) navigate(`/docente/examenes/${savedId}/editar`, { replace: true })
      return savedId
    } catch (error) {
      setMessage({ type: 'danger', text: error.message })
      return null
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="route-loading">Cargando editor del examen…</div>

  return (
    <section>
      <PageHeader
        eyebrow={isNew ? 'Nuevo examen' : 'Editor de examen'}
        title={form.title || 'Nuevo examen'}
        description={isNew ? 'Configura la evaluación y guárdala inicialmente como borrador.' : 'Los cambios se almacenan en Supabase y conservan el estado actual del examen.'}
        action={
          <div className="actions inline-actions editor-header-actions">
            <StatusBadge tone={statusMeta[1]}>{statusMeta[0]}</StatusBadge>
            <Link className="button secondary" to="/docente/examenes">Volver</Link>
            <button className="button secondary" disabled={saving} onClick={() => saveExam()}>{saving ? 'Guardando…' : 'Guardar'}</button>
            {status !== 'active' && status !== 'archived' && <button className="button primary" disabled={saving} onClick={() => saveExam('scheduled')}>Programar</button>}
          </div>
        }
      />

      {message && <div className={`form-alert ${message.type === 'success' ? 'success' : 'danger'} page-alert`}>{message.text}</div>}
      {structureLocked && <div className="form-alert warning page-alert"><strong>Configuración estructural bloqueada.</strong> {structureLockReason} Puedes seguir editando título, instrucciones, código de acceso y publicación de resultados.</div>}
      {!courses.length && (
        <div className="form-alert warning page-alert">
          No existe un curso activo. Crea primero un curso desde <Link className="inline-link" to="/docente/cursos">Cursos</Link>.
        </div>
      )}

      <div className="editor-layout">
        <nav className="editor-steps surface" aria-label="Secciones del editor">
          <a className="active" href="#general"><span>1</span>Información general</a>
          <a href="#access"><span>2</span>Acceso y horario</a>
          <a href="#questions"><span>3</span>Preguntas</a>
          <a href="#rules"><span>4</span>Reglas</a>
          <a href="#results"><span>5</span>Resultados</a>
        </nav>

        <div className="editor-content">
          <section className="surface form-section" id="general">
            <div className="surface-heading"><div><h2>Información general</h2><p>Datos que identifican la evaluación y que verá el estudiante.</p></div></div>
            <div className="form-grid two-cols">
              <label className="span-2">Título del examen <span className="required-mark">*</span><input value={form.title} onChange={(e) => updateField('title', e.target.value)} placeholder="Ej. Examen Parcial · Seguridad Industrial" /></label>
              <label>Curso <span className="required-mark">*</span><select value={form.courseId} disabled={!isNew && (configuredQuestions > 0 || hasAttemptHistory)} onChange={(e) => updateField('courseId', e.target.value)}><option value="">Seleccionar curso</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.name}{course.section ? ` · ${course.section}` : ''}</option>)}</select>{!isNew && (configuredQuestions > 0 || hasAttemptHistory) && <small>El curso queda bloqueado cuando el examen ya tiene preguntas, reglas o intentos.</small>}</label>
              <label>Descripción<input value={form.description} onChange={(e) => updateField('description', e.target.value)} placeholder="Descripción breve" /></label>
              <label className="span-2">Instrucciones<textarea value={form.instructions} onChange={(e) => updateField('instructions', e.target.value)} placeholder="Indicaciones que el alumno leerá antes de iniciar." /></label>
            </div>
          </section>

          <section className="surface form-section" id="access">
            <div className="surface-heading"><div><h2>Acceso y horario</h2><p>Define el código, la ventana de disponibilidad y la identificación requerida.</p></div></div>
            <div className="form-grid two-cols">
              <label>Código de acceso<input minLength={4} maxLength={64} value={form.accessCode} onChange={(e) => updateField('accessCode', e.target.value)} placeholder={hasAccessCode ? 'Código configurado · escribe para reemplazarlo' : 'Ej. SEG2026'} autoComplete="off" /></label>
              <div className="field-status"><span>Estado del código</span><strong className={hasCodeForPublish ? 'positive-text' : 'muted-text'}>{hasCodeForPublish ? 'Configurado' : 'Sin configurar'}</strong></div>
              {!isNew && hasAccessCode && <label className="checkbox-row compact-check span-2"><input type="checkbox" checked={form.clearAccessCode} onChange={(e) => updateField('clearAccessCode', e.target.checked)} />Eliminar el código de acceso actual al guardar. Un examen activo o programado no puede quedar sin código.</label>}
              <label>Fecha de inicio<input type="date" disabled={scheduleLocked} value={form.startDate} onChange={(e) => updateField('startDate', e.target.value)} /></label>
              <label>Hora de inicio<input type="time" disabled={scheduleLocked} value={form.startTime} onChange={(e) => updateField('startTime', e.target.value)} /></label>
              <label>Fecha de cierre<input type="date" disabled={scheduleLocked} value={form.endDate} onChange={(e) => updateField('endDate', e.target.value)} /></label>
              <label>Hora de cierre<input type="time" disabled={scheduleLocked} value={form.endTime} onChange={(e) => updateField('endTime', e.target.value)} /></label>
              <label>Duración por intento (minutos)<input type="number" min="1" disabled={structureLocked} value={form.durationMinutes} onChange={(e) => updateField('durationMinutes', e.target.value)} /></label>
              <label>Máximo de intentos<input type="number" min="1" disabled={structureLocked} value={form.maxAttempts} onChange={(e) => updateField('maxAttempts', e.target.value)} /></label>
            </div>

            <div className="subsection-divider" />
            <h3 className="form-subtitle">Identificación del estudiante</h3>
            <div className="identity-fixed-card">
              <strong>Apellidos y nombres</strong>
              <span>El acceso del estudiante solicita únicamente estos dos datos. No se mostrará código universitario, correo ni sección.</span>
            </div>
            <div className="toggle-grid section-gap">
              <label className="toggle-row"><input type="checkbox" disabled={structureLocked} checked={form.restrictToEnrolledStudents} onChange={(e) => updateField('restrictToEnrolledStudents', e.target.checked)} /><span><strong>Solo matriculados</strong><small>Cuando se activa, el sistema buscará coincidencia exacta de apellidos y nombres en la matrícula del curso.</small></span></label>
            </div>
          </section>

          <section className="surface form-section" id="questions">
            <div className="surface-heading"><div><h2>Preguntas</h2><p>Define la cantidad objetivo y el comportamiento de ordenamiento.</p></div><Link className="button secondary button-small" to="/docente/bancos">Ir al banco</Link></div>
            <div className="form-grid two-cols">
              <label>Cantidad objetivo de preguntas<input type="number" min="1" disabled={structureLocked} value={form.targetQuestionCount} onChange={(e) => updateField('targetQuestionCount', e.target.value)} /></label>
              <div className="field-status"><span>Preguntas actualmente vinculadas</span><strong>{configuredQuestions}</strong></div>
            </div>
            <div className="toggle-grid section-gap">
              <label className="toggle-row"><input type="checkbox" disabled={structureLocked} checked={form.randomizeQuestions} onChange={(e) => updateField('randomizeQuestions', e.target.checked)} /><span><strong>Aleatorizar preguntas</strong><small>El motor genera un conjunto diferente por intento y lo mantiene congelado.</small></span></label>
              <label className="toggle-row"><input type="checkbox" disabled={structureLocked} checked={form.randomizeOptions} onChange={(e) => updateField('randomizeOptions', e.target.checked)} /><span><strong>Aleatorizar alternativas</strong><small>El orden puede variar por intento sin alterar la respuesta correcta.</small></span></label>
            </div>
            <div className="question-summary section-gap">
              <div><strong>{questionStats.fixedCount}</strong><span>preguntas fijas</span></div>
              <div><strong>{questionStats.randomCount}</strong><span>por reglas aleatorias</span></div>
              <div><strong>{form.targetQuestionCount}</strong><span>objetivo configurado</span></div>
            </div>
            <ExamQuestionPlan
              examId={examId}
              courseId={form.courseId}
              targetCount={Number(form.targetQuestionCount)}
              onStatsChange={setQuestionStats}
              locked={structureLocked}
              lockedReason={structureLockReason}
            />
          </section>

          <section className="surface form-section" id="rules">
            <div className="surface-heading"><div><h2>Reglas de navegación</h2><p>Controla cómo avanza el alumno durante el intento.</p></div></div>
            <div className="form-grid two-cols">
              <label>Modo de navegación<select disabled={structureLocked} value={form.navigation} onChange={(e) => updateField('navigation', e.target.value)}><option value="free">Libre</option><option value="sequential">Pregunta por pregunta</option></select></label>
              <div className="field-status"><span>Cierre al terminar el tiempo</span><strong>Automático</strong></div>
            </div>
            <div className="toggle-grid section-gap">
              <label className="toggle-row"><input type="checkbox" checked={form.allowBacktrack} disabled={structureLocked || form.navigation === 'free'} onChange={(e) => updateField('allowBacktrack', e.target.checked)} /><span><strong>Permitir volver atrás</strong><small>{form.navigation === 'free' ? 'La navegación libre ya permite volver a cualquier pregunta.' : 'Disponible en navegación secuencial.'}</small></span></label>
              <div className="toggle-row"><span><strong>Envío automático al vencer</strong><small>Se mantiene obligatorio para que ningún intento continúe editable después de la hora límite.</small></span></div>
            </div>
          </section>

          <section className="surface form-section" id="security">
            <div className="surface-heading"><div><h2>Seguridad del examen</h2><p>Medidas de integridad aplicadas durante el intento. Ninguna página web puede impedir por completo el uso de un segundo dispositivo, pero estas opciones dificultan y registran conductas de copia.</p></div></div>
            <div className="toggle-grid">
              <label className="toggle-row"><input type="checkbox" disabled={structureLocked} checked={form.securityEnabled} onChange={(e) => updateField('securityEnabled', e.target.checked)} /><span><strong>Modo de seguridad</strong><small>Activa las medidas de supervisión del navegador.</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={form.securityRequireFullscreen} disabled={structureLocked || !form.securityEnabled} onChange={(e) => updateField('securityRequireFullscreen', e.target.checked)} /><span><strong>Pantalla completa obligatoria</strong><small>Bloquea la vista del examen hasta volver a pantalla completa.</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={form.securityDetectVisibility} disabled={structureLocked || !form.securityEnabled} onChange={(e) => updateField('securityDetectVisibility', e.target.checked)} /><span><strong>Detectar cambio de pestaña</strong><small>Registra cuándo la página queda oculta.</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={form.securityDetectBlur} disabled={structureLocked || !form.securityEnabled} onChange={(e) => updateField('securityDetectBlur', e.target.checked)} /><span><strong>Detectar pérdida de foco</strong><small>Registra el cambio hacia otra ventana o aplicación cuando el navegador lo informa.</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={form.securityBlockClipboard} disabled={structureLocked || !form.securityEnabled} onChange={(e) => updateField('securityBlockClipboard', e.target.checked)} /><span><strong>Bloquear copiar, cortar y pegar</strong><small>Impide estas acciones dentro de la evaluación.</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={form.securityBlockContextMenu} disabled={structureLocked || !form.securityEnabled} onChange={(e) => updateField('securityBlockContextMenu', e.target.checked)} /><span><strong>Bloquear menú contextual</strong><small>Deshabilita el clic derecho durante el intento.</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={form.securityBlockShortcuts} disabled={structureLocked || !form.securityEnabled} onChange={(e) => updateField('securityBlockShortcuts', e.target.checked)} /><span><strong>Bloquear atajos sensibles</strong><small>Intercepta copiar/pegar, imprimir, guardar, ver código y accesos comunes a herramientas de desarrollo cuando el navegador lo permite.</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={form.securityWatermark} disabled={structureLocked || !form.securityEnabled} onChange={(e) => updateField('securityWatermark', e.target.checked)} /><span><strong>Marca de agua personalizada</strong><small>Muestra el nombre del estudiante sobre el examen para desincentivar fotografías compartidas.</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={form.securityDetectExtendedDisplay} disabled={structureLocked || !form.securityEnabled} onChange={(e) => updateField('securityDetectExtendedDisplay', e.target.checked)} /><span><strong>Detectar pantalla extendida</strong><small>Cuando el navegador lo permite, registra si el equipo informa más de una pantalla.</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={form.securityRequireSeb} disabled={structureLocked || !form.securityEnabled} onChange={(e) => updateField('securityRequireSeb', e.target.checked)} /><span><strong>Requerir Safe Exam Browser (opcional)</strong><small>Impide iniciar desde un navegador común. Requiere que los estudiantes tengan SEB instalado; la detección web es una capa adicional y no sustituye Browser Exam Key.</small></span></label>
            </div>
            <div className="form-grid two-cols section-gap"><label>Umbral de incidencias<input type="number" min="1" max="20" value={form.securityMaxIncidents} onChange={(e) => updateField('securityMaxIncidents', e.target.value)} disabled={structureLocked || !form.securityEnabled} /></label><div className="field-status"><span>Acción al alcanzar el umbral</span><strong>Registrar y advertir</strong></div></div>
            <p className="helper-copy">Las incidencias quedan asociadas al intento y se muestran en Resultados. No se anula automáticamente una evaluación para evitar penalizar fallos legítimos del sistema.</p>
          </section>

          <section className="surface form-section" id="results">
            <div className="surface-heading"><div><h2>Resultados</h2><p>Determina qué información verá el alumno después del envío.</p></div></div>
            <div className="form-grid two-cols">
              <label>Visibilidad para el estudiante<select value={form.resultVisibility} onChange={(e) => updateField('resultVisibility', e.target.value)}><option value="confirmation_only">Solo confirmación de envío</option><option value="score_only">Puntaje obtenido</option><option value="grade">Nota final</option><option value="correct_answers">Respuestas correctas</option><option value="full_feedback">Respuestas + retroalimentación docente</option></select></label>
              <label>Mostrar resultados desde<input type="datetime-local" value={form.showResultsAfter} onChange={(e) => updateField('showResultsAfter', e.target.value)} /></label>
              <label>Escala máxima<input type="number" min="1" step="0.1" disabled={structureLocked} value={form.gradeScaleMax} onChange={(e) => updateField('gradeScaleMax', e.target.value)} /></label>
              <label>Nota aprobatoria<input type="number" min="0" step="0.1" disabled={structureLocked} value={form.passingGrade} onChange={(e) => updateField('passingGrade', e.target.value)} /></label>
            </div>
            <p className="helper-copy">Las respuestas correctas y la retroalimentación detallada solo se liberan después del cierre general del examen y respetan la fecha de publicación configurada.</p>
          </section>

          <div className="editor-footer-actions">
            <Link className="button secondary" to="/docente/examenes">Cancelar</Link>
            <button className="button secondary" disabled={saving || !courses.length} onClick={() => saveExam()}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
            {status !== 'active' && status !== 'archived' && <button className="button primary" disabled={saving || !courses.length} onClick={() => saveExam('active')}>Guardar y activar</button>}
          </div>
        </div>
      </div>
    </section>
  )
}
