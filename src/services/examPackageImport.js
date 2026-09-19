import { supabase } from './supabaseClient'
import { createTeacherCourse, createTeacherExam, listTeacherCourses } from './examManagement'
import { addFixedQuestion, addSelectionRule } from './examQuestionPlan'
import { createQuestionBank, listQuestionBanks, listQuestions, saveQuestion } from './questionBankManagement'
import { zonedLocalToIso } from '../utils/dateFormatting'

export const EXAM_PACKAGE_TEMPLATE_XLSX = '/templates/plantilla_importacion_examen_completo.xlsx'
export const EXAM_PACKAGE_SAMPLE_ZIP = '/templates/ejemplo_paquete_examen_imagenes.zip'
export const MAX_EXAM_PACKAGE_BYTES = 60 * 1024 * 1024
export const MAX_EXAM_PACKAGE_ROWS = 1000
export const MAX_EXAM_PACKAGE_IMAGES = 500
export const MAX_PACKAGE_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_EXTRACTED_PACKAGE_BYTES = 120 * 1024 * 1024

const IMAGE_MIME = Object.freeze({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })
const OPTION_TYPES = new Set(['single_choice', 'multiple_choice', 'image_single_choice'])
const NUMERIC_TYPES = new Set(['numeric', 'calculation', 'calculation_evidence'])
const IMAGE_TYPES = new Set(['image_single_choice', 'image_essay'])

const TYPE_ALIASES = new Map([
  ['alternativa unica', 'single_choice'], ['opcion unica', 'single_choice'], ['single choice', 'single_choice'], ['single_choice', 'single_choice'],
  ['seleccion multiple', 'multiple_choice'], ['multiple choice', 'multiple_choice'], ['multiple_choice', 'multiple_choice'],
  ['verdadero falso', 'true_false'], ['verdadero/falso', 'true_false'], ['true false', 'true_false'], ['true_false', 'true_false'],
  ['respuesta corta', 'short_text'], ['short text', 'short_text'], ['short_text', 'short_text'],
  ['numerica', 'numeric'], ['respuesta numerica', 'numeric'], ['numeric', 'numeric'],
  ['desarrollo', 'essay'], ['ensayo', 'essay'], ['essay', 'essay'],
  ['imagen alternativas', 'image_single_choice'], ['imagen + alternativas', 'image_single_choice'], ['image_single_choice', 'image_single_choice'],
  ['imagen desarrollo', 'image_essay'], ['imagen + desarrollo', 'image_essay'], ['image_essay', 'image_essay'],
  ['calculo resultado', 'calculation'], ['calculo + resultado', 'calculation'], ['calculation', 'calculation'],
  ['calculo evidencia', 'calculation_evidence'], ['calculo + evidencia', 'calculation_evidence'], ['calculation_evidence', 'calculation_evidence'],
  ['respuesta con archivo', 'attachment'], ['archivo adjunto', 'attachment'], ['attachment', 'attachment'],
  ['caso practico', 'case_group'], ['case_group', 'case_group'],
])

const DIFFICULTY_ALIASES = new Map([
  ['basica', 'basic'], ['basic', 'basic'], ['intermedia', 'intermediate'], ['intermediate', 'intermediate'], ['avanzada', 'advanced'], ['advanced', 'advanced'],
])

const CONFIG_ALIASES = Object.freeze({
  courseCode: ['curso_codigo', 'codigo_curso', 'course_code'],
  courseName: ['curso_nombre', 'nombre_curso', 'course_name'],
  academicPeriod: ['periodo_academico', 'periodo', 'academic_period'],
  section: ['seccion', 'section'],
  courseDescription: ['curso_descripcion', 'descripcion_curso'],
  defaultBank: ['banco_predeterminado', 'banco', 'default_bank'],
  examTitle: ['examen', 'titulo_examen', 'exam_title'],
  examDescription: ['descripcion_examen', 'exam_description'],
  instructions: ['instrucciones', 'instructions'],
  durationMinutes: ['duracion_minutos', 'duracion', 'duration_minutes'],
  targetQuestionCount: ['numero_preguntas', 'cantidad_preguntas', 'target_question_count'],
  gradeScaleMax: ['nota_maxima', 'escala_nota', 'grade_scale_max'],
  passingGrade: ['nota_aprobatoria', 'passing_grade'],
  maxAttempts: ['intentos', 'max_intentos', 'max_attempts'],
  randomizeQuestions: ['aleatorizar_preguntas', 'randomize_questions'],
  randomizeOptions: ['aleatorizar_alternativas', 'randomize_options'],
  navigation: ['navegacion', 'navigation'],
  allowBacktrack: ['permitir_retroceso', 'allow_backtrack'],
  accessCode: ['codigo_acceso', 'access_code'],
  start: ['inicio', 'fecha_inicio', 'starts_at'],
  end: ['cierre', 'fin', 'fecha_cierre', 'ends_at'],
})

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

function normalizeText(value) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function normalizeKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '')
}

function getRowValue(row, names) {
  const wanted = (Array.isArray(names) ? names : [names]).map(normalizeHeader)
  const key = Object.keys(row || {}).find((item) => wanted.includes(normalizeHeader(item)))
  return key ? row[key] : ''
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  const text = String(value ?? '').trim().replace(/\s+/g, '').replace(',', '.')
  return text === '' ? NaN : Number(text)
}

function parseInteger(value) {
  const number = parseNumber(value)
  return Number.isInteger(number) ? number : NaN
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  const normalized = normalizeText(value)
  if (['si', 'sí', 's', 'yes', 'true', '1', 'x'].includes(normalized)) return true
  if (['no', 'n', 'false', '0'].includes(normalized)) return false
  return fallback
}

function parseType(value) {
  return TYPE_ALIASES.get(normalizeText(value)) || null
}

function parseDifficulty(value) {
  return DIFFICULTY_ALIASES.get(normalizeText(value)) || null
}

function splitAnswers(value) {
  return String(value ?? '').split(/[|;]/).map((item) => item.trim()).filter(Boolean)
}

function parseTrueFalse(value) {
  const normalized = normalizeText(value)
  if (['verdadero', 'v', 'true', '1', 'si'].includes(normalized)) return true
  if (['falso', 'f', 'false', '0', 'no'].includes(normalized)) return false
  return null
}

function sanitizePackagePath(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!raw || raw.startsWith('/') || raw.split('/').some((segment) => segment === '..')) throw new Error(`Ruta insegura dentro del paquete: ${value}`)
  return raw
}

function basename(value) {
  return sanitizePackagePath(value).split('/').pop()
}

function extensionOf(value) {
  const name = String(value || '').toLowerCase()
  return name.includes('.') ? name.split('.').pop() : ''
}

function validImageMagic(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) return false
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value)
  if (mime === 'image/webp') return String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP'
  return false
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sheetByAliases(workbook, aliases) {
  const normalized = new Map(workbook.SheetNames.map((name) => [normalizeText(name), name]))
  for (const alias of aliases) {
    const exact = normalized.get(normalizeText(alias))
    if (exact) return workbook.Sheets[exact]
  }
  return null
}

function readConfigSheet(XLSX, sheet) {
  if (!sheet) return {}
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false })
  const config = {}
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue
    const key = normalizeKey(row[0])
    if (!key || key === 'campo') continue
    config[key] = row[1]
  }
  return config
}

function configValue(config, canonical) {
  const aliases = CONFIG_ALIASES[canonical] || [canonical]
  for (const alias of aliases) {
    const key = normalizeKey(alias)
    if (Object.prototype.hasOwnProperty.call(config, key)) return config[key]
  }
  return ''
}

function parseLocalDateTime(value, timezone, label, errors) {
  if (value == null || String(value).trim() === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  const text = String(value).trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))$/)
  if (!match) {
    errors.push(`${label} debe usar el formato AAAA-MM-DD HH:mm.`)
    return null
  }
  const iso = zonedLocalToIso(`${match[1]}-${match[2]}-${match[3]}`, `${match[4]}:${match[5]}`, timezone)
  if (!iso) errors.push(`${label} contiene una fecha u hora inválida para la zona ${timezone}.`)
  return iso
}

function buildOptions(type, row, answer, errors) {
  const options = ['A', 'B', 'C', 'D'].map((letter) => ({
    key: letter,
    content: String(getRowValue(row, [`Alternativa_${letter}`, `Alternativa ${letter}`]) ?? '').trim(),
    isCorrect: false,
  })).filter((option) => option.content)
  if (options.length < 2) errors.push('Las preguntas de alternativas requieren al menos A y B.')
  const available = new Set(options.map((option) => option.key))
  const keys = splitAnswers(answer).map((item) => item.toUpperCase())
  if (type === 'multiple_choice') {
    if (!keys.length || keys.some((key) => !available.has(key))) errors.push('Respuesta debe indicar una o más letras válidas separadas por |. Ej.: A|C.')
  } else if (keys.length !== 1 || !available.has(keys[0])) {
    errors.push('Respuesta debe contener exactamente una letra válida: A, B, C o D.')
  }
  const correct = new Set(keys)
  return options.map((option) => ({ ...option, isCorrect: correct.has(option.key) }))
}

function questionSignature(question) {
  const base = {
    type: question.type,
    prompt: normalizeText(question.prompt),
    unit: normalizeText(question.unit),
    topic: normalizeText(question.topic),
    subtopic: normalizeText(question.subtopic),
    difficulty: question.difficulty,
    points: Number(question.points || 0),
  }
  if (OPTION_TYPES.has(question.type)) base.options = (question.options || []).map((option) => [normalizeText(option.content), Boolean(option.isCorrect)])
  if (question.type === 'true_false') base.answer = Boolean(question.trueFalseValue)
  if (question.type === 'short_text') base.answer = (question.acceptedAnswers || []).map(normalizeText).sort()
  if (NUMERIC_TYPES.has(question.type)) base.answer = [Number(question.numericAnswer), question.numericTolerance === '' ? null : Number(question.numericTolerance)]
  return JSON.stringify(base)
}

function existingSignature(question) {
  const mapped = {
    type: question.type,
    prompt: question.prompt,
    unit: question.unit || '',
    topic: question.topic || '',
    subtopic: question.subtopic || '',
    difficulty: question.difficulty,
    points: Number(question.points || 0),
    options: (question.alternativas || []).sort((a, b) => a.position - b.position).map((option) => ({ content: option.content, isCorrect: option.is_correct })),
    trueFalseValue: Boolean(question.answer_key?.value),
    acceptedAnswers: question.answer_key?.answers || [],
    numericAnswer: question.answer_key?.value ?? '',
    numericTolerance: question.numeric_tolerance ?? '',
  }
  return questionSignature(mapped)
}

function findCourse(courses, code) {
  const wanted = normalizeText(code)
  return (courses || []).find((course) => normalizeText(course.code) === wanted) || null
}

function findBank(banks, courseId, name) {
  const wanted = normalizeText(name)
  return (banks || []).find((bank) => bank.course_id === courseId && normalizeText(bank.name) === wanted) || null
}

function imageLookup(mediaEntries, requested) {
  if (!requested) return { entry: null, error: null }
  let safe
  try { safe = sanitizePackagePath(requested) } catch (error) { return { entry: null, error: error.message } }
  const direct = mediaEntries.get(normalizeText(safe))
  if (direct) return { entry: direct, error: null }
  const targetBase = normalizeText(basename(safe))
  const byBase = [...mediaEntries.values()].filter((entry) => normalizeText(entry.basename) === targetBase)
  if (byBase.length === 1) return { entry: byBase[0], error: null }
  if (byBase.length > 1) return { entry: null, error: `Hay más de una imagen llamada ${basename(safe)}; usa la ruta completa en la columna Imagen.` }
  return { entry: null, error: `No se encontró la imagen ${requested} dentro del paquete.` }
}

async function readPackage(file) {
  if (!file) throw new Error('Selecciona un archivo XLSX, XLS o ZIP.')
  if (Number(file.size || 0) <= 0 || Number(file.size || 0) > MAX_EXAM_PACKAGE_BYTES) throw new Error('El paquete debe pesar entre 1 byte y 60 MB.')
  const extension = extensionOf(file.name)
  if (!['xlsx', 'xls', 'zip'].includes(extension)) throw new Error('Formato no permitido. Usa XLSX, XLS o ZIP.')
  const sourceBuffer = await file.arrayBuffer()
  const fingerprint = await sha256Hex(sourceBuffer)
  const mediaEntries = new Map()
  let workbookBuffer = sourceBuffer
  let workbookName = file.name

  if (extension === 'zip') {
    const JSZip = (await import('jszip')).default
    const archive = await JSZip.loadAsync(sourceBuffer)
    const files = Object.values(archive.files).filter((entry) => !entry.dir && !entry.name.startsWith('__MACOSX/'))
    if (files.length > MAX_EXAM_PACKAGE_ROWS + MAX_EXAM_PACKAGE_IMAGES + 20) throw new Error('El ZIP contiene demasiados archivos.')
    const workbooks = files.filter((entry) => ['xlsx', 'xls'].includes(extensionOf(entry.name)))
    if (workbooks.length !== 1) throw new Error('El ZIP debe contener exactamente un archivo Excel XLSX/XLS.')
    workbookName = basename(workbooks[0].name)
    const workbookBytes = await workbooks[0].async('uint8array')
    if (workbookBytes.byteLength > 10 * 1024 * 1024) throw new Error('El Excel del paquete supera 10 MB.')
    workbookBuffer = workbookBytes.buffer.slice(workbookBytes.byteOffset, workbookBytes.byteOffset + workbookBytes.byteLength)

    const imageFiles = files.filter((entry) => Object.prototype.hasOwnProperty.call(IMAGE_MIME, extensionOf(entry.name)))
    if (imageFiles.length > MAX_EXAM_PACKAGE_IMAGES) throw new Error(`El paquete supera el máximo de ${MAX_EXAM_PACKAGE_IMAGES} imágenes.`)
    let extractedBytes = workbookBytes.byteLength
    for (const entry of imageFiles) {
      const safeName = sanitizePackagePath(entry.name)
      const bytes = await entry.async('uint8array')
      extractedBytes += bytes.byteLength
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PACKAGE_IMAGE_BYTES) throw new Error(`La imagen ${safeName} debe pesar entre 1 byte y 10 MB.`)
      if (extractedBytes > MAX_EXTRACTED_PACKAGE_BYTES) throw new Error('El contenido descomprimido del paquete supera 120 MB.')
      const ext = extensionOf(safeName)
      const mime = IMAGE_MIME[ext]
      if (!validImageMagic(bytes, mime)) throw new Error(`El archivo ${safeName} no contiene una imagen ${ext.toUpperCase()} válida.`)
      mediaEntries.set(normalizeText(safeName), { path: safeName, basename: basename(safeName), bytes, mime })
    }
  }

  const XLSX = await import('xlsx')
  const workbook = XLSX.read(workbookBuffer, { type: 'array', cellDates: true })
  const configSheet = sheetByAliases(workbook, ['Configuracion', 'Configuración', 'Config'])
  const questionsSheet = sheetByAliases(workbook, ['Preguntas', 'Questions'])
  const rulesSheet = sheetByAliases(workbook, ['Reglas', 'Rules'])
  if (!configSheet) throw new Error('Falta la hoja Configuracion.')
  if (!questionsSheet) throw new Error('Falta la hoja Preguntas.')

  const configRaw = readConfigSheet(XLSX, configSheet)
  const questionRows = XLSX.utils.sheet_to_json(questionsSheet, { defval: '', raw: true, blankrows: false })
  const ruleRows = rulesSheet ? XLSX.utils.sheet_to_json(rulesSheet, { defval: '', raw: true, blankrows: false }) : []
  if (!questionRows.length) throw new Error('La hoja Preguntas no contiene filas.')
  if (questionRows.length > MAX_EXAM_PACKAGE_ROWS) throw new Error(`La hoja Preguntas supera ${MAX_EXAM_PACKAGE_ROWS} filas.`)
  return { sourceName: file.name, workbookName, fingerprint, configRaw, questionRows, ruleRows, mediaEntries }
}

async function findPreviousImport(fingerprint) {
  const client = requireClient()
  const { data, error } = await client.from('configuraciones_examen').select('exam_id, settings, examenes!inner(id, title, status, is_deleted)').eq('examenes.is_deleted', false)
  if (error) throw new Error(error.message || 'No se pudo comprobar si el paquete ya fue importado.')
  return (data || []).find((row) => row.settings?.import?.fingerprint === fingerprint) || null
}

export async function analyzeExamPackage(file, { timezone = 'America/Lima', gradeScaleMax = 20, passingGrade = 10.5 } = {}) {
  const parsed = await readPackage(file)
  const [courses, banks, existingQuestions, previousImport] = await Promise.all([
    listTeacherCourses(), listQuestionBanks(), listQuestions({ includeArchivedBanks: true }), findPreviousImport(parsed.fingerprint),
  ])
  const errors = []
  const warnings = []
  if (previousImport) errors.push(`Este mismo paquete ya fue importado como “${previousImport.examenes?.title || previousImport.exam_id}”.`)

  const courseCode = String(configValue(parsed.configRaw, 'courseCode') || '').trim()
  const courseName = String(configValue(parsed.configRaw, 'courseName') || '').trim()
  const academicPeriod = String(configValue(parsed.configRaw, 'academicPeriod') || '').trim()
  const section = String(configValue(parsed.configRaw, 'section') || '').trim()
  const defaultBank = String(configValue(parsed.configRaw, 'defaultBank') || '').trim()
  const examTitle = String(configValue(parsed.configRaw, 'examTitle') || '').trim()
  const durationMinutes = parseInteger(configValue(parsed.configRaw, 'durationMinutes'))
  const maxAttempts = parseInteger(configValue(parsed.configRaw, 'maxAttempts'))
  const configuredTarget = parseInteger(configValue(parsed.configRaw, 'targetQuestionCount'))
  const configuredScale = parseNumber(configValue(parsed.configRaw, 'gradeScaleMax'))
  const configuredPassing = parseNumber(configValue(parsed.configRaw, 'passingGrade'))
  const navigationRaw = normalizeText(configValue(parsed.configRaw, 'navigation'))
  const navigation = ['libre', 'free'].includes(navigationRaw) ? 'free' : ['secuencial', 'sequential'].includes(navigationRaw) ? 'sequential' : 'sequential'

  if (!courseCode) errors.push('Configuracion: Curso_Codigo es obligatorio para identificar el curso sin ambigüedad.')
  if (!courseName) errors.push('Configuracion: Curso_Nombre es obligatorio.')
  if (!examTitle) errors.push('Configuracion: Examen es obligatorio.')
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) errors.push('Configuracion: Duracion_Minutos debe ser un entero mayor que cero.')
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) errors.push('Configuracion: Intentos debe ser un entero mayor que cero.')

  const effectiveScale = Number.isFinite(configuredScale) ? configuredScale : Number(gradeScaleMax)
  const effectivePassing = Number.isFinite(configuredPassing) ? configuredPassing : Number(passingGrade)
  if (!(effectiveScale > 0)) errors.push('Nota_Maxima debe ser mayor que cero.')
  if (!(effectivePassing >= 0 && effectivePassing <= effectiveScale)) errors.push('Nota_Aprobatoria debe estar entre 0 y Nota_Maxima.')

  const startsAt = parseLocalDateTime(configValue(parsed.configRaw, 'start'), timezone, 'Inicio', errors)
  const endsAt = parseLocalDateTime(configValue(parsed.configRaw, 'end'), timezone, 'Cierre', errors)
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) errors.push('Cierre debe ser posterior a Inicio.')

  const existingCourse = courseCode ? findCourse(courses, courseCode) : null
  if (existingCourse && normalizeText(existingCourse.name) !== normalizeText(courseName)) {
    errors.push(`El código ${courseCode} ya pertenece al curso “${existingCourse.name}”, no a “${courseName}”.`)
  }
  if (existingCourse && academicPeriod && normalizeText(existingCourse.academic_period) !== normalizeText(academicPeriod)) {
    errors.push(`El código ${courseCode} ya existe en el periodo “${existingCourse.academic_period || 'sin periodo'}”, no en “${academicPeriod}”. Usa un código de curso distinto por periodo.`)
  }
  if (existingCourse && section && normalizeText(existingCourse.section) !== normalizeText(section)) {
    errors.push(`El código ${courseCode} ya existe en la sección “${existingCourse.section || 'sin sección'}”, no en “${section}”. Usa un código distinto por sección.`)
  }
  if (existingCourse && !existingCourse.is_active) errors.push(`El curso ${courseCode} está archivado. Restáuralo antes de importar.`)
  const coursePlan = existingCourse
    ? { action: 'reuse', id: existingCourse.id, code: existingCourse.code, name: existingCourse.name }
    : { action: 'create', id: null, code: courseCode, name: courseName }

  const bankPlans = new Map()
  const getBankPlan = (name) => {
    const cleanName = String(name || defaultBank).trim()
    if (!cleanName) return null
    const key = normalizeText(cleanName)
    if (bankPlans.has(key)) return bankPlans.get(key)
    const existing = existingCourse ? findBank(banks, existingCourse.id, cleanName) : null
    const plan = existing
      ? { action: existing.is_archived ? 'blocked' : 'reuse', id: existing.id, name: existing.name, existing }
      : { action: 'create', id: null, name: cleanName, existing: null }
    if (plan.action === 'blocked') errors.push(`El banco “${cleanName}” está archivado. Restáuralo antes de importar.`)
    bankPlans.set(key, plan)
    return plan
  }

  const fileIds = new Set()
  const referencedMedia = new Set()
  const questions = parsed.questionRows.map((raw, index) => {
    const rowNumber = index + 2
    const rowErrors = []
    const rowWarnings = []
    const externalId = String(getRowValue(raw, ['ID']) || '').trim()
    const bankName = String(getRowValue(raw, ['Banco']) || defaultBank).trim()
    const type = parseType(getRowValue(raw, ['Tipo']))
    const difficulty = parseDifficulty(getRowValue(raw, ['Dificultad']))
    const prompt = String(getRowValue(raw, ['Pregunta']) || '').trim()
    const points = parseNumber(getRowValue(raw, ['Puntaje']))
    const toleranceRaw = getRowValue(raw, ['Tolerancia'])
    const tolerance = String(toleranceRaw ?? '').trim() === '' ? '' : parseNumber(toleranceRaw)
    const answer = getRowValue(raw, ['Respuesta'])
    const imageName = String(getRowValue(raw, ['Imagen']) || '').trim()
    const includeFixed = parseBoolean(getRowValue(raw, ['Incluir_Examen', 'Incluir Examen', 'Fija']), true)
    const positionRaw = getRowValue(raw, ['Posicion', 'Posición'])
    const position = String(positionRaw ?? '').trim() === '' ? null : parseInteger(positionRaw)

    if (!externalId) rowErrors.push('ID es obligatorio.')
    const idKey = normalizeText(externalId)
    if (externalId && fileIds.has(idKey)) rowErrors.push(`ID duplicado dentro del paquete: ${externalId}.`)
    if (externalId) fileIds.add(idKey)
    if (!bankName) rowErrors.push('Banco es obligatorio o debe definirse Banco_Predeterminado.')
    const bankPlan = bankName ? getBankPlan(bankName) : null
    if (!type) rowErrors.push('Tipo no reconocido.')
    if (type === 'case_group') rowErrors.push('Caso práctico todavía requiere el editor visual; no se admite en importación completa v1.3.0.')
    if (!difficulty) rowErrors.push('Dificultad inválida. Usa Básica, Intermedia o Avanzada.')
    if (!prompt) rowErrors.push('Pregunta es obligatoria.')
    if (!Number.isFinite(points) || points < 0) rowErrors.push('Puntaje debe ser un número mayor o igual a 0.')
    if (tolerance !== '' && (!Number.isFinite(tolerance) || tolerance < 0)) rowErrors.push('Tolerancia debe ser un número mayor o igual a 0.')
    if (includeFixed && position != null && (!Number.isInteger(position) || position <= 0)) rowErrors.push('Posicion debe ser un entero mayor que cero.')

    const question = {
      bankId: bankPlan?.id || '', type: type || '', prompt,
      unit: String(getRowValue(raw, ['Unidad']) || '').trim(), topic: String(getRowValue(raw, ['Tema']) || '').trim(), subtopic: String(getRowValue(raw, ['Subtema']) || '').trim(),
      difficulty: difficulty || 'intermediate', points: Number.isFinite(points) ? points : 0,
      explanation: String(getRowValue(raw, ['Retroalimentacion', 'Retroalimentación']) || '').trim(), numericTolerance: tolerance,
      isActive: true, metadata: { importSourceId: externalId, importSource: 'exam-package-v1.3', importRow: rowNumber },
    }

    if (type && OPTION_TYPES.has(type)) question.options = buildOptions(type, raw, answer, rowErrors)
    if (type === 'true_false') {
      const value = parseTrueFalse(answer)
      if (value === null) rowErrors.push('Respuesta debe ser VERDADERO o FALSO.')
      question.trueFalseValue = value === true
    }
    if (type === 'short_text') {
      question.acceptedAnswers = splitAnswers(answer); question.shortTextMode = 'case_insensitive'; question.trimWhitespace = true
      if (!question.acceptedAnswers.length) rowErrors.push('Respuesta corta requiere al menos una respuesta aceptable.')
    }
    if (type && NUMERIC_TYPES.has(type)) {
      const numeric = parseNumber(answer)
      if (!Number.isFinite(numeric)) rowErrors.push('Respuesta debe contener un valor numérico válido.')
      question.numericAnswer = Number.isFinite(numeric) ? numeric : ''
      question.numericMode = tolerance === '' ? 'exact' : 'tolerance'
    }

    const existingCandidate = bankPlan?.action === 'reuse'
      ? existingQuestions.find((item) => item.bank_id === bankPlan.id && normalizeText(item.metadata?.importSourceId) === idKey) || null
      : null

    let mediaEntry = null
    if (IMAGE_TYPES.has(type)) {
      if (!imageName) {
        if (existingCandidate?.media_path || existingCandidate?.metadata?.demoMediaUrl) rowWarnings.push(`El ID ${externalId} ya tiene imagen: se conservará la existente.`)
        else rowErrors.push('Las preguntas con imagen nuevas requieren el nombre del archivo en la columna Imagen.')
      } else if (!parsed.mediaEntries.size) rowErrors.push('Para importar una imagen nueva debes usar un ZIP que incluya los archivos gráficos.')
      else {
        const lookup = imageLookup(parsed.mediaEntries, imageName)
        if (lookup.error) rowErrors.push(lookup.error)
        mediaEntry = lookup.entry
        if (mediaEntry) referencedMedia.add(normalizeText(mediaEntry.path))
      }
    } else if (imageName) {
      rowWarnings.push('La columna Imagen se ignorará porque el tipo seleccionado no es Imagen + alternativas/desarrollo.')
    }

    let existingQuestion = existingCandidate
    let action = 'create'
    if (existingQuestion) {
        if (!existingQuestion.is_active) rowErrors.push(`El ID ${externalId} ya existe en “${bankName}”, pero está archivado. Restáuralo o usa otro ID.`)
        else if (existingSignature(existingQuestion) !== questionSignature(question)) rowErrors.push(`El ID ${externalId} ya existe en “${bankName}”, pero su contenido es diferente. Usa otro ID o corrige el archivo.`)
        else {
          action = 'reuse'
          question.bankId = bankPlan.id
          if (IMAGE_TYPES.has(type)) {
            if (!existingQuestion.media_path && !existingQuestion.metadata?.demoMediaUrl) rowErrors.push(`El ID ${externalId} existe pero no tiene imagen asociada.`)
            else rowWarnings.push(`El ID ${externalId} ya existe: se reutilizará la pregunta y se conservará su imagen actual.`)
          }
        }
      }

    return { rowNumber, externalId, bankName, bankPlan, type, imageName, mediaEntry, includeFixed, position, action, existingQuestion, question, errors: rowErrors, warnings: rowWarnings, isValid: rowErrors.length === 0 }
  })

  const fixedRows = questions.filter((row) => row.includeFixed && row.isValid)
  const explicitPositions = new Map()
  fixedRows.forEach((row) => {
    if (row.position == null) return
    if (explicitPositions.has(row.position)) {
      row.errors.push(`Posicion ${row.position} está repetida con la fila ${explicitPositions.get(row.position)}.`)
      row.isValid = false
    } else explicitPositions.set(row.position, row.rowNumber)
  })

  const rules = parsed.ruleRows.map((raw, index) => {
    const rowNumber = index + 2
    const rowErrors = []
    const bankName = String(getRowValue(raw, ['Banco']) || defaultBank).trim()
    const quantity = parseInteger(getRowValue(raw, ['Cantidad']))
    const difficultyRaw = String(getRowValue(raw, ['Dificultad']) || '').trim()
    const typeRaw = String(getRowValue(raw, ['Tipo']) || '').trim()
    const difficulty = difficultyRaw ? parseDifficulty(difficultyRaw) : ''
    const questionType = typeRaw ? parseType(typeRaw) : ''
    const pointsRaw = getRowValue(raw, ['Puntaje', 'Puntaje_Override'])
    const pointsOverride = String(pointsRaw ?? '').trim() === '' ? '' : parseNumber(pointsRaw)
    const bankPlan = bankName ? getBankPlan(bankName) : null
    if (!bankName) rowErrors.push('Banco es obligatorio en cada regla o define Banco_Predeterminado.')
    if (!Number.isInteger(quantity) || quantity <= 0) rowErrors.push('Cantidad debe ser un entero mayor que cero.')
    if (difficultyRaw && !difficulty) rowErrors.push('Dificultad no reconocida.')
    if (typeRaw && (!questionType || questionType === 'case_group')) rowErrors.push('Tipo de pregunta no reconocido o no admitido en reglas importadas.')
    if (pointsOverride !== '' && (!Number.isFinite(pointsOverride) || pointsOverride < 0)) rowErrors.push('Puntaje debe ser mayor o igual a 0.')
    return {
      rowNumber, bankName, bankPlan, quantity: Number.isInteger(quantity) ? quantity : 0,
      unit: String(getRowValue(raw, ['Unidad']) || '').trim(), topic: String(getRowValue(raw, ['Tema']) || '').trim(), subtopic: String(getRowValue(raw, ['Subtema']) || '').trim(),
      difficulty: difficulty || '', questionType: questionType || '', pointsOverride,
      label: String(getRowValue(raw, ['Etiqueta']) || '').trim(), errors: rowErrors, isValid: rowErrors.length === 0,
    }
  })

  // Conservative candidate validation using existing active questions plus package rows.
  const descriptors = []
  existingQuestions.filter((item) => existingCourse && item.bancos_preguntas?.course_id === existingCourse.id && item.is_active && !item.bancos_preguntas?.is_archived).forEach((item) => descriptors.push({
    key: item.id, bankId: item.bank_id, bankName: item.bancos_preguntas?.name || '', unit: item.unit || '', topic: item.topic || '', subtopic: item.subtopic || '', difficulty: item.difficulty, type: item.type,
    externalId: item.metadata?.importSourceId || '',
  }))
  questions.filter((row) => row.isValid && row.action === 'create').forEach((row) => descriptors.push({
    key: `new:${row.externalId}`, bankId: row.bankPlan?.id || null, bankName: row.bankName, unit: row.question.unit, topic: row.question.topic, subtopic: row.question.subtopic, difficulty: row.question.difficulty, type: row.question.type, externalId: row.externalId,
  }))
  const fixedKeys = new Set(fixedRows.map((row) => row.action === 'reuse' ? row.existingQuestion?.id : `new:${row.externalId}`))
  rules.forEach((rule) => {
    if (!rule.isValid) return
    const count = descriptors.filter((item) => {
      if (fixedKeys.has(item.key)) return false
      const sameBank = rule.bankPlan?.id ? item.bankId === rule.bankPlan.id : normalizeText(item.bankName) === normalizeText(rule.bankName)
      if (!sameBank) return false
      if (rule.unit && item.unit !== rule.unit) return false
      if (rule.topic && item.topic !== rule.topic) return false
      if (rule.subtopic && item.subtopic !== rule.subtopic) return false
      if (rule.difficulty && item.difficulty !== rule.difficulty) return false
      if (rule.questionType && item.type !== rule.questionType) return false
      return true
    }).length
    rule.candidateCount = count
    if (count < rule.quantity) {
      rule.errors.push(`La regla solicita ${rule.quantity} preguntas, pero solo encuentra ${count} candidatas excluyendo las preguntas fijas.`)
      rule.isValid = false
    }
  })

  questions.filter((row) => row.errors.length).forEach((row) => errors.push(`Preguntas fila ${row.rowNumber}: ${row.errors.join(' ')}`))
  rules.filter((row) => row.errors.length).forEach((row) => errors.push(`Reglas fila ${row.rowNumber}: ${row.errors.join(' ')}`))
  questions.flatMap((row) => row.warnings.map((warning) => `Preguntas fila ${row.rowNumber}: ${warning}`)).forEach((warning) => warnings.push(warning))

  const unreferencedImages = [...parsed.mediaEntries.values()].filter((entry) => !referencedMedia.has(normalizeText(entry.path)))
  if (unreferencedImages.length) warnings.push(`${unreferencedImages.length} imagen${unreferencedImages.length === 1 ? '' : 'es'} del ZIP no ${unreferencedImages.length === 1 ? 'está' : 'están'} referenciada${unreferencedImages.length === 1 ? '' : 's'} y no se subirá${unreferencedImages.length === 1 ? '' : 'n'}.`)

  const validFixed = questions.filter((row) => row.includeFixed && row.isValid).length
  const validRandom = rules.filter((rule) => rule.isValid).reduce((sum, rule) => sum + rule.quantity, 0)
  const inferredTarget = validFixed + validRandom
  const targetQuestionCount = Number.isInteger(configuredTarget) && configuredTarget > 0 ? configuredTarget : inferredTarget
  if (!(Number.isInteger(configuredTarget) && configuredTarget > 0)) warnings.push(`Numero_Preguntas no fue válido; se usará el total inferido del plan: ${inferredTarget}.`)
  if (targetQuestionCount !== inferredTarget) errors.push(`Numero_Preguntas=${targetQuestionCount}, pero el plan suma ${inferredTarget} (${validFixed} fijas + ${validRandom} aleatorias).`)
  if (inferredTarget <= 0) errors.push('El plan del examen debe contener al menos una pregunta fija o una regla aleatoria.')

  return {
    sourceName: parsed.sourceName, workbookName: parsed.workbookName, fingerprint: parsed.fingerprint,
    course: { ...coursePlan, academicPeriod, section, description: String(configValue(parsed.configRaw, 'courseDescription') || '').trim() },
    banks: [...bankPlans.values()], questions, rules,
    exam: {
      title: examTitle, description: String(configValue(parsed.configRaw, 'examDescription') || '').trim(), instructions: String(configValue(parsed.configRaw, 'instructions') || '').trim(),
      durationMinutes, maxAttempts, targetQuestionCount, gradeScaleMax: effectiveScale, passingGrade: effectivePassing,
      randomizeQuestions: parseBoolean(configValue(parsed.configRaw, 'randomizeQuestions'), true), randomizeOptions: parseBoolean(configValue(parsed.configRaw, 'randomizeOptions'), true),
      navigation, allowBacktrack: navigation === 'free' ? true : parseBoolean(configValue(parsed.configRaw, 'allowBacktrack'), false),
      accessCode: String(configValue(parsed.configRaw, 'accessCode') || '').trim(), startsAt, endsAt,
    },
    stats: {
      totalRows: questions.length, createQuestions: questions.filter((row) => row.isValid && row.action === 'create').length,
      reuseQuestions: questions.filter((row) => row.isValid && row.action === 'reuse').length,
      imageQuestions: questions.filter((row) => row.isValid && IMAGE_TYPES.has(row.type)).length,
      fixedQuestions: validFixed, randomQuestions: validRandom, rules: rules.filter((row) => row.isValid).length,
      banksCreate: [...bankPlans.values()].filter((bank) => bank.action === 'create').length, banksReuse: [...bankPlans.values()].filter((bank) => bank.action === 'reuse').length,
    },
    errors, warnings, valid: errors.length === 0,
  }
}

function makeMediaFile(entry) {
  if (!entry) return null
  return new File([entry.bytes], entry.basename, { type: entry.mime, lastModified: Date.now() })
}

export async function executeExamPackageImport(analysis, userId, onProgress) {
  if (!analysis?.valid) throw new Error('El paquete contiene errores y no puede importarse.')
  if (!userId) throw new Error('No se pudo identificar al docente autenticado.')
  const progress = (stage, current, total, message) => onProgress?.({ stage, current, total, message })

  // Recheck idempotency immediately before writing.
  const duplicate = await findPreviousImport(analysis.fingerprint)
  if (duplicate) throw new Error(`Este paquete ya fue importado como “${duplicate.examenes?.title || duplicate.exam_id}”.`)

  progress('course', 0, 1, 'Preparando curso…')
  let courseId = analysis.course.id
  if (!courseId) {
    const currentCourses = await listTeacherCourses()
    const already = findCourse(currentCourses, analysis.course.code)
    if (already) {
      if (normalizeText(already.name) !== normalizeText(analysis.course.name)) throw new Error(`El código ${analysis.course.code} fue creado mientras validabas el paquete con otro nombre.`)
      if (analysis.course.academicPeriod && normalizeText(already.academic_period) !== normalizeText(analysis.course.academicPeriod)) throw new Error(`El código ${analysis.course.code} fue creado o modificado con otro periodo académico.`)
      if (analysis.course.section && normalizeText(already.section) !== normalizeText(analysis.course.section)) throw new Error(`El código ${analysis.course.code} fue creado o modificado con otra sección.`)
      if (!already.is_active) throw new Error(`El curso ${analysis.course.code} está archivado.`)
      courseId = already.id
    } else {
      const created = await createTeacherCourse({
        code: analysis.course.code, name: analysis.course.name, description: analysis.course.description,
        academicPeriod: analysis.course.academicPeriod, section: analysis.course.section,
      }, userId)
      courseId = created.id
    }
  }
  progress('course', 1, 1, 'Curso listo.')

  const bankIds = new Map()
  const currentBanks = await listQuestionBanks()
  let bankIndex = 0
  for (const bank of analysis.banks) {
    progress('banks', bankIndex, analysis.banks.length, `Preparando banco ${bank.name}…`)
    let bankId = bank.id
    if (!bankId) {
      const already = findBank(currentBanks, courseId, bank.name)
      if (already) {
        if (already.is_archived) throw new Error(`El banco “${bank.name}” está archivado.`)
        bankId = already.id
      } else {
        const created = await createQuestionBank({ courseId, name: bank.name, description: `Creado por importación completa · ${analysis.sourceName}` }, userId)
        bankId = created.id
        currentBanks.push({ ...created, course_id: courseId })
      }
    }
    bankIds.set(normalizeText(bank.name), bankId)
    bankIndex += 1
  }
  progress('banks', analysis.banks.length, analysis.banks.length, 'Bancos listos.')

  // Re-read existing questions now that concurrent imports may have changed the bank.
  const currentQuestions = await listQuestions({ includeArchivedBanks: true })
  const questionIds = new Map()
  const validRows = analysis.questions.filter((row) => row.isValid)
  for (const [index, row] of validRows.entries()) {
    progress('questions', index, validRows.length, `${row.action === 'reuse' ? 'Reutilizando' : 'Importando'} ${row.externalId}…`)
    const bankId = bankIds.get(normalizeText(row.bankName))
    if (!bankId) throw new Error(`No se resolvió el banco de la pregunta ${row.externalId}.`)
    const already = currentQuestions.find((item) => item.bank_id === bankId && normalizeText(item.metadata?.importSourceId) === normalizeText(row.externalId)) || null
    if (already) {
      const candidate = { ...row.question, bankId }
      if (existingSignature(already) !== questionSignature(candidate)) throw new Error(`La pregunta ${row.externalId} cambió desde la validación. Vuelve a analizar el paquete.`)
      questionIds.set(normalizeText(row.externalId), already.id)
      continue
    }
    const mediaFile = row.mediaEntry ? makeMediaFile(row.mediaEntry) : null
    const questionId = await saveQuestion({
      ...row.question, bankId, mediaFile,
      metadata: { ...(row.question.metadata || {}), importedAt: new Date().toISOString(), importPackageFingerprint: analysis.fingerprint },
    }, userId)
    questionIds.set(normalizeText(row.externalId), questionId)
  }
  progress('questions', validRows.length, validRows.length, 'Preguntas listas.')

  const config = {
    duration_minutes: analysis.exam.durationMinutes,
    max_attempts: analysis.exam.maxAttempts,
    target_question_count: analysis.exam.targetQuestionCount,
    randomize_questions: analysis.exam.randomizeQuestions,
    randomize_options: analysis.exam.randomizeOptions,
    navigation: analysis.exam.navigation,
    allow_backtrack: analysis.exam.navigation === 'free' ? true : analysis.exam.allowBacktrack,
    auto_submit_on_timeout: true,
    result_visibility: 'confirmation_only',
    show_results_after: null,
    require_student_code: false,
    require_first_name: true,
    require_last_name: true,
    require_email: false,
    require_section: false,
    restrict_to_enrolled_students: false,
    grade_scale_max: analysis.exam.gradeScaleMax,
    passing_grade: analysis.exam.passingGrade,
    settings: {
      import: { source: 'exam-package-v1.3', fingerprint: analysis.fingerprint, sourceName: analysis.sourceName, importedAt: new Date().toISOString() },
      security: {
        enabled: true, requireFullscreen: true, detectVisibility: true, detectBlur: true,
        blockClipboard: true, blockContextMenu: true, blockShortcuts: true, watermark: true,
        detectExtendedDisplay: true, requireSeb: false, maxIncidents: 3,
      },
    },
  }

  progress('exam', 0, 1, 'Creando examen en borrador…')
  const examId = await createTeacherExam({
    exam: {
      courseId, title: analysis.exam.title, description: analysis.exam.description, instructions: analysis.exam.instructions,
      startsAt: analysis.exam.startsAt, endsAt: analysis.exam.endsAt,
    },
    config,
    accessCode: analysis.exam.accessCode,
  })

  try {
    const fixedRows = analysis.questions.filter((row) => row.isValid && row.includeFixed)
    const usedPositions = new Set(fixedRows.map((row) => row.position).filter(Boolean))
    let nextPosition = 1
    for (const [index, row] of fixedRows.entries()) {
      while (usedPositions.has(nextPosition)) nextPosition += 1
      const position = row.position || nextPosition++
      const questionId = questionIds.get(normalizeText(row.externalId))
      if (!questionId) throw new Error(`No se resolvió la pregunta fija ${row.externalId}.`)
      progress('plan', index, fixedRows.length + analysis.rules.length, `Vinculando ${row.externalId}…`)
      await addFixedQuestion(examId, questionId, position)
    }
    for (const [ruleIndex, rule] of analysis.rules.filter((item) => item.isValid).entries()) {
      const bankId = bankIds.get(normalizeText(rule.bankName))
      progress('plan', fixedRows.length + ruleIndex, fixedRows.length + analysis.rules.length, `Creando regla ${ruleIndex + 1}…`)
      await addSelectionRule(examId, {
        bankId, unit: rule.unit, topic: rule.topic, subtopic: rule.subtopic, difficulty: rule.difficulty,
        questionType: rule.questionType, quantity: rule.quantity, ruleOrder: ruleIndex,
        pointsOverride: rule.pointsOverride, label: rule.label,
      })
    }
  } catch (error) {
    // The exam is intentionally left as draft if plan linking fails; no student can access it.
    throw new Error(`El examen fue creado como borrador (${examId}), pero no se completó su plan: ${error.message}`)
  }

  progress('done', 1, 1, 'Importación completa.')
  return {
    examId, courseId,
    createdQuestions: analysis.stats.createQuestions,
    reusedQuestions: analysis.stats.reuseQuestions,
    images: analysis.stats.imageQuestions,
    fixedQuestions: analysis.stats.fixedQuestions,
    randomQuestions: analysis.stats.randomQuestions,
  }
}
