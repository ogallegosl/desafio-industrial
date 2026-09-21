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

const STATUS_LABELS = {
  created: 'Sin iniciar',
  in_progress: 'En curso',
  submitted: 'Entregado',
  time_expired: 'Tiempo vencido',
  cancelled: 'Cancelado',
}

const REVIEW_LABELS = {
  not_required: 'No requiere revisión',
  pending: 'Pendiente',
  reviewed: 'Revisada',
}


function spreadsheetSafe(value) {
  if (value === null || value === undefined) return value
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value
  const text = String(value)
  // Prevent spreadsheet/CSV formula injection from student-authored content.
  // Excel and similar tools may interpret leading =, +, -, @, tab or CR as formulas.
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}


function examGradeSettings(exam) {
  const cfg = Array.isArray(exam?.configuraciones_examen) ? exam.configuraciones_examen[0] : exam?.configuraciones_examen
  const scale = Number(cfg?.grade_scale_max ?? 20)
  const cap = Number(cfg?.settings?.grading?.finalGradeCap ?? scale)
  return {
    scale: Number.isFinite(scale) && scale > 0 ? scale : 20,
    cap: Number.isFinite(cap) && cap > 0 ? Math.min(cap, Number.isFinite(scale) && scale > 0 ? scale : 20) : 20,
  }
}

function safeObjectStrings(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, spreadsheetSafe(value)]))
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function optionIndex(option, fallbackIndex) {
  const order = Number(option?.displayOrder)
  return Number.isFinite(order) && order > 0 ? order - 1 : fallbackIndex
}

function formatOptionIds(ids, options) {
  const selected = new Set(normalizeArray(ids).map(String))
  const matched = normalizeArray(options)
    .map((option, index) => ({ option, index: optionIndex(option, index) }))
    .filter(({ option }) => selected.has(String(option?.id)))
    .sort((a, b) => a.index - b.index)
    .map(({ option, index }) => `${String.fromCharCode(65 + Math.max(0, index))}. ${option?.content || ''}`.trim())
  return matched.join(' | ')
}

function formatBoolean(value) {
  if (value === true || value === 'true') return 'Verdadero'
  if (value === false || value === 'false') return 'Falso'
  return ''
}

function evidenceText(files) {
  return normalizeArray(files).map((file) => file?.filename).filter(Boolean).join(' | ')
}

function numericCorrectAnswer(grading = {}) {
  const key = grading?.answerKey || {}
  const config = grading?.gradingConfig || {}
  const mode = config.numericMode || ((key.min != null || key.max != null) ? 'range' : (grading.numericTolerance != null ? 'tolerance' : 'exact'))
  if (mode === 'range') {
    const min = config.min ?? key.min
    const max = config.max ?? key.max
    if (min == null && max == null) return ''
    return `${min ?? '—'} a ${max ?? '—'}`
  }
  const target = key.value
  if (target == null) return ''
  if (mode === 'tolerance') return `${target} ± ${grading.numericTolerance ?? 0}`
  return String(target)
}

function formatNestedAnswer(question, answer = {}) {
  const type = question?.type
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) {
    return formatOptionIds(answer?.selectedOptionIds, question?.options)
  }
  if (type === 'true_false') return formatBoolean(answer?.answerPayload?.value)
  if (['short_text', 'essay', 'image_essay'].includes(type)) return String(answer?.answerText ?? '').trim()
  if (['numeric', 'calculation', 'calculation_evidence'].includes(type)) {
    return answer?.answerNumeric == null || answer?.answerNumeric === '' ? '' : String(answer.answerNumeric)
  }
  return String(answer?.answerText ?? '').trim()
}

function formatNestedCorrect(question, grading = {}) {
  const type = question?.type
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) {
    return formatOptionIds(grading?.correctOptionIds, question?.options)
  }
  if (type === 'true_false') return formatBoolean(grading?.answerKey?.value)
  if (type === 'short_text') return normalizeArray(grading?.answerKey?.answers).join(' | ')
  if (['numeric', 'calculation', 'calculation_evidence'].includes(type)) return numericCorrectAnswer(grading)
  if (['essay', 'image_essay', 'attachment'].includes(type)) return 'Revisión manual'
  return ''
}

export function formatResponse(detail) {
  const type = detail?.type
  const answerPayload = detail?.answerPayload || {}
  if (!detail?.isAnswered) return 'Omitida'

  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) {
    return formatOptionIds(detail?.selectedOptionIds, detail?.options) || 'Omitida'
  }
  if (type === 'true_false') return formatBoolean(answerPayload?.value) || 'Omitida'
  if (['short_text', 'essay', 'image_essay'].includes(type)) return String(detail?.answerText ?? '').trim() || 'Omitida'
  if (['numeric', 'calculation'].includes(type)) {
    return detail?.answerNumeric == null ? 'Omitida' : String(detail.answerNumeric)
  }
  if (type === 'calculation_evidence') {
    const value = detail?.answerNumeric == null ? '' : String(detail.answerNumeric)
    const files = evidenceText(detail?.evidenceFiles)
    return [value && `Resultado: ${value}`, files && `Evidencia: ${files}`].filter(Boolean).join(' | ') || 'Omitida'
  }
  if (type === 'attachment') return evidenceText(detail?.evidenceFiles) || 'Omitida'
  if (type === 'case_group') {
    const children = normalizeArray(detail?.metadata?.caseSubquestions)
    const caseAnswers = answerPayload?.caseAnswers || {}
    const lines = children.map((child, index) => {
      const value = formatNestedAnswer(child, caseAnswers?.[child.id] || {}) || 'Omitida'
      return `${index + 1}. ${child.prompt || 'Subpregunta'} → ${value}`
    })
    return lines.join('\n') || 'Omitida'
  }
  return String(detail?.answerText ?? '').trim() || 'Omitida'
}

export function formatCorrectResponse(detail) {
  const type = detail?.type
  const grading = detail?.grading || {}
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) {
    return formatOptionIds(grading?.correctOptionIds, detail?.options) || '—'
  }
  if (type === 'true_false') return formatBoolean(grading?.answerKey?.value) || '—'
  if (type === 'short_text') return normalizeArray(grading?.answerKey?.answers).join(' | ') || '—'
  if (['numeric', 'calculation'].includes(type)) return numericCorrectAnswer(grading) || '—'
  if (type === 'calculation_evidence') {
    const numeric = numericCorrectAnswer(grading)
    return [numeric, 'Evidencia requerida'].filter(Boolean).join(' | ') || 'Evidencia requerida'
  }
  if (['essay', 'image_essay', 'attachment'].includes(type)) return 'Revisión manual'
  if (type === 'case_group') {
    const children = normalizeArray(detail?.metadata?.caseSubquestions)
    const childGradings = new Map(normalizeArray(grading?.caseSubquestions).map((item) => [String(item?.id), item?.grading || {}]))
    return children.map((child, index) => {
      const value = formatNestedCorrect(child, childGradings.get(String(child.id)) || {}) || 'Revisión manual'
      return `${index + 1}. ${child.prompt || 'Subpregunta'} → ${value}`
    }).join('\n') || 'Revisión manual'
  }
  return '—'
}

export function secondsToClock(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return ''
  const total = Math.max(0, Math.round(Number(seconds)))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function resultEndAt(row) {
  if (row?.submittedAt) return row.submittedAt
  if (row?.status === 'time_expired') return row?.deadlineAt || null
  return null
}

export function buildGeneralRows({ exam, students }) {
  const course = exam?.cursos?.name || ''
  const examTitle = exam?.title || ''
  const { scale, cap } = examGradeSettings(exam)
  return normalizeArray(students).map((row) => {
    const raw = Number(row.rawScore)
    const max = Number(row.maxRawScore)
    const directPointScale = Number.isFinite(max) && max > 0 && Math.abs(max - cap) <= 0.001
    const calculated = Number.isFinite(raw) && Number.isFinite(max) && max > 0
      ? (directPointScale ? raw : (raw / max) * scale)
      : null
    return safeObjectStrings({
    Apellidos: row.lastName || '',
    Nombres: row.firstName || '',
    Correo: row.email || '',
    Sección: row.section || '',
    Curso: course,
    Examen: examTitle,
    Intento: row.attemptNumber ?? '',
    Estado: STATUS_LABELS[row.status] || row.status || '',
    Inicio: row.startedAt ? new Date(row.startedAt) : null,
    Fin: resultEndAt(row) ? new Date(resultEndAt(row)) : null,
    'Tiempo utilizado': secondsToClock(row.elapsedSeconds),
    Correctas: Number(row.correct || 0),
    Incorrectas: Number(row.incorrect || 0),
    Omitidas: Number(row.omitted || 0),
    'Puntaje automático': row.autoScore == null ? null : Number(row.autoScore),
    'Puntaje manual': row.manualScore == null ? null : Number(row.manualScore),
    'Puntaje total': row.rawScore == null ? null : Number(row.rawScore),
    'Puntaje máximo': row.maxRawScore == null ? null : Number(row.maxRawScore),
    'Nota calculada': calculated == null ? null : Number(calculated.toFixed(3)),
    'Puntaje máximo del examen': cap,
    'Nota final': row.finalGrade == null ? null : Number(row.finalGrade),
    'Revisiones pendientes': Number(row.pendingManualReviews || 0),
    'Incidencias de integridad': Number(row.securityIncidents || 0),
  })
  })
}


export function buildDetailRows({ details }) {
  return normalizeArray(details).map((row) => safeObjectStrings({
    Alumno: `${row.lastName || ''}, ${row.firstName || ''}`.replace(/^,\s*/, '').trim(),
    Correo: row.email || '',
    Sección: row.section || '',
    Intento: row.attemptNumber ?? '',
    'N.º pregunta': row.questionOrder ?? '',
    Pregunta: row.prompt || '',
    Respuesta: formatResponse(row),
    'Respuesta correcta': formatCorrectResponse(row),
    Puntaje: row.effectiveScore == null ? null : Number(row.effectiveScore),
    'Puntaje máximo': row.points == null ? null : Number(row.points),
    Tipo: TYPE_LABELS[row.type] || row.type || '',
    'Resultado objetivo': row.isCorrect === true ? 'Correcta' : row.isCorrect === false ? 'Incorrecta' : 'No aplica',
    Revisión: REVIEW_LABELS[row.reviewStatus] || row.reviewStatus || '',
    Retroalimentación: row.teacherFeedback || '',
  }))
}

export const RESULTS_EXPORT_GENERAL_COLUMNS = [
  'Apellidos', 'Nombres', 'Correo', 'Sección', 'Curso', 'Examen', 'Intento', 'Estado',
  'Inicio', 'Fin', 'Tiempo utilizado', 'Correctas', 'Incorrectas', 'Omitidas', 'Puntaje automático',
  'Puntaje manual', 'Puntaje total', 'Puntaje máximo', 'Nota calculada', 'Puntaje máximo del examen', 'Nota final', 'Revisiones pendientes', 'Incidencias de integridad',
]

export const RESULTS_EXPORT_DETAIL_COLUMNS = [
  'Alumno', 'Correo', 'Sección', 'Intento', 'N.º pregunta', 'Pregunta', 'Respuesta',
  'Respuesta correcta', 'Puntaje', 'Puntaje máximo', 'Tipo', 'Resultado objetivo', 'Revisión', 'Retroalimentación',
]
