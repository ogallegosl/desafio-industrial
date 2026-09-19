const DEMO_CODE = 'DEMO2026'
const STATE_KEY = 'desafioIndustrial.localDemo.v2'
const SESSION_PREFIX = 'demo-local:'
const DURATION_MINUTES = 30
const GRADE_SCALE_MAX = 20
const PASSING_GRADE = 10.5

const demoExam = {
  title: '[DEMO LOCAL] Examen integral — Ingeniería Industrial',
  description: 'Recorrido local de Desafío Industrial. No requiere Supabase y guarda el avance únicamente en este navegador.',
  instructions: 'Este modo existe para evaluar la experiencia de la plataforma.\n\n• Puedes responder, navegar, adjuntar una evidencia de prueba, revisar y enviar.\n• El cronómetro dura 30 minutos y continúa después de recargar la página.\n• Los datos se guardan solo en este navegador; no se envían a ningún servidor.\n• Al finalizar puedes salir y volver a ingresar con DEMO2026 para iniciar otro intento de demostración.',
  startsAt: null,
  endsAt: null,
  durationMinutes: DURATION_MINUTES,
  maxAttempts: 99,
  questionCount: 15,
  restrictToEnrolledStudents: false,
  requiredFields: {
    studentCode: false,
    firstName: true,
    lastName: true,
    email: false,
    section: false,
  },
  security: { enabled: true, requireFullscreen: true, detectVisibility: true, detectBlur: true, blockClipboard: true, blockContextMenu: true, blockShortcuts: true, watermark: true, detectExtendedDisplay: true, requireSeb: false, maxIncidents: 3 },
  course: { name: 'Ingeniería Industrial', code: 'IND-DEMO', section: 'Local' },
}

const opt = (id, content) => ({ id, content })

const demoQuestions = [
  {
    id: 'demo-q01', order: 1, type: 'single_choice', points: 1,
    prompt: '¿Cuál de las siguientes opciones describe mejor un peligro?',
    options: [
      opt('q01-a', 'La probabilidad de que ocurra un accidente.'),
      opt('q01-b', 'Una fuente, situación o acto con potencial de causar daño.'),
      opt('q01-c', 'El resultado económico de un incidente.'),
      opt('q01-d', 'La frecuencia con la que se realiza una inspección.'),
    ],
    metadata: { topic: 'Peligros y riesgos' },
  },
  {
    id: 'demo-q02', order: 2, type: 'multiple_choice', points: 1,
    prompt: 'Selecciona las medidas que corresponden a controles de ingeniería.',
    options: [
      opt('q02-a', 'Instalar una guarda física en una máquina.'),
      opt('q02-b', 'Colocar extracción localizada.'),
      opt('q02-c', 'Entregar una charla de cinco minutos.'),
      opt('q02-d', 'Entregar guantes de seguridad.'),
    ],
    metadata: { topic: 'Jerarquía de controles' },
  },
  {
    id: 'demo-q03', order: 3, type: 'true_false', points: 1,
    prompt: 'El riesgo depende únicamente de la severidad y no de la probabilidad.',
    options: [], metadata: { topic: 'Evaluación de riesgos' },
  },
  {
    id: 'demo-q04', order: 4, type: 'numeric', points: 1,
    prompt: 'En un lote de 400 unidades se encuentran 20 defectuosas. ¿Cuál es el porcentaje de unidades defectuosas? Ingresa solo el número.',
    options: [], metadata: { topic: 'Cálculo básico' },
  },
  {
    id: 'demo-q05', order: 5, type: 'image_single_choice', points: 1,
    prompt: 'Observa la escena. ¿Qué condición debería priorizarse por su capacidad inmediata de provocar una caída?',
    mediaUrl: '/demo/seguridad-almacen.svg',
    options: [
      opt('q05-a', 'Material obstruyendo la zona de tránsito.'),
      opt('q05-b', 'Color de las paredes del almacén.'),
      opt('q05-c', 'Cantidad de luminarias instaladas.'),
      opt('q05-d', 'Marca de las cajas almacenadas.'),
    ],
    metadata: { topic: 'Inspección visual', demo: true },
  },
  {
    id: 'demo-q06', order: 6, type: 'calculation', points: 1,
    prompt: 'Una operación produce 480 unidades buenas en un turno en el que se fabricaron 500 unidades. Calcula el rendimiento porcentual.',
    options: [], metadata: { topic: 'Indicadores' },
  },
  {
    id: 'demo-q07', order: 7, type: 'short_text', points: 1,
    prompt: '¿Cuál es la abreviatura habitual de decibel, unidad utilizada para expresar niveles sonoros?',
    options: [], metadata: { topic: 'Ruido ocupacional' },
  },
  {
    id: 'demo-q08', order: 8, type: 'essay', points: 1,
    prompt: 'Explica brevemente la diferencia entre peligro y riesgo usando un ejemplo de un taller industrial.',
    options: [], metadata: { topic: 'Análisis' },
  },
  {
    id: 'demo-q09', order: 9, type: 'calculation_evidence', points: 1,
    prompt: 'Una medición registra 400 lux y el valor de referencia del ejercicio es 500 lux. Calcula el porcentaje que representa la medición respecto del valor de referencia y adjunta una evidencia de tu procedimiento.',
    options: [], metadata: { topic: 'Iluminación' },
  },
  {
    id: 'demo-q10', order: 10, type: 'attachment', points: 1,
    prompt: 'Adjunta una fotografía o PDF de prueba para comprobar el flujo de carga de evidencias. En modo DEMO el archivo permanece únicamente en este navegador.',
    options: [], metadata: { topic: 'Evidencia' },
  },
  {
    id: 'demo-q11', order: 11, type: 'case_group', points: 2,
    prompt: 'Caso: en un área de producción se detectan 92 dB de ruido y un trabajador permanece allí durante varias horas sin protección auditiva. Responde las dos subpreguntas.',
    options: [],
    metadata: {
      topic: 'Caso aplicado',
      caseSubquestions: [
        {
          id: 'demo-q11-a', type: 'single_choice', points: 1,
          prompt: '¿Cuál es el agente ocupacional principal del caso?',
          options: [opt('q11a-a', 'Físico'), opt('q11a-b', 'Biológico'), opt('q11a-c', 'Químico'), opt('q11a-d', 'Psicosocial')],
          metadata: { topic: 'Ruido' },
        },
        {
          id: 'demo-q11-b', type: 'single_choice', points: 1,
          prompt: '¿Cuál sería una medida prioritaria antes de depender únicamente del EPP?',
          options: [opt('q11b-a', 'Evaluar controles de ingeniería en la fuente o trayectoria'), opt('q11b-b', 'Aumentar el tiempo de exposición'), opt('q11b-c', 'Retirar la señalización'), opt('q11b-d', 'Ignorar la medición')],
          metadata: { topic: 'Controles' },
        },
      ],
    },
  },
  {
    id: 'demo-q12', order: 12, type: 'single_choice', points: 1,
    prompt: 'En la jerarquía de controles, ¿qué medida suele tener prioridad sobre el uso de EPP?',
    options: [opt('q12-a', 'Eliminación del peligro'), opt('q12-b', 'Capacitación únicamente'), opt('q12-c', 'Cartel informativo únicamente'), opt('q12-d', 'Registro fotográfico')],
    metadata: { topic: 'Jerarquía de controles' },
  },
  {
    id: 'demo-q13', order: 13, type: 'true_false', points: 1,
    prompt: 'Una condición subestándar corresponde a una situación física del ambiente de trabajo que puede contribuir a un incidente.',
    options: [], metadata: { topic: 'Inspecciones' },
  },
  {
    id: 'demo-q14', order: 14, type: 'numeric', points: 1,
    prompt: 'Una máquina opera 7.5 horas de un turno programado de 8 horas. Calcula su disponibilidad porcentual. Se acepta una pequeña diferencia de redondeo.',
    options: [], metadata: { topic: 'Indicadores' },
  },
  {
    id: 'demo-q15', order: 15, type: 'image_essay', points: 1,
    prompt: 'Observa nuevamente la escena y escribe dos acciones correctivas concretas que propondrías como responsable de seguridad.',
    mediaUrl: '/demo/seguridad-almacen.svg',
    options: [], metadata: { topic: 'Análisis visual', demo: true },
  },
]

const keys = {
  'demo-q01': { kind: 'single', ids: ['q01-b'], correct: 'B. Una fuente, situación o acto con potencial de causar daño.' },
  'demo-q02': { kind: 'multiple', ids: ['q02-a', 'q02-b'], correct: 'A. Instalar una guarda física en una máquina · B. Colocar extracción localizada.' },
  'demo-q03': { kind: 'boolean', value: false, correct: 'Falso' },
  'demo-q04': { kind: 'numeric', value: 5, tolerance: 0.05, correct: '5' },
  'demo-q05': { kind: 'single', ids: ['q05-a'], correct: 'A. Material obstruyendo la zona de tránsito.' },
  'demo-q06': { kind: 'numeric', value: 96, tolerance: 0.1, correct: '96' },
  'demo-q07': { kind: 'text', accepted: ['db', 'dB', 'decibel', 'decibeles'], correct: 'dB' },
  'demo-q08': { kind: 'manual' },
  'demo-q09': { kind: 'numeric-evidence', value: 80, tolerance: 0.1, correct: '80' },
  'demo-q10': { kind: 'manual-evidence' },
  'demo-q11': {
    kind: 'case',
    children: {
      'demo-q11-a': { kind: 'single', ids: ['q11a-a'], points: 1, correct: 'A. Físico' },
      'demo-q11-b': { kind: 'single', ids: ['q11b-a'], points: 1, correct: 'A. Evaluar controles de ingeniería en la fuente o trayectoria' },
    },
  },
  'demo-q12': { kind: 'single', ids: ['q12-a'], correct: 'A. Eliminación del peligro' },
  'demo-q13': { kind: 'boolean', value: true, correct: 'Verdadero' },
  'demo-q14': { kind: 'numeric', value: 93.75, tolerance: 0.2, correct: '93.75' },
  'demo-q15': { kind: 'manual' },
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function readState() {
  try {
    const raw = window.localStorage.getItem(STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeState(state) {
  window.localStorage.setItem(STATE_KEY, JSON.stringify(state))
  return state
}

function makeAttempt(number = 1) {
  return {
    id: `demo-local-attempt-${number}`,
    number,
    status: 'created',
    startedAt: null,
    deadlineAt: null,
    submittedAt: null,
    currentOrder: 1,
    maxReachedOrder: 1,
  }
}

function normalizeState() {
  let state = readState()
  if (!state) return null
  if (state.attempt?.status === 'in_progress' && state.attempt.deadlineAt && Date.now() >= new Date(state.attempt.deadlineAt).getTime()) {
    state.attempt.status = 'time_expired'
    state.attempt.submittedAt = state.attempt.deadlineAt
    state.grading = gradeState(state)
    state = writeState(state)
  }
  return state
}

function newState(identity, number = 1) {
  const safeIdentity = identity || {}
  return writeState({
    version: 1,
    mode: 'local-demo',
    student: {
      code: 'DEMO-LOCAL',
      firstName: String(safeIdentity.firstName || 'Estudiante').trim() || 'Estudiante',
      lastName: String(safeIdentity.lastName || '').trim(),
      email: String(safeIdentity.email || '').trim() || null,
      section: String(safeIdentity.section || '').trim() || 'Local',
    },
    attempt: makeAttempt(number),
    answers: {},
    evidence: {},
    pendingUploads: {},
    incidents: [],
    grading: null,
  })
}

function sessionTokenFor(state) {
  return `${SESSION_PREFIX}${state.attempt.id}`
}

function requireDemoSession(sessionToken) {
  if (!isLocalDemoSession(sessionToken)) {
    const error = new Error('La sesión DEMO local no es válida.')
    error.code = 'SESSION_INVALID'
    throw error
  }
  const state = normalizeState()
  if (!state || sessionToken !== sessionTokenFor(state)) {
    const error = new Error('La sesión DEMO local ya no está disponible.')
    error.code = 'SESSION_INVALID'
    throw error
  }
  return state
}

function attemptPayload(state) {
  return {
    attempt: clone(state.attempt),
    student: {
      ...clone(state.student),
      displayName: [state.student.firstName, state.student.lastName].filter(Boolean).join(' ').trim(),
    },
    exam: clone(demoExam),
    localDemo: true,
  }
}

function answerPresent(question, answer, evidence) {
  const value = answer || {}
  const selected = Array.isArray(value.selectedOptionIds) ? value.selectedOptionIds : []
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(question.type)) return selected.length > 0
  if (question.type === 'true_false') return typeof value.answerPayload?.value === 'boolean'
  if (['numeric', 'calculation'].includes(question.type)) return value.answerNumeric !== '' && value.answerNumeric != null && Number.isFinite(Number(String(value.answerNumeric).replace(',', '.')))
  if (question.type === 'calculation_evidence') return value.answerNumeric !== '' && value.answerNumeric != null && Boolean(evidence)
  if (['short_text', 'essay', 'image_essay'].includes(question.type)) return String(value.answerText || '').trim().length > 0
  if (question.type === 'attachment') return Boolean(evidence)
  if (question.type === 'case_group') {
    const children = question.metadata?.caseSubquestions || []
    const caseAnswers = value.answerPayload?.caseAnswers || {}
    return children.length > 0 && children.every((child) => answerPresent(child, caseAnswers[child.id], null))
  }
  return false
}

function summarizeAnswer(question, answer, evidence) {
  const value = answer || {}
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(question.type)) {
    const selected = new Set(value.selectedOptionIds || [])
    return (question.options || []).filter((option) => selected.has(option.id)).map((option, index) => `${String.fromCharCode(65 + question.options.indexOf(option))}. ${option.content}`).join(' · ')
  }
  if (question.type === 'true_false') return typeof value.answerPayload?.value === 'boolean' ? (value.answerPayload.value ? 'Verdadero' : 'Falso') : ''
  if (['numeric', 'calculation', 'calculation_evidence'].includes(question.type)) return value.answerNumeric == null ? '' : String(value.answerNumeric)
  if (question.type === 'attachment') return evidence ? `Archivo adjunto: ${evidence.name}` : ''
  if (question.type === 'case_group') return 'Caso respondido'
  return String(value.answerText || '')
}

function equalSets(a, b) {
  const left = [...new Set(a || [])].sort()
  const right = [...new Set(b || [])].sort()
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function scoreByKey(key, answer, evidence, points) {
  if (!key) return { score: 0, isCorrect: null, pending: false }
  if (key.kind === 'manual') return { score: 0, isCorrect: null, pending: Boolean(String(answer?.answerText || '').trim()) }
  if (key.kind === 'manual-evidence') return { score: 0, isCorrect: null, pending: Boolean(evidence) }
  if (key.kind === 'single' || key.kind === 'multiple') {
    const correct = equalSets(answer?.selectedOptionIds || [], key.ids)
    return { score: correct ? points : 0, isCorrect: correct, pending: false }
  }
  if (key.kind === 'boolean') {
    const correct = answer?.answerPayload?.value === key.value
    return { score: correct ? points : 0, isCorrect: correct, pending: false }
  }
  if (key.kind === 'text') {
    const normalized = String(answer?.answerText || '').trim().toLocaleLowerCase('es')
    const accepted = (key.accepted || []).map((item) => String(item).trim().toLocaleLowerCase('es'))
    const correct = normalized.length > 0 && accepted.includes(normalized)
    return { score: correct ? points : 0, isCorrect: correct, pending: false }
  }
  if (key.kind === 'numeric' || key.kind === 'numeric-evidence') {
    const numeric = Number(String(answer?.answerNumeric ?? '').replace(',', '.'))
    const correctNumber = Number.isFinite(numeric) && Math.abs(numeric - key.value) <= Number(key.tolerance || 0)
    const hasEvidence = key.kind !== 'numeric-evidence' || Boolean(evidence)
    const correct = correctNumber && hasEvidence
    return { score: correct ? points : 0, isCorrect: correctNumber ? (hasEvidence ? true : null) : false, pending: key.kind === 'numeric-evidence' && Boolean(evidence) }
  }
  return { score: 0, isCorrect: null, pending: false }
}

function gradeState(state) {
  let rawScore = 0
  let maxRawScore = 0
  let pendingManualReviews = 0
  const details = []

  for (const question of demoQuestions) {
    const answer = state.answers?.[question.id] || null
    const evidence = state.evidence?.[question.id] || null
    const key = keys[question.id]
    maxRawScore += Number(question.points || 0)
    let score = 0
    let isCorrect = null
    let pending = false
    let correctAnswer = key?.correct || ''

    if (key?.kind === 'case') {
      const caseAnswers = answer?.answerPayload?.caseAnswers || {}
      let caseScore = 0
      let allCorrect = true
      const correctParts = []
      for (const child of question.metadata?.caseSubquestions || []) {
        const childKey = key.children?.[child.id]
        const result = scoreByKey(childKey, caseAnswers[child.id], null, Number(child.points || 0))
        caseScore += result.score
        if (result.isCorrect !== true) allCorrect = false
        if (childKey?.correct) correctParts.push(childKey.correct)
      }
      score = caseScore
      isCorrect = answerPresent(question, answer, null) ? allCorrect : null
      correctAnswer = correctParts.join(' · ')
    } else {
      const result = scoreByKey(key, answer, evidence, Number(question.points || 0))
      score = result.score
      isCorrect = result.isCorrect
      pending = result.pending
    }

    rawScore += score
    if (pending) pendingManualReviews += 1
    details.push({
      order: question.order,
      prompt: question.prompt,
      type: question.type,
      studentAnswer: summarizeAnswer(question, answer, evidence) || 'Sin respuesta',
      correctAnswer: correctAnswer || null,
      isCorrect,
      score: Math.round(score * 100) / 100,
      maxScore: Number(question.points || 0),
      reviewStatus: pending ? 'pending' : 'not_required',
      teacherFeedback: pending ? 'En el sistema real esta respuesta quedaría pendiente de revisión manual por el docente.' : null,
    })
  }

  const finalGrade = pendingManualReviews > 0 ? null : Math.round((rawScore / Math.max(maxRawScore, 1)) * GRADE_SCALE_MAX * 100) / 100
  return {
    visibility: 'correct_answers',
    embargoed: false,
    pendingManualReviews,
    rawScore: Math.round(rawScore * 100) / 100,
    maxRawScore,
    provisional: pendingManualReviews > 0,
    finalGrade,
    gradeScaleMax: GRADE_SCALE_MAX,
    passingGrade: PASSING_GRADE,
    details,
    answersEmbargoed: false,
    localDemo: true,
  }
}

function engineQuestions(state) {
  return demoQuestions.map((question) => ({
    ...clone(question),
    answer: clone(state.answers?.[question.id] || null),
    evidence: clone(state.evidence?.[question.id] || null),
  }))
}

function createAppError(code, message, details = null) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

export function isLocalDemoCode(accessCode) {
  return String(accessCode || '').trim().toUpperCase() === DEMO_CODE
}

export function isLocalDemoSession(sessionToken) {
  return String(sessionToken || '').startsWith(SESSION_PREFIX)
}

export function getLocalDemoCode() {
  return DEMO_CODE
}

export async function demoValidateCode() {
  return { ok: true, exam: clone(demoExam), localDemo: true }
}

export async function demoValidateResultsCode() {
  const state = normalizeState()
  if (!state || !['submitted', 'time_expired'].includes(state.attempt?.status)) {
    throw createAppError('RESULT_NOT_FOUND', 'Todavía no existe un resultado DEMO local. Rinde y envía primero el examen de demostración.')
  }
  return { ok: true, exam: clone(demoExam), localDemo: true }
}

export async function demoPrepareAttempt(identity) {
  const existing = normalizeState()
  let state = existing
  if (!state || ['submitted', 'time_expired', 'cancelled'].includes(state.attempt?.status)) {
    state = newState(identity, Number(existing?.attempt?.number || 0) + 1)
  } else {
    state.student = {
      ...state.student,
      code: state.student.code || 'DEMO-LOCAL',
      firstName: String(identity?.firstName || state.student.firstName || 'Estudiante').trim() || 'Estudiante',
      lastName: String(identity?.lastName || state.student.lastName || '').trim(),
      email: String(identity?.email || state.student.email || '').trim() || null,
      section: String(identity?.section || state.student.section || 'Local').trim() || 'Local',
    }
    writeState(state)
  }
  return { ok: true, sessionToken: sessionTokenFor(state), resumed: existing?.attempt?.status === 'in_progress', ...attemptPayload(state) }
}

export async function demoAccessResults(identity) {
  const state = normalizeState()
  if (!state || !['submitted', 'time_expired'].includes(state.attempt?.status)) {
    throw createAppError('RESULT_NOT_FOUND', 'No existe un resultado DEMO local disponible.')
  }
  const firstMatches = String(identity?.firstName || '').trim().toLocaleLowerCase('es') === String(state.student.firstName || '').trim().toLocaleLowerCase('es')
  const lastMatches = String(identity?.lastName || '').trim().toLocaleLowerCase('es') === String(state.student.lastName || '').trim().toLocaleLowerCase('es')
  if (!firstMatches || !lastMatches) {
    throw createAppError('RESULT_NOT_FOUND', 'Los apellidos y nombres no coinciden con el último intento DEMO guardado en este navegador.')
  }
  return { ok: true, sessionToken: sessionTokenFor(state), ...attemptPayload(state), grading: clone(state.grading || gradeState(state)), resultAccess: true }
}

export async function demoGetStatus(sessionToken) {
  const state = requireDemoSession(sessionToken)
  return { ok: true, ...attemptPayload(state), grading: ['submitted', 'time_expired'].includes(state.attempt.status) ? clone(state.grading || gradeState(state)) : null }
}

export async function demoStartAttempt(sessionToken) {
  const state = requireDemoSession(sessionToken)
  if (['submitted', 'time_expired', 'cancelled'].includes(state.attempt.status)) throw createAppError('ATTEMPT_CLOSED', 'Este intento DEMO ya está cerrado.')
  if (state.attempt.status !== 'in_progress') {
    const started = new Date()
    state.attempt.status = 'in_progress'
    state.attempt.startedAt = started.toISOString()
    state.attempt.deadlineAt = new Date(started.getTime() + DURATION_MINUTES * 60 * 1000).toISOString()
    writeState(state)
  }
  return { ok: true, ...attemptPayload(state), generation: { localDemo: true }, serverNow: new Date().toISOString() }
}

export async function demoLoadEngine(sessionToken) {
  const state = requireDemoSession(sessionToken)
  if (state.attempt.status === 'created') throw createAppError('ATTEMPT_NOT_STARTED', 'El intento DEMO todavía no ha comenzado.')
  return {
    ok: true,
    ...attemptPayload(state),
    questions: engineQuestions(state),
    runtime: {
      serverNow: new Date().toISOString(),
      currentOrder: Number(state.attempt.currentOrder || 1),
      maxReachedOrder: Number(state.attempt.maxReachedOrder || 1),
      totalQuestions: demoQuestions.length,
      navigation: 'sequential',
      allowBacktrack: false,
      autoSubmitOnTimeout: true,
      security: { ...clone(demoExam.security), incidentCount: Array.isArray(state.incidents) ? state.incidents.length : 0 },
    },
  }
}

export async function demoSaveAnswer(sessionToken, raw) {
  const state = requireDemoSession(sessionToken)
  if (state.attempt.status !== 'in_progress') throw createAppError('ATTEMPT_CLOSED', 'El intento DEMO ya no admite cambios.')
  const question = demoQuestions.find((item) => item.id === raw?.attemptQuestionId)
  if (!question) throw createAppError('QUESTION_NOT_FOUND', 'La pregunta DEMO no existe.')
  const current = state.answers?.[question.id]
  const revision = Math.max(0, Number(raw?.clientRevision || 0))
  if (current && Number(current.clientRevision || 0) > revision) {
    return { ok: true, ...attemptPayload(state), save: { ignoredAsStale: true, clientRevision: current.clientRevision, lastSavedAt: current.lastSavedAt, isAnswered: answerPresent(question, current, state.evidence?.[question.id]), serverNow: new Date().toISOString() } }
  }
  const answer = {
    answerText: raw?.answerText ?? '',
    answerNumeric: raw?.answerNumeric ?? '',
    selectedOptionIds: Array.isArray(raw?.selectedOptionIds) ? raw.selectedOptionIds : [],
    answerPayload: raw?.answerPayload && typeof raw.answerPayload === 'object' ? raw.answerPayload : {},
    clientRevision: revision,
    lastSavedAt: new Date().toISOString(),
  }
  state.answers[question.id] = answer
  writeState(state)
  return { ok: true, ...attemptPayload(state), save: { ignoredAsStale: false, clientRevision: revision, lastSavedAt: answer.lastSavedAt, isAnswered: answerPresent(question, answer, state.evidence?.[question.id]), serverNow: new Date().toISOString() } }
}

export async function demoRecoverTimedOutAnswers(sessionToken, entries) {
  const state = requireDemoSession(sessionToken)
  const results = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const question = demoQuestions.find((item) => item.id === entry?.attemptQuestionId)
    if (!question) continue
    const current = state.answers?.[question.id]
    const revision = Math.max(0, Number(entry?.clientRevision || 0))
    if (!current || revision >= Number(current.clientRevision || 0)) {
      state.answers[question.id] = {
        answerText: entry?.answerText ?? '', answerNumeric: entry?.answerNumeric ?? '',
        selectedOptionIds: Array.isArray(entry?.selectedOptionIds) ? entry.selectedOptionIds : [],
        answerPayload: entry?.answerPayload && typeof entry.answerPayload === 'object' ? entry.answerPayload : {},
        clientRevision: revision, lastSavedAt: new Date().toISOString(),
      }
    }
    results.push({ attemptQuestionId: question.id, accepted: true, clientRevision: revision, lastSavedAt: new Date().toISOString() })
  }
  if (state.attempt.status === 'in_progress' && state.attempt.deadlineAt && Date.now() >= new Date(state.attempt.deadlineAt).getTime()) {
    state.attempt.status = 'time_expired'
    state.attempt.submittedAt = state.attempt.deadlineAt
  }
  if (['submitted', 'time_expired'].includes(state.attempt.status)) state.grading = gradeState(state)
  writeState(state)
  return { ok: true, ...attemptPayload(state), recovery: { acceptedCount: results.length, rejectedCount: 0, results, serverNow: new Date().toISOString() }, grading: clone(state.grading) }
}

export async function demoNavigate(sessionToken, targetOrder) {
  const state = requireDemoSession(sessionToken)
  const current = Number(state.attempt.currentOrder || 1)
  const maxReached = Number(state.attempt.maxReachedOrder || 1)
  const target = Math.min(Math.max(Number(targetOrder || 1), 1), demoQuestions.length)
  if (target < current) throw createAppError('BACKTRACK_NOT_ALLOWED', 'El modo DEMO de seguridad no permite volver a preguntas anteriores.')
  if (target > maxReached + 1) throw createAppError('NAVIGATION_NOT_ALLOWED', 'Avanza las preguntas en orden.')
  state.attempt.currentOrder = target
  state.attempt.maxReachedOrder = Math.max(maxReached, target)
  writeState(state)
  return { ok: true, ...attemptPayload(state), navigation: { currentOrder: target, maxReachedOrder: state.attempt.maxReachedOrder, totalQuestions: demoQuestions.length }, serverNow: new Date().toISOString() }
}

export async function demoPing(sessionToken) {
  const state = requireDemoSession(sessionToken)
  return { ok: true, ...attemptPayload(state), runtime: { serverNow: new Date().toISOString(), currentOrder: state.attempt.currentOrder, maxReachedOrder: state.attempt.maxReachedOrder, totalQuestions: demoQuestions.length }, serverNow: new Date().toISOString() }
}

export async function demoSubmit(sessionToken, reason = 'STUDENT_SUBMITTED') {
  const state = requireDemoSession(sessionToken)
  if (['submitted', 'time_expired'].includes(state.attempt.status)) return { ok: true, ...attemptPayload(state), alreadyClosed: true, grading: clone(state.grading || gradeState(state)) }
  if (state.attempt.status !== 'in_progress') throw createAppError('ATTEMPT_NOT_IN_PROGRESS', 'El intento DEMO no está en curso.')
  const deadlinePassed = Boolean(state.attempt.deadlineAt && Date.now() >= new Date(state.attempt.deadlineAt).getTime())
  if (reason === 'TIME_EXPIRED' && !deadlinePassed) throw createAppError('TIME_NOT_EXPIRED', 'El tiempo DEMO todavía no ha terminado.', { serverNow: new Date().toISOString() })
  state.attempt.status = deadlinePassed || reason === 'TIME_EXPIRED' ? 'time_expired' : 'submitted'
  state.attempt.submittedAt = new Date().toISOString()
  state.grading = gradeState(state)
  writeState(state)
  return { ok: true, ...attemptPayload(state), alreadyClosed: false, grading: clone(state.grading) }
}

export async function demoPrepareEvidence(sessionToken, file) {
  const state = requireDemoSession(sessionToken)
  if (state.attempt.status !== 'in_progress') throw createAppError('ATTEMPT_CLOSED', 'El intento DEMO ya no admite evidencias.')
  const question = demoQuestions.find((item) => item.id === file?.attemptQuestionId)
  if (!question || !['calculation_evidence', 'attachment'].includes(question.type)) throw createAppError('EVIDENCE_NOT_ALLOWED', 'Esta pregunta DEMO no admite evidencia.')
  const id = `demo-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  state.pendingUploads[id] = {
    id, questionId: question.id, name: String(file?.name || 'archivo'), mimeType: String(file?.mimeType || 'application/octet-stream'), sizeBytes: Number(file?.sizeBytes || 0), dataUrl: null,
  }
  writeState(state)
  return { ok: true, ...attemptPayload(state), upload: { id, bucket: 'local-demo', path: id, token: 'local-demo' }, serverNow: new Date().toISOString() }
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file || !String(file.type || '').startsWith('image/') || Number(file.size || 0) > 180_000) return resolve(null)
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export async function demoUploadEvidence(upload, file) {
  const state = normalizeState()
  const pending = state?.pendingUploads?.[upload?.id]
  if (!state || !pending) throw createAppError('UPLOAD_NOT_FOUND', 'La carga DEMO ya no está disponible.')
  pending.dataUrl = await fileToDataUrl(file)
  writeState(state)
  return { path: upload.path, localDemo: true }
}

export async function demoFinalizeEvidence(sessionToken, uploadId) {
  const state = requireDemoSession(sessionToken)
  const pending = state.pendingUploads?.[uploadId]
  if (!pending) throw createAppError('UPLOAD_NOT_FOUND', 'No se encontró la evidencia DEMO preparada.')
  const evidence = {
    id: `demo-evidence-${pending.questionId}`,
    name: pending.name,
    mimeType: pending.mimeType,
    sizeBytes: pending.sizeBytes,
    uploadedAt: new Date().toISOString(),
    previewUrl: pending.dataUrl || null,
    localDemo: true,
  }
  state.evidence[pending.questionId] = evidence
  delete state.pendingUploads[uploadId]
  writeState(state)
  const question = demoQuestions.find((item) => item.id === pending.questionId)
  return { ok: true, ...attemptPayload(state), evidence: clone(evidence), isAnswered: answerPresent(question, state.answers?.[pending.questionId], evidence), serverNow: new Date().toISOString() }
}

export async function demoDeleteEvidence(sessionToken, evidenceId) {
  const state = requireDemoSession(sessionToken)
  const entry = Object.entries(state.evidence || {}).find(([, value]) => value?.id === evidenceId)
  if (entry) delete state.evidence[entry[0]]
  writeState(state)
  return { ok: true, ...attemptPayload(state), evidenceId, isAnswered: false, serverNow: new Date().toISOString() }
}

export async function demoRecordSecurityEvent(sessionToken, event) {
  const state = requireDemoSession(sessionToken)
  const item = {
    type: String(event?.type || 'SECURITY_EVENT').slice(0, 80),
    at: new Date().toISOString(),
    metadata: event?.metadata && typeof event.metadata === 'object' ? event.metadata : {},
  }
  state.incidents = Array.isArray(state.incidents) ? state.incidents : []
  state.incidents.push(item)
  if (state.incidents.length > 100) state.incidents = state.incidents.slice(-100)
  writeState(state)
  return { ok: true, incidentCount: state.incidents.length, event: item, serverNow: new Date().toISOString() }
}

export function resetLocalDemo() {
  window.localStorage.removeItem(STATE_KEY)
}
