import { saveQuestion } from './questionBankManagement'

export const IMPORT_TEMPLATE_XLSX = '/templates/plantilla_importacion_preguntas.xlsx'
export const IMPORT_TEMPLATE_CSV = '/templates/plantilla_importacion_preguntas.csv'
export const MAX_IMPORT_ROWS = 1000
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024

export const IMPORT_COLUMNS = Object.freeze([
  'ID', 'Curso', 'Unidad', 'Tema', 'Subtema', 'Dificultad', 'Tipo', 'Pregunta',
  'Alternativa_A', 'Alternativa_B', 'Alternativa_C', 'Alternativa_D',
  'Respuesta', 'Puntaje', 'Tolerancia', 'Retroalimentacion',
])

const TYPE_ALIASES = new Map([
  ['alternativa unica', 'single_choice'],
  ['opcion unica', 'single_choice'],
  ['single choice', 'single_choice'],
  ['single_choice', 'single_choice'],
  ['seleccion multiple', 'multiple_choice'],
  ['multiple choice', 'multiple_choice'],
  ['multiple_choice', 'multiple_choice'],
  ['verdadero falso', 'true_false'],
  ['verdadero/falso', 'true_false'],
  ['true false', 'true_false'],
  ['true_false', 'true_false'],
  ['respuesta corta', 'short_text'],
  ['short text', 'short_text'],
  ['short_text', 'short_text'],
  ['numerica', 'numeric'],
  ['respuesta numerica', 'numeric'],
  ['numeric', 'numeric'],
  ['desarrollo', 'essay'],
  ['ensayo', 'essay'],
  ['essay', 'essay'],
  ['imagen alternativas', 'image_single_choice'],
  ['imagen + alternativas', 'image_single_choice'],
  ['image_single_choice', 'image_single_choice'],
  ['imagen desarrollo', 'image_essay'],
  ['imagen + desarrollo', 'image_essay'],
  ['image_essay', 'image_essay'],
  ['calculo resultado', 'calculation'],
  ['calculo + resultado', 'calculation'],
  ['calculation', 'calculation'],
  ['calculo evidencia', 'calculation_evidence'],
  ['calculo + evidencia', 'calculation_evidence'],
  ['calculation_evidence', 'calculation_evidence'],
  ['caso practico', 'case_group'],
  ['case_group', 'case_group'],
  ['respuesta con archivo', 'attachment'],
  ['archivo adjunto', 'attachment'],
  ['attachment', 'attachment'],
])

const DIFFICULTY_ALIASES = new Map([
  ['basica', 'basic'], ['basic', 'basic'],
  ['intermedia', 'intermediate'], ['intermediate', 'intermediate'],
  ['avanzada', 'advanced'], ['advanced', 'advanced'],
])

const UNSUPPORTED_BULK_TYPES = new Set(['image_single_choice', 'image_essay', 'case_group'])
const OPTION_TYPES = new Set(['single_choice', 'multiple_choice'])
const NUMERIC_TYPES = new Set(['numeric', 'calculation', 'calculation_evidence'])

function normalizeText(value) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '')
}

function valueFor(row, canonical) {
  const wanted = normalizeHeader(canonical)
  const key = Object.keys(row).find((item) => normalizeHeader(item) === wanted)
  return key ? row[key] : ''
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  const text = String(value ?? '').trim().replace(/\s+/g, '').replace(',', '.')
  return text === '' ? NaN : Number(text)
}

function splitAnswers(value) {
  return String(value ?? '').split(/[|;]/).map((item) => item.trim()).filter(Boolean)
}

function expectedCourseValues(bank) {
  return [bank?.cursos?.name, bank?.cursos?.code].filter(Boolean).map(normalizeText)
}

function courseMatches(value, bank) {
  const normalized = normalizeText(value)
  return normalized && expectedCourseValues(bank).includes(normalized)
}

function parseType(value) {
  return TYPE_ALIASES.get(normalizeText(value)) || null
}

function parseDifficulty(value) {
  return DIFFICULTY_ALIASES.get(normalizeText(value)) || null
}

function parseTrueFalse(value) {
  const normalized = normalizeText(value)
  if (['verdadero', 'v', 'true', '1', 'si'].includes(normalized)) return true
  if (['falso', 'f', 'false', '0', 'no'].includes(normalized)) return false
  return null
}

function buildOptionQuestion(type, alternatives, answer, errors) {
  const options = ['A', 'B', 'C', 'D']
    .map((key, index) => ({ key, content: String(alternatives[index] ?? '').trim(), isCorrect: false }))
    .filter((option) => option.content)

  if (options.length < 2) errors.push('Las preguntas de alternativas requieren al menos las opciones A y B.')
  const available = new Set(options.map((option) => option.key))
  const keys = splitAnswers(answer).map((item) => item.toUpperCase())

  if (type === 'single_choice') {
    if (keys.length !== 1 || !available.has(keys[0])) errors.push('Respuesta debe contener exactamente una letra válida: A, B, C o D.')
  } else {
    if (keys.length < 1 || keys.some((key) => !available.has(key))) errors.push('Respuesta debe indicar una o más letras válidas separadas por |. Ej.: A|C.')
  }

  const correct = new Set(keys)
  return options.map((option) => ({ ...option, isCorrect: correct.has(option.key) }))
}

function existingImportIds(existingQuestions, bankId) {
  return new Set((existingQuestions || [])
    .filter((question) => question.bank_id === bankId && question.metadata?.importSourceId)
    .map((question) => normalizeText(question.metadata.importSourceId)))
}

export async function parseQuestionImportFile(file) {
  if (!file) throw new Error('Selecciona un archivo Excel o CSV.')
  if (Number(file.size || 0) <= 0 || Number(file.size || 0) > MAX_IMPORT_FILE_BYTES) {
    throw new Error('El archivo debe pesar más de 0 bytes y como máximo 10 MB.')
  }
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!['xlsx', 'xls', 'csv'].includes(extension)) throw new Error('Formato no permitido. Usa XLSX, XLS o CSV.')

  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) throw new Error('El archivo no contiene hojas con datos.')
  const sheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, blankrows: false })

  if (rows.length === 0) throw new Error('No se encontraron preguntas para importar.')
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`El archivo contiene ${rows.length} filas. El máximo por importación es ${MAX_IMPORT_ROWS}.`)

  const headers = Object.keys(rows[0] || {}).map(normalizeHeader)
  const missing = IMPORT_COLUMNS.filter((column) => !headers.includes(normalizeHeader(column)))
  if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.join(', ')}.`)

  return { rows, sheetName: firstSheetName, fileName: file.name }
}

export function validateQuestionImportRows(rawRows, { bank, existingQuestions = [] } = {}) {
  if (!bank) return { rows: [], validCount: 0, errorCount: 0, globalErrors: ['Selecciona un banco de destino.'] }

  const importedIds = existingImportIds(existingQuestions, bank.id)
  const fileIds = new Set()

  const rows = (rawRows || []).map((raw, index) => {
    const rowNumber = index + 2
    const errors = []
    const externalId = String(valueFor(raw, 'ID') ?? '').trim()
    const course = String(valueFor(raw, 'Curso') ?? '').trim()
    const type = parseType(valueFor(raw, 'Tipo'))
    const difficulty = parseDifficulty(valueFor(raw, 'Dificultad'))
    const prompt = String(valueFor(raw, 'Pregunta') ?? '').trim()
    const answer = valueFor(raw, 'Respuesta')
    const points = parseNumber(valueFor(raw, 'Puntaje'))
    const toleranceRaw = valueFor(raw, 'Tolerancia')
    const tolerance = String(toleranceRaw ?? '').trim() === '' ? '' : parseNumber(toleranceRaw)

    if (!externalId) errors.push('ID es obligatorio.')
    const normalizedId = normalizeText(externalId)
    if (externalId && fileIds.has(normalizedId)) errors.push(`ID duplicado dentro del archivo: ${externalId}.`)
    if (externalId && importedIds.has(normalizedId)) errors.push(`El ID ${externalId} ya fue importado previamente en este banco.`)
    if (externalId) fileIds.add(normalizedId)

    if (!course) errors.push('Curso es obligatorio.')
    else if (!courseMatches(course, bank)) errors.push(`Curso no coincide con el banco de destino (${bank.cursos?.name || 'curso desconocido'}).`)

    if (!type) errors.push('Tipo de pregunta no reconocido.')
    else if (UNSUPPORTED_BULK_TYPES.has(type)) errors.push('Este tipo requiere edición visual y no puede importarse desde la plantilla plana.')
    if (!difficulty) errors.push('Dificultad inválida. Usa Básica, Intermedia o Avanzada.')
    if (!prompt) errors.push('Pregunta es obligatoria.')
    if (Number.isNaN(points) || points < 0) errors.push('Puntaje debe ser un número mayor o igual a 0.')
    if (tolerance !== '' && (Number.isNaN(tolerance) || tolerance < 0)) errors.push('Tolerancia debe ser un número mayor o igual a 0.')

    const question = {
      bankId: bank.id,
      type: type || '',
      prompt,
      unit: String(valueFor(raw, 'Unidad') ?? '').trim(),
      topic: String(valueFor(raw, 'Tema') ?? '').trim(),
      subtopic: String(valueFor(raw, 'Subtema') ?? '').trim(),
      difficulty: difficulty || 'intermediate',
      points: Number.isNaN(points) ? 0 : points,
      explanation: String(valueFor(raw, 'Retroalimentacion') ?? '').trim(),
      numericTolerance: tolerance,
      isActive: true,
      metadata: { importSourceId: externalId, importSource: 'bulk-file', importRow: rowNumber },
    }

    if (type && OPTION_TYPES.has(type)) {
      const alternatives = ['Alternativa_A', 'Alternativa_B', 'Alternativa_C', 'Alternativa_D'].map((column) => valueFor(raw, column))
      question.options = buildOptionQuestion(type, alternatives, answer, errors)
    }

    if (type === 'true_false') {
      const parsed = parseTrueFalse(answer)
      if (parsed === null) errors.push('Respuesta debe ser VERDADERO o FALSO.')
      question.trueFalseValue = parsed === true
    }

    if (type === 'short_text') {
      question.acceptedAnswers = splitAnswers(answer)
      question.shortTextMode = 'case_insensitive'
      question.trimWhitespace = true
      if (!question.acceptedAnswers.length) errors.push('Respuesta corta requiere al menos una respuesta aceptable.')
    }

    if (type && NUMERIC_TYPES.has(type)) {
      const numericAnswer = parseNumber(answer)
      if (Number.isNaN(numericAnswer)) errors.push('Respuesta debe contener un valor numérico válido.')
      question.numericAnswer = Number.isNaN(numericAnswer) ? '' : numericAnswer
    }

    return {
      rowNumber,
      externalId,
      course,
      raw,
      question,
      errors,
      isValid: errors.length === 0,
    }
  })

  return {
    rows,
    validCount: rows.filter((row) => row.isValid).length,
    errorCount: rows.filter((row) => !row.isValid).length,
    globalErrors: [],
  }
}

export async function importValidatedQuestions(validatedRows, userId, onProgress) {
  const rows = (validatedRows || []).filter((row) => row.isValid)
  if (!rows.length) throw new Error('No hay filas válidas para importar.')
  const result = { imported: 0, total: rows.length, failures: [] }

  for (const [index, row] of rows.entries()) {
    try {
      await saveQuestion({
        ...row.question,
        metadata: {
          ...(row.question.metadata || {}),
          importedAt: new Date().toISOString(),
        },
      }, userId)
      result.imported += 1
      onProgress?.({ current: index + 1, total: rows.length, rowNumber: row.rowNumber })
    } catch (error) {
      result.failures.push({ rowNumber: row.rowNumber, externalId: row.externalId, message: error.message || 'Error desconocido' })
      break
    }
  }

  return result
}

export function downloadImportErrors(rows, sourceName = 'importacion') {
  const invalid = (rows || []).filter((row) => !row.isValid)
  if (!invalid.length) return
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const content = [
    ['Fila', 'ID', 'Errores'].map(escape).join(','),
    ...invalid.map((row) => [row.rowNumber, row.externalId, row.errors.join(' | ')].map(escape).join(',')),
  ].join('\r\n')
  const blob = new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${sourceName.replace(/\.[^.]+$/, '')}_errores.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
