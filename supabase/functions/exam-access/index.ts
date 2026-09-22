import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFor, isAllowedOrigin } from '../_shared/cors.ts'

type Json = Record<string, unknown>

class AppError extends Error {
  code: string
  status: number
  details?: Json

  constructor(code: string, message: string, status = 400, details?: Json) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

function json(payload: Json, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function getSecretKey() {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (modern) {
    try {
      const parsed = JSON.parse(modern)
      return parsed.default ?? Object.values(parsed)[0]
    } catch {
      // Legacy fallback below.
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const secretKey = getSecretKey()

if (!supabaseUrl || !secretKey) {
  throw new Error('Supabase server credentials are not available in the Edge Function environment.')
}

const admin = createClient(supabaseUrl, String(secretKey), {
  auth: { persistSession: false, autoRefreshToken: false },
})

function normalizeCode(value: unknown) {
  return String(value ?? '').trim().toUpperCase()
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase()
}

function assertMaxLength(value: string, max: number, code: string, message: string) {
  if (value.length > max) throw new AppError(code, message, 400)
}

function payloadByteLength(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? {})).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function validBasicEmail(value: string) {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function parseFlexibleNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const raw = normalizeText(value).replace(/\s+/g, '')
  if (!raw) return null
  // Accept either decimal comma or decimal point, but reject ambiguous mixed separators.
  if (raw.includes(',') && raw.includes('.')) return null
  const normalized = raw.includes(',') ? raw.replace(',', '.') : raw
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const EVIDENCE_BUCKET = 'student-evidence'
const DEFAULT_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024
const SUPPORTED_EVIDENCE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const EVIDENCE_QUESTION_TYPES = new Set(['calculation_evidence', 'attachment'])

function questionEvidenceMode(type: string, metadata: any = {}) {
  if (type === 'attachment' || type === 'calculation_evidence') return 'validated'
  const mode = normalizeText(metadata?.evidenceMode).toLowerCase()
  return ['informational', 'validated'].includes(mode) ? mode : 'none'
}

function questionAllowsEvidence(type: string, metadata: any = {}) {
  return EVIDENCE_QUESTION_TYPES.has(type) || questionEvidenceMode(type, metadata) !== 'none'
}
const OFFLINE_RECOVERY_GRACE_MS = 5 * 60 * 1000
const MAX_OFFLINE_RECOVERY_ANSWERS = 300
const MAX_SHORT_TEXT_CHARS = 5000
const MAX_LONG_TEXT_CHARS = 20000
const MAX_ANSWER_PAYLOAD_BYTES = 64 * 1024
const MAX_STUDENT_CODE_CHARS = 100
const MAX_NAME_CHARS = 150
const MAX_EMAIL_CHARS = 320
const MAX_SECTION_CHARS = 100

function normalizeSecuritySettings(raw: any) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: source.enabled !== false,
    requireFullscreen: source.requireFullscreen !== false,
    detectVisibility: source.detectVisibility !== false,
    detectBlur: source.detectBlur !== false,
    blockClipboard: source.blockClipboard !== false,
    blockContextMenu: source.blockContextMenu !== false,
    blockShortcuts: source.blockShortcuts !== false,
    watermark: source.watermark !== false,
    detectExtendedDisplay: source.detectExtendedDisplay !== false,
    requireSeb: source.requireSeb === true,
    maxIncidents: Math.min(20, Math.max(1, Number(source.maxIncidents || 3))),
  }
}


async function evidenceLimits() {
  const { data, error } = await admin
    .from('configuracion_global')
    .select('evidence_max_bytes,evidence_allowed_mime_types')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new AppError('GLOBAL_SETTINGS_UNAVAILABLE', 'No se pudo validar la configuración de evidencias.', 503)
  const rawMimes = Array.isArray(data?.evidence_allowed_mime_types) ? data.evidence_allowed_mime_types : [...SUPPORTED_EVIDENCE_MIME]
  const allowed = rawMimes.filter((mime: unknown) => SUPPORTED_EVIDENCE_MIME.has(String(mime)))
  if (!allowed.length) throw new AppError('EVIDENCE_CONFIG_INVALID', 'No hay formatos de evidencia habilitados.', 503)
  const configuredMax = Number(data?.evidence_max_bytes ?? DEFAULT_EVIDENCE_MAX_BYTES)
  const maxBytes = Number.isSafeInteger(configuredMax) && configuredMax >= 1024 * 1024 && configuredMax <= 50 * 1024 * 1024
    ? configuredMax
    : DEFAULT_EVIDENCE_MAX_BYTES
  return { maxBytes, allowedMime: new Set(allowed) }
}

function evidenceTypeLabel(allowedMime: Set<string>) {
  const labels: string[] = []
  if (allowedMime.has('image/jpeg')) labels.push('JPG/JPEG')
  if (allowedMime.has('image/png')) labels.push('PNG')
  if (allowedMime.has('image/webp')) labels.push('WEBP')
  if (allowedMime.has('application/pdf')) labels.push('PDF')
  return labels.join(', ')
}

function safeEvidenceFilename(value: unknown) {
  const raw = normalizeText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return (cleaned || 'evidencia').slice(-120)
}

function evidencePayloadFields(payload: any) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const fields: Record<string, unknown> = {}
  for (const key of ['evidenceCount', 'evidenceId', 'evidenceName', 'evidenceMimeType', 'evidenceUploadedAt']) {
    if (source[key] !== undefined) fields[key] = source[key]
  }
  return fields
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const RESULT_ACCESS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const RESULT_ACCESS_CODE_LENGTH = 12

function canonicalResultAccessCode(value: unknown) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function formatResultAccessCode(value: unknown) {
  const canonical = canonicalResultAccessCode(value)
  return canonical ? canonical.match(/.{1,4}/g)?.join('-') || canonical : ''
}

function randomResultAccessCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(RESULT_ACCESS_CODE_LENGTH))
  let raw = ''
  for (const byte of bytes) raw += RESULT_ACCESS_ALPHABET[byte % RESULT_ACCESS_ALPHABET.length]
  return formatResultAccessCode(raw)
}

// The persisted 64-char value remains server-side only. The public personal
// code is deterministically derived from it, so every request for the same
// attempt returns the same code and concurrent status/submit requests cannot
// leave the browser holding a code that does not correspond to the attempt.
function resultAccessCodeFromHash(value: unknown) {
  const hash = normalizeText(value).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hash)) return ''
  let raw = ''
  for (let index = 0; index < RESULT_ACCESS_CODE_LENGTH; index += 1) {
    const byte = Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16)
    raw += RESULT_ACCESS_ALPHABET[byte % RESULT_ACCESS_ALPHABET.length]
  }
  return formatResultAccessCode(raw)
}

async function ensureResultAccessCode(attempt: any) {
  if (!attempt?.id || !['submitted', 'time_expired'].includes(String(attempt.status))) return null
  if (attempt.result_access_code_hash) return resultAccessCodeFromHash(attempt.result_access_code_hash)

  for (let tries = 0; tries < 5; tries += 1) {
    const code = randomResultAccessCode()
    const hash = await sha256Hex(canonicalResultAccessCode(code))
    const issuedAt = new Date().toISOString()
    const updated = await admin.from('intentos').update({
      result_access_code_hash: hash,
      result_access_code_issued_at: issuedAt,
    }).eq('id', attempt.id).is('result_access_code_hash', null).select('id,result_access_code_hash,result_access_code_issued_at').maybeSingle()

    if (!updated.error && updated.data?.result_access_code_hash === hash) {
      attempt.result_access_code_hash = hash
      attempt.result_access_code_issued_at = issuedAt
      return resultAccessCodeFromHash(hash)
    }

    const reread = await admin.from('intentos').select('result_access_code_hash,result_access_code_issued_at').eq('id', attempt.id).maybeSingle()
    if (reread.data?.result_access_code_hash) {
      attempt.result_access_code_hash = reread.data.result_access_code_hash
      attempt.result_access_code_issued_at = reread.data.result_access_code_issued_at
      return resultAccessCodeFromHash(reread.data.result_access_code_hash)
    }
  }

  throw new AppError('RESULT_CODE_ISSUE_FAILED', 'No se pudo generar el código personal de resultados.', 500)
}

async function refreshCompletedGrade(attemptId: string) {
  const refreshed = await admin.rpc('refresh_attempt_grade_for_result', { p_attempt_id: attemptId })
  if (refreshed.error) throw new AppError('RESULT_GRADE_REFRESH_FAILED', 'No se pudo actualizar la calificación antes de mostrar los resultados.', 500)
  return refreshed.data
}

async function resultAccessCredential(rawCode: unknown) {
  const canonical = canonicalResultAccessCode(rawCode)
  if (!canonical) throw new AppError('RESULT_CODE_REQUIRED', 'Ingresa el código personal de resultados que aparece en tu PDF.', 400)
  if (canonical.length !== RESULT_ACCESS_CODE_LENGTH || !/^[A-HJ-NP-Z2-9]+$/.test(canonical)) {
    throw new AppError('RESULT_CODE_INVALID', 'El código personal de resultados no es válido.', 403)
  }
  return {
    canonical,
    formatted: formatResultAccessCode(canonical),
    legacyHash: await sha256Hex(canonical),
  }
}

// Repairs the short-lived 0034 race only from a valid attempt session. The
// public result-access route never performs this repair, so knowing a name and
// exam code is still insufficient to replace a student's personal credential.
async function reconcileResultAccessCodeFromSession(attempt: any, rawCode: unknown) {
  const canonical = canonicalResultAccessCode(rawCode)
  if (!canonical || canonical.length !== RESULT_ACCESS_CODE_LENGTH || !/^[A-HJ-NP-Z2-9]+$/.test(canonical)) {
    return ensureResultAccessCode(attempt)
  }

  const suppliedHash = await sha256Hex(canonical)
  const storedHash = normalizeText(attempt?.result_access_code_hash).toLowerCase()
  const derivedCode = canonicalResultAccessCode(resultAccessCodeFromHash(storedHash))

  if (storedHash && (storedHash === suppliedHash || derivedCode === canonical)) {
    return formatResultAccessCode(canonical)
  }

  const issuedAt = new Date().toISOString()
  const repaired = await admin
    .from('intentos')
    .update({
      result_access_code_hash: suppliedHash,
      result_access_code_issued_at: issuedAt,
    })
    .eq('id', attempt.id)
    .select('result_access_code_hash,result_access_code_issued_at')
    .maybeSingle()

  if (repaired.error || !repaired.data) {
    throw new AppError('RESULT_CODE_REPAIR_FAILED', 'No se pudo sincronizar el código personal de resultados.', 500)
  }

  attempt.result_access_code_hash = repaired.data.result_access_code_hash
  attempt.result_access_code_issued_at = repaired.data.result_access_code_issued_at
  await admin.from('logs').insert({
    student_id: attempt.student_id,
    exam_id: attempt.exam_id,
    attempt_id: attempt.id,
    event_type: 'RESULT_ACCESS_CODE_RECONCILED',
    metadata: { source: 'authenticated_attempt_session' },
  })
  return formatResultAccessCode(canonical)
}

function nowMs() {
  return Date.now()
}


function clientNetworkId(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || forwarded
    || 'unknown'
}

async function enforceRateLimit(request: Request, action: string, body: any) {
  const network = clientNetworkId(request)
  const sessionToken = normalizeText(body?.sessionToken)
  let scope = `ip:${network}`
  let limit = 300
  let windowSeconds = 600

  if (['validate', 'prepare', 'validate_results', 'result_access'].includes(action)) {
    // Classroom-friendly ceiling: enough for a large group behind one NAT,
    // while preventing unbounded access-code guessing from one network.
    scope = `access:${network}`
    limit = 300
    windowSeconds = 600
  } else if (sessionToken) {
    // Runtime requests are isolated per high-entropy attempt token so that a
    // whole class behind one IP does not throttle each other.
    scope = `session:${await sha256Hex(sessionToken)}`
    limit = 180
    windowSeconds = 60
  }

  const keyHash = await sha256Hex(`${String(secretKey)}:${action}:${scope}`)
  const { data, error } = await admin.rpc('consume_edge_rate_limit', {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) throw new AppError('RATE_LIMIT_CHECK_FAILED', 'No se pudo validar el límite de solicitudes.', 503)
  if (data !== true) throw new AppError('RATE_LIMITED', 'Se realizaron demasiadas solicitudes. Intenta nuevamente en unos minutos.', 429)
}

function validEvidenceExtension(filename: string, mimeType: string) {
  const extension = filename.toLowerCase().split('.').pop() || ''
  const allowed: Record<string, string[]> = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'application/pdf': ['pdf'],
  }
  return (allowed[mimeType] || []).includes(extension)
}

async function verifyEvidenceMagic(blob: Blob, mimeType: string) {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  const ascii = String.fromCharCode(...bytes)
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && ascii.slice(1, 4) === 'PNG'
  if (mimeType === 'image/webp') return bytes.length >= 12 && ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WEBP'
  if (mimeType === 'application/pdf') return ascii.startsWith('%PDF-')
  return false
}

function availabilityError(exam: any) {
  const now = nowMs()
  const starts = exam.starts_at ? new Date(exam.starts_at).getTime() : null
  const ends = exam.ends_at ? new Date(exam.ends_at).getTime() : null

  if (['draft', 'closed', 'archived'].includes(exam.status)) {
    return new AppError('EXAM_NOT_AVAILABLE', 'Este examen no está disponible.', 403)
  }
  if (exam.status === 'scheduled' && !starts) {
    return new AppError('EXAM_NOT_AVAILABLE', 'El examen está programado, pero todavía no tiene una hora de inicio válida.', 403)
  }
  if (starts && now < starts) {
    return new AppError('EXAM_NOT_STARTED', 'El examen todavía no está disponible.', 403, {
      startsAt: exam.starts_at,
      endsAt: exam.ends_at,
    })
  }
  if (ends && now >= ends) {
    return new AppError('EXAM_CLOSED', 'El periodo de acceso a este examen ya terminó.', 403, {
      startsAt: exam.starts_at,
      endsAt: exam.ends_at,
    })
  }
  return null
}

async function loadExam(accessCode: string, rawRecoveryAttemptId: unknown = null, allowClosedForResults = false) {
  const normalized = normalizeCode(accessCode)
  if (!normalized) throw new AppError('INVALID_CODE', 'Ingresa el código del examen.', 400)

  const lookup = await sha256Hex(normalized)
  const { data: exam, error } = await admin
    .from('examenes')
    .select('id, course_id, owner_user_id, title, description, instructions, starts_at, ends_at, status, is_deleted, access_code_hint, accept_new_attempts, force_closed_at')
    .eq('access_code_lookup', lookup)
    .eq('is_deleted', false)
    .maybeSingle()

  if (error) throw new AppError('SERVER_ERROR', 'No se pudo validar el examen.', 500)
  if (!exam) throw new AppError('INVALID_CODE', 'El código ingresado no corresponde a un examen disponible.', 404)

  const { data: verified, error: verifyError } = await admin.rpc('verify_exam_access_code', {
    p_exam_id: exam.id,
    p_access_code: normalized,
  })
  if (verifyError || verified !== true) {
    throw new AppError('INVALID_CODE', 'El código ingresado no corresponde a un examen disponible.', 404)
  }

  const availability = availabilityError(exam)
  if (availability) {
    const resultLookupAllowed = Boolean(
      allowClosedForResults
      && (availability.code === 'EXAM_CLOSED'
        || (availability.code === 'EXAM_NOT_AVAILABLE' && ['closed', 'archived'].includes(exam.status)))
    )
    const recoveryAttemptId = normalizeText(rawRecoveryAttemptId)
    let recoveryAllowed = false
    if (recoveryAttemptId && availability.code === 'EXAM_CLOSED') {
      const { data: recoveryAttempt } = await admin
        .from('intentos')
        .select('id, exam_id, status, offline_recovery_until')
        .eq('id', recoveryAttemptId)
        .eq('exam_id', exam.id)
        .maybeSingle()
      recoveryAllowed = Boolean(
        recoveryAttempt
        && recoveryAttempt.status === 'time_expired'
        && recoveryAttempt.offline_recovery_until
        && new Date(recoveryAttempt.offline_recovery_until).getTime() >= nowMs()
      )
    }
    if (!recoveryAllowed && !resultLookupAllowed) throw availability
  }

  const [{ data: config, error: configError }, { data: course }, fixed, rules] = await Promise.all([
    admin.from('configuraciones_examen').select('*').eq('exam_id', exam.id).single(),
    admin.from('cursos').select('id, name, code, section, academic_period, docente_id').eq('id', exam.course_id).maybeSingle(),
    admin.from('preguntas_examen').select('id', { count: 'exact', head: true }).eq('exam_id', exam.id),
    admin.from('reglas_seleccion_examen').select('quantity').eq('exam_id', exam.id),
  ])

  if (configError || !config) throw new AppError('EXAM_CONFIGURATION_ERROR', 'El examen no tiene una configuración válida.', 500)

  const randomCount = (rules.data ?? []).reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0)
  const questionCount = Number(fixed.count || 0) + randomCount

  return { exam, config, course, questionCount }
}

function publicExamPayload(ctx: any) {
  const { exam, config, course, questionCount } = ctx
  return {
    title: exam.title,
    description: exam.description,
    instructions: exam.instructions,
    startsAt: exam.starts_at,
    endsAt: exam.ends_at,
    course: course ? { name: course.name, code: course.code, section: course.section, academicPeriod: course.academic_period } : null,
    durationMinutes: config.duration_minutes,
    maxAttempts: config.max_attempts,
    questionCount,
    restrictToEnrolledStudents: config.restrict_to_enrolled_students,
    requiredFields: { studentCode: false, firstName: true, lastName: true, email: false, section: false },
    security: normalizeSecuritySettings(config.settings?.security),
    acceptNewAttempts: exam.accept_new_attempts !== false,
  }
}

function validateIdentity(config: any, identity: any) {
  const studentCode = normalizeText(identity?.studentCode)
  const firstName = normalizeText(identity?.firstName)
  const lastName = normalizeText(identity?.lastName)
  const email = normalizeEmail(identity?.email)
  const section = normalizeText(identity?.section)

  assertMaxLength(studentCode, MAX_STUDENT_CODE_CHARS, 'IDENTITY_TOO_LONG', 'El código universitario es demasiado largo.')
  assertMaxLength(firstName, MAX_NAME_CHARS, 'IDENTITY_TOO_LONG', 'Los nombres son demasiado largos.')
  assertMaxLength(lastName, MAX_NAME_CHARS, 'IDENTITY_TOO_LONG', 'Los apellidos son demasiado largos.')
  assertMaxLength(email, MAX_EMAIL_CHARS, 'IDENTITY_TOO_LONG', 'El correo es demasiado largo.')
  assertMaxLength(section, MAX_SECTION_CHARS, 'IDENTITY_TOO_LONG', 'La sección es demasiado larga.')
  if (!validBasicEmail(email)) throw new AppError('INVALID_EMAIL', 'Ingresa un correo con formato válido.', 400)

  const missing: string[] = []
  if (!firstName) missing.push('nombres')
  if (!lastName) missing.push('apellidos')

  if (missing.length) {
    throw new AppError('MISSING_IDENTITY_FIELDS', `Completa: ${missing.join(', ')}.`, 400)
  }
  return { studentCode: '', firstName, lastName, email: '', section: '' }
}

async function findEnrolledStudent(courseId: string, identity: any) {
  const { data, error } = await admin
    .from('matriculas')
    .select('student_id, status, estudiantes!inner(id, student_code, first_name, last_name, email, section, is_active)')
    .eq('course_id', courseId)
    .eq('status', 'active')

  if (error) throw new AppError('SERVER_ERROR', 'No se pudo verificar la matrícula del estudiante.', 500)

  const match = (data ?? []).find((row: any) => {
    const student = row.estudiantes
    if (!student?.is_active) return false
    const firstMatches = normalizeText(student.first_name).toLocaleLowerCase('es') === identity.firstName.toLocaleLowerCase('es')
    const lastMatches = normalizeText(student.last_name).toLocaleLowerCase('es') === identity.lastName.toLocaleLowerCase('es')
    return Boolean(firstMatches && lastMatches)
  })

  return match?.estudiantes ?? null
}

async function findOrCreateOpenStudent(ctx: any, identity: any) {
  const internalCode = `NAME-${(await sha256Hex(`${ctx.exam.id}|${identity.lastName.toLocaleLowerCase('es')}|${identity.firstName.toLocaleLowerCase('es')}`)).slice(0, 20).toUpperCase()}`

  const { data: candidates, error } = await admin
    .from('estudiantes')
    .select('id, student_code, first_name, last_name, email, section, is_active')
    .eq('student_code', internalCode)
    .limit(2)

  if (error) throw new AppError('SERVER_ERROR', 'No se pudo verificar al estudiante.', 500)

  const active = (candidates ?? []).filter((item: any) => item.is_active)
  if (active.length > 1) {
    throw new AppError('STUDENT_IDENTITY_CONFLICT', 'Existen registros duplicados para este código universitario. Comunícate con el docente.', 409)
  }

  const student = active[0] ?? null
  if (student) {
    const storedEmail = normalizeEmail(student.email)
    if (identity.email && storedEmail && storedEmail !== identity.email) {
      throw new AppError('IDENTITY_MISMATCH', 'El código universitario ya está asociado a otro correo. Verifica tus datos o comunícate con el docente.', 403)
    }
    return student
  }

  const payload = {
    student_code: internalCode,
    first_name: identity.firstName || 'No registrado',
    last_name: identity.lastName || 'No registrado',
    email: identity.email || null,
    section: identity.section || null,
    created_by_user_id: ctx.exam.owner_user_id,
    is_active: true,
  }

  const inserted = await admin.from('estudiantes').insert(payload).select('*').single()
  if (!inserted.error && inserted.data) return inserted.data

  // The case-insensitive unique student-code index is authoritative under concurrency.
  const retry = await admin
    .from('estudiantes')
    .select('id, student_code, first_name, last_name, email, section, is_active')
    .eq('student_code', internalCode)
    .limit(2)

  const retryActive = (retry.data ?? []).filter((item: any) => item.is_active)
  if (retryActive.length !== 1) throw new AppError('SERVER_ERROR', 'No se pudo registrar al estudiante.', 500)
  const recovered = retryActive[0]
  const storedEmail = normalizeEmail(recovered.email)
  if (identity.email && storedEmail && storedEmail !== identity.email) {
    throw new AppError('IDENTITY_MISMATCH', 'El código universitario ya está asociado a otro correo. Verifica tus datos o comunícate con el docente.', 403)
  }
  return recovered
}


async function findExistingOpenStudent(ctx: any, identity: any) {
  const internalCode = `NAME-${(await sha256Hex(`${ctx.exam.id}|${identity.lastName.toLocaleLowerCase('es')}|${identity.firstName.toLocaleLowerCase('es')}`)).slice(0, 20).toUpperCase()}`

  const { data: student, error } = await admin
    .from('estudiantes')
    .select('id, student_code, first_name, last_name, email, section, is_active')
    .eq('student_code', internalCode)
    .maybeSingle()
  if (error) throw new AppError('SERVER_ERROR', 'No se pudo verificar al estudiante.', 500)
  if (!student?.is_active) return null

  const storedEmail = normalizeEmail(student.email)
  if (identity.email && storedEmail && storedEmail !== identity.email) return null
  return student
}

async function accessCompletedResults(accessCode: string, rawIdentity: any, rawResultAccessCode: unknown, request: Request) {
  const ctx: any = await loadExam(accessCode, null, true)
  const identity = validateIdentity(ctx.config, rawIdentity)
  const student = ctx.config.restrict_to_enrolled_students
    ? await findEnrolledStudent(ctx.exam.course_id, identity)
    : await findExistingOpenStudent(ctx, identity)

  if (!student) throw new AppError('RESULT_NOT_FOUND', 'No se encontraron resultados asociados a los datos ingresados.', 404)

  const credential = await resultAccessCredential(rawResultAccessCode)
  const { data: attempts, error } = await admin
    .from('intentos')
    .select('*')
    .eq('exam_id', ctx.exam.id)
    .eq('student_id', student.id)
    .in('status', ['submitted', 'time_expired'])
    .order('attempt_number', { ascending: false })
    .limit(20)
  if (error) throw new AppError('SERVER_ERROR', 'No se pudieron consultar los resultados.', 500)

  // New codes are derived from the persisted 256-bit value. For compatibility,
  // codes issued before this fix also remain valid when their SHA-256 digest
  // matches the stored value.
  const matches = (attempts ?? []).filter((candidate: any) => {
    const storedHash = normalizeText(candidate.result_access_code_hash).toLowerCase()
    if (!storedHash) return false
    if (storedHash === credential.legacyHash) return true
    return canonicalResultAccessCode(resultAccessCodeFromHash(storedHash)) === credential.canonical
  })
  if (matches.length !== 1) throw new AppError('RESULT_CODE_INVALID', 'El código personal de resultados no es válido.', 403)

  const attempt = matches[0]
  ctx.student = student
  ctx.attempt = attempt
  const resultAccessCode = resultAccessCodeFromHash(attempt.result_access_code_hash) || credential.formatted
  await admin.from('intentos').update({ result_access_code_last_used_at: new Date().toISOString() }).eq('id', attempt.id)
  await refreshCompletedGrade(attempt.id)
  const runtimeConfig = frozenRuntimeConfig(ctx)

  const sessionToken = await createSession(attempt.id, new Date(nowMs() + 2 * 60 * 60 * 1000).toISOString())
  await admin.from('logs').insert({
    student_id: student.id,
    exam_id: ctx.exam.id,
    attempt_id: attempt.id,
    event_type: 'RESULT_ACCESS_CREATED',
    metadata: { userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null },
  })

  return {
    ctx,
    sessionToken,
    resultAccessCode,
    grading: await safeGradingSummary(ctx, { completedResultAccess: true }),
    reportDetails: await safeStudentExamCopyDetails(ctx),
  }
}

async function createSession(attemptId: string, expiresAt: string) {
  const sessionToken = randomToken()
  const tokenHash = await sha256Hex(sessionToken)
  const { error } = await admin.from('student_attempt_sessions').upsert({
    attempt_id: attemptId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'attempt_id' })

  if (error) throw new AppError('SERVER_ERROR', 'No se pudo crear la sesión del examen.', 500)
  return sessionToken
}

function provisionalExpiry(exam: any) {
  const base = exam.ends_at ? new Date(exam.ends_at).getTime() : nowMs() + 24 * 60 * 60 * 1000
  const safeBase = Math.max(base, nowMs())
  return new Date(safeBase + 2 * 60 * 60 * 1000).toISOString()
}

async function prepareAttempt(accessCode: string, rawIdentity: any, request: Request, rawRecoveryAttemptId: unknown = null) {
  const ctx = await loadExam(accessCode, rawRecoveryAttemptId)
  const identity = validateIdentity(ctx.config, rawIdentity)

  // 0032: validate the score plan before creating student/attempt history.
  // Published exams must have a deterministic point total equal to the configured exam maximum.
  const scoringPlanResult = await admin.rpc('get_exam_scoring_plan_summary', { p_exam_id: ctx.exam.id })
  if (scoringPlanResult.error || !scoringPlanResult.data) {
    throw new AppError('SCORING_PLAN_CHECK_FAILED', 'No se pudo validar la ponderación del examen.', 500)
  }
  const scoringPlan = scoringPlanResult.data as any
  const expectedExamMaximum = Number(ctx.config.settings?.grading?.finalGradeCap ?? ctx.config.grade_scale_max ?? 20)
  const configuredPointTotal = Number(scoringPlan.totalPoints ?? 0)
  if (scoringPlan.deterministic !== true || Math.abs(configuredPointTotal - expectedExamMaximum) > 0.001) {
    throw new AppError(
      'SCORING_PLAN_MISMATCH',
      scoringPlan.issue || `El docente debe ajustar la ponderación: las preguntas suman ${configuredPointTotal.toFixed(2)} puntos y la nota máxima del examen es ${expectedExamMaximum.toFixed(2)}.`,
      409,
    )
  }

  let student
  if (ctx.config.restrict_to_enrolled_students) {
    student = await findEnrolledStudent(ctx.exam.course_id, identity)
    if (!student) throw new AppError('STUDENT_NOT_AUTHORIZED', 'El estudiante no figura como autorizado para este examen.', 403)
  } else {
    student = await findOrCreateOpenStudent(ctx, identity)
  }

  const { data: attempts, error: attemptsError } = await admin
    .from('intentos')
    .select('*')
    .eq('exam_id', ctx.exam.id)
    .eq('student_id', student.id)
    .order('attempt_number', { ascending: true })

  if (attemptsError) throw new AppError('SERVER_ERROR', 'No se pudo comprobar los intentos anteriores.', 500)

  const ordered = attempts ?? []
  let resumable = [...ordered].reverse().find((item: any) => ['created', 'in_progress'].includes(item.status))

  if (resumable?.status === 'in_progress' && resumable.deadline_at && new Date(resumable.deadline_at).getTime() <= nowMs()) {
    const expiredAt = new Date().toISOString()
    const recoveryUntil = new Date(new Date(resumable.deadline_at).getTime() + OFFLINE_RECOVERY_GRACE_MS).toISOString()
    const expiredUpdate = await admin.from('intentos').update({
      status: 'time_expired',
      submitted_at: expiredAt,
      submission_reason: 'TIME_EXPIRED',
      last_activity_at: expiredAt,
      offline_recovery_until: resumable.offline_recovery_until || recoveryUntil,
    }).eq('id', resumable.id).eq('status', 'in_progress').select('*').maybeSingle()
    if (expiredUpdate.data) {
      Object.assign(resumable, expiredUpdate.data)
    } else {
      const rereadExpired = await admin.from('intentos').select('*').eq('id', resumable.id).maybeSingle()
      if (rereadExpired.data) Object.assign(resumable, rereadExpired.data)
      else resumable.status = 'time_expired'
    }
    resumable = undefined
  }

  const recoveryAttemptId = normalizeText(rawRecoveryAttemptId)
  if (recoveryAttemptId) {
    const recoverable = ordered.find((item: any) => item.id === recoveryAttemptId && item.status === 'time_expired')
    const recoveryUntil = recoverable?.offline_recovery_until ? new Date(recoverable.offline_recovery_until).getTime() : null
    if (recoverable && recoveryUntil && recoveryUntil >= nowMs()) {
      const sessionToken = await createSession(recoverable.id, new Date(recoveryUntil + 60 * 60 * 1000).toISOString())
      await admin.from('logs').insert({
        student_id: student.id,
        exam_id: ctx.exam.id,
        attempt_id: recoverable.id,
        event_type: 'ATTEMPT_RECOVERY_RESUMED',
        metadata: { recoveryUntil: recoverable.offline_recovery_until, userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null },
      })
      return { ctx, student, attempt: recoverable, sessionToken, resumed: true }
    }
  }

  if (resumable) {
    const expiry = resumable.deadline_at
      ? new Date(new Date(resumable.deadline_at).getTime() + 2 * 60 * 60 * 1000).toISOString()
      : provisionalExpiry(ctx.exam)
    const sessionToken = await createSession(resumable.id, expiry)

    await admin.from('logs').insert({
      student_id: student.id,
      exam_id: ctx.exam.id,
      attempt_id: resumable.id,
      event_type: 'ATTEMPT_RESUMED',
      metadata: { userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null },
    })

    return { ctx, student, attempt: resumable, sessionToken, resumed: true }
  }

  if (ctx.exam.accept_new_attempts === false) {
    throw new AppError('EXAM_ADMISSIONS_CLOSED', 'El docente cerró el ingreso de nuevos estudiantes a este examen.', 403)
  }

  const consumed = ordered.filter((item: any) => ['submitted', 'time_expired'].includes(item.status)).length
  if (consumed >= Number(ctx.config.max_attempts)) {
    throw new AppError('MAX_ATTEMPTS_REACHED', 'Ya registraste el número máximo de intentos permitido.', 403, {
      maxAttempts: ctx.config.max_attempts,
    })
  }

  const nextAttemptNumber = ordered.reduce((max: number, item: any) => Math.max(max, Number(item.attempt_number)), 0) + 1
  const institutionalGradeScaleMax = Number(ctx.config.grade_scale_max || 20)
  const finalGradeCap = Number(ctx.config.settings?.grading?.finalGradeCap ?? institutionalGradeScaleMax)
  const snapshot = {
    durationMinutes: ctx.config.duration_minutes,
    maxAttempts: ctx.config.max_attempts,
    randomizeQuestions: ctx.config.randomize_questions,
    randomizeOptions: ctx.config.randomize_options,
    navigation: ctx.config.navigation,
    allowBacktrack: ctx.config.allow_backtrack,
    autoSubmitOnTimeout: ctx.config.auto_submit_on_timeout,
    // From 0032 onward the effective grading scale equals the configured exam maximum.
    // Because the question points are validated to sum to this same value, raw points
    // and final grade are the same quantity (e.g. 10.71 points = final grade 10.71/15).
    gradeScaleMax: finalGradeCap,
    institutionalGradeScaleMax,
    finalGradeCap,
    gradingMode: 'direct_question_points',
    passingGrade: Number(ctx.config.passing_grade),
    resultVisibility: ctx.config.result_visibility,
    showResultsAfter: ctx.config.show_results_after,
    security: normalizeSecuritySettings(ctx.config.settings?.security),
  }

  let created = await admin.from('intentos').insert({
    exam_id: ctx.exam.id,
    student_id: student.id,
    attempt_number: nextAttemptNumber,
    status: 'created',
    frozen_exam_config: snapshot,
    session_metadata: {
      preparedAt: new Date().toISOString(),
      userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    },
  }).select('*').single()

  // A double click or two near-simultaneous requests can race on attempt_number.
  // The unique constraint is authoritative; if it wins elsewhere, recover that row.
  if (created.error || !created.data) {
    const recovery = await admin
      .from('intentos')
      .select('*')
      .eq('exam_id', ctx.exam.id)
      .eq('student_id', student.id)
      .in('status', ['created', 'in_progress'])
      .order('attempt_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!recovery.data) throw new AppError('SERVER_ERROR', 'No se pudo crear el intento del examen.', 500)
    created = { data: recovery.data, error: null }
  }

  const sessionToken = await createSession(created.data.id, provisionalExpiry(ctx.exam))
  await admin.from('logs').insert({
    student_id: student.id,
    exam_id: ctx.exam.id,
    attempt_id: created.data.id,
    event_type: 'ATTEMPT_PREPARED',
    metadata: { attemptNumber: nextAttemptNumber },
  })

  return { ctx, student, attempt: created.data, sessionToken, resumed: false }
}

async function resolveSession(sessionToken: unknown) {
  const raw = normalizeText(sessionToken)
  if (!raw) throw new AppError('SESSION_REQUIRED', 'No existe una sesión de examen válida.', 401)
  const tokenHash = await sha256Hex(raw)

  const { data: session, error } = await admin
    .from('student_attempt_sessions')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error || !session) throw new AppError('SESSION_INVALID', 'La sesión del examen no es válida.', 401)
  if (new Date(session.expires_at).getTime() <= nowMs()) {
    throw new AppError('SESSION_EXPIRED', 'La sesión del examen ha expirado.', 401)
  }

  const { data: attempt } = await admin.from('intentos').select('*').eq('id', session.attempt_id).single()
  if (!attempt) throw new AppError('SESSION_INVALID', 'No se encontró el intento asociado.', 401)

  if (attempt.status === 'in_progress' && attempt.deadline_at && new Date(attempt.deadline_at).getTime() <= nowMs()) {
    const expiredAt = new Date().toISOString()
    const recoveryUntil = new Date(new Date(attempt.deadline_at).getTime() + OFFLINE_RECOVERY_GRACE_MS).toISOString()
    const updated = await admin.from('intentos').update({
      status: 'time_expired',
      submitted_at: expiredAt,
      submission_reason: 'TIME_EXPIRED',
      last_activity_at: expiredAt,
      offline_recovery_until: attempt.offline_recovery_until || recoveryUntil,
    }).eq('id', attempt.id).eq('status', 'in_progress').select('*').single()
    if (updated.data) Object.assign(attempt, updated.data)
  }

  const [{ data: exam }, { data: config }, { data: student }] = await Promise.all([
    admin.from('examenes').select('*').eq('id', attempt.exam_id).single(),
    admin.from('configuraciones_examen').select('*').eq('exam_id', attempt.exam_id).single(),
    admin.from('estudiantes').select('id, student_code, first_name, last_name, email, section').eq('id', attempt.student_id).single(),
  ])

  if (!exam || !config || !student) throw new AppError('SERVER_ERROR', 'La sesión del examen está incompleta.', 500)
  const { data: course } = await admin.from('cursos').select('id, name, code, section, academic_period, docente_id').eq('id', exam.course_id).maybeSingle()
  let teacherName: string | null = null
  if (course?.docente_id) {
    const { data: teacher } = await admin.from('docentes').select('usuario_id').eq('id', course.docente_id).maybeSingle()
    if (teacher?.usuario_id) {
      const { data: teacherUser } = await admin.from('usuarios').select('display_name,first_name,last_name').eq('id', teacher.usuario_id).maybeSingle()
      teacherName = teacherUser?.display_name || [teacherUser?.first_name, teacherUser?.last_name].filter(Boolean).join(' ').trim() || null
    }
  }

  await admin.from('student_attempt_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id)
  return { session, attempt, exam, config, student, course, teacherName }
}

function frozenRuntimeConfig(ctx: any) {
  const frozen = ctx.attempt?.frozen_exam_config && typeof ctx.attempt.frozen_exam_config === 'object' ? ctx.attempt.frozen_exam_config : {}
  return {
    durationMinutes: Number(frozen.durationMinutes ?? ctx.config.duration_minutes),
    maxAttempts: Number(frozen.maxAttempts ?? ctx.config.max_attempts),
    randomizeQuestions: frozen.randomizeQuestions ?? ctx.config.randomize_questions,
    randomizeOptions: frozen.randomizeOptions ?? ctx.config.randomize_options,
    navigation: frozen.navigation ?? ctx.config.navigation,
    allowBacktrack: frozen.allowBacktrack ?? ctx.config.allow_backtrack,
    autoSubmitOnTimeout: frozen.autoSubmitOnTimeout ?? ctx.config.auto_submit_on_timeout,
    gradeScaleMax: Number(frozen.gradeScaleMax ?? ctx.config.grade_scale_max),
    finalGradeCap: Number(frozen.finalGradeCap ?? ctx.config.settings?.grading?.finalGradeCap ?? ctx.config.grade_scale_max),
    passingGrade: Number(frozen.passingGrade ?? ctx.config.passing_grade),
    resultVisibility: frozen.resultVisibility ?? ctx.config.result_visibility,
    showResultsAfter: frozen.showResultsAfter ?? ctx.config.show_results_after,
    security: normalizeSecuritySettings(frozen.security ?? ctx.config.settings?.security),
  }
}

function attemptPayload(ctx: any) {
  return {
    attempt: {
      id: ctx.attempt.id,
      number: ctx.attempt.attempt_number,
      status: ctx.attempt.status,
      startedAt: ctx.attempt.started_at,
      deadlineAt: ctx.attempt.deadline_at,
      submittedAt: ctx.attempt.submitted_at,
      offlineRecoveryUntil: ctx.attempt.offline_recovery_until,
      offlineRecoveryCompletedAt: ctx.attempt.offline_recovery_completed_at,
      offlineRecoveryCount: Number(ctx.attempt.offline_recovery_count || 0),
      submissionReason: ctx.attempt.submission_reason || null,
      extraTimeSeconds: Number(ctx.attempt.extra_time_seconds || 0),
      forcedSubmitAt: ctx.attempt.forced_submit_at || null,
      forcedSubmitReason: ctx.attempt.forced_submit_reason || null,
    },
    student: {
      code: ctx.student.student_code,
      firstName: ctx.student.first_name,
      lastName: ctx.student.last_name,
      email: ctx.student.email,
      section: ctx.student.section,
      displayName: [ctx.student.first_name, ctx.student.last_name].filter(Boolean).join(' ').trim(),
    },
    exam: {
      title: ctx.exam.title,
      description: ctx.exam.description,
      instructions: ctx.exam.instructions,
      startsAt: ctx.exam.starts_at,
      endsAt: ctx.exam.ends_at,
      durationMinutes: frozenRuntimeConfig(ctx).durationMinutes,
      maxAttempts: frozenRuntimeConfig(ctx).maxAttempts,
      security: frozenRuntimeConfig(ctx).security,
      course: ctx.course ? { name: ctx.course.name, code: ctx.course.code, section: ctx.course.section, academicPeriod: ctx.course.academic_period } : null,
      teacherName: ctx.teacherName || null,
    },
  }
}

async function startAttempt(sessionToken: unknown) {
  const ctx = await resolveSession(sessionToken)

  if (['submitted', 'time_expired', 'cancelled'].includes(ctx.attempt.status)) {
    throw new AppError('ATTEMPT_CLOSED', 'Este intento ya no puede iniciarse.', 409)
  }
  if (ctx.attempt.status === 'in_progress') return ctx

  const availability = availabilityError(ctx.exam)
  if (availability) throw availability

  // Prompt 07: generate and freeze the student's question set before the clock starts.
  // The RPC is idempotent, so re-start/reload cannot create a different set.
  const generation = await admin.rpc('generate_attempt_questions', { p_attempt_id: ctx.attempt.id })
  if (generation.error) {
    const raw = generation.error.message || 'No se pudo generar el examen.'
    if (raw.includes('INSUFFICIENT_QUESTIONS_FOR_RULE')) {
      throw new AppError('QUESTION_POOL_INSUFFICIENT', 'El banco no tiene suficientes preguntas para una de las reglas configuradas. Comunícate con el docente.', 409)
    }
    if (raw.includes('QUESTION_COUNT_MISMATCH')) {
      throw new AppError('QUESTION_PLAN_MISMATCH', 'La configuración de preguntas del examen no coincide con la cantidad objetivo.', 409)
    }
    throw new AppError('QUESTION_GENERATION_FAILED', 'No se pudo generar el conjunto de preguntas del intento.', 500)
  }

  // 0032: the frozen question points must add up exactly to the configured exam maximum.
  // This runtime check also protects exams that were already active before migration 0032.
  const pointsResult = await admin.from('intento_preguntas').select('points_snapshot').eq('attempt_id', ctx.attempt.id)
  if (pointsResult.error) throw new AppError('QUESTION_POINTS_CHECK_FAILED', 'No se pudo validar el puntaje total del examen.', 500)
  const frozenPointTotal = (pointsResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row.points_snapshot || 0), 0)
  const expectedPointTotal = Number(frozenRuntimeConfig(ctx).finalGradeCap || 20)
  if (Math.abs(frozenPointTotal - expectedPointTotal) > 0.001) {
    await admin.from('intento_preguntas').delete().eq('attempt_id', ctx.attempt.id)
    throw new AppError(
      'QUESTION_POINTS_MISMATCH',
      `El docente debe ajustar la ponderación: las preguntas suman ${frozenPointTotal.toFixed(2)} puntos y la nota máxima del examen es ${expectedPointTotal.toFixed(2)}.`,
      409,
    )
  }

  const startedAt = new Date()
  let deadlineMs = startedAt.getTime() + frozenRuntimeConfig(ctx).durationMinutes * 60 * 1000
  if (ctx.exam.ends_at) deadlineMs = Math.min(deadlineMs, new Date(ctx.exam.ends_at).getTime())
  if (deadlineMs <= startedAt.getTime()) throw new AppError('EXAM_CLOSED', 'El examen ya no admite nuevos inicios.', 403)

  const updated = await admin.from('intentos').update({
    status: 'in_progress',
    started_at: startedAt.toISOString(),
    deadline_at: new Date(deadlineMs).toISOString(),
    offline_recovery_until: new Date(deadlineMs + OFFLINE_RECOVERY_GRACE_MS).toISOString(),
    last_activity_at: startedAt.toISOString(),
    client_started_at: startedAt.toISOString(),
  }).eq('id', ctx.attempt.id).eq('status', 'created').select('*').single()

  if (updated.error || !updated.data) {
    const reread = await admin.from('intentos').select('*').eq('id', ctx.attempt.id).single()
    if (!reread.data || reread.data.status !== 'in_progress') {
      throw new AppError('ATTEMPT_START_FAILED', 'No se pudo iniciar el intento.', 409)
    }
    ctx.attempt = reread.data
  } else {
    ctx.attempt = updated.data
  }

  await admin.from('student_attempt_sessions').update({
    expires_at: new Date(deadlineMs + 2 * 60 * 60 * 1000).toISOString(),
    last_seen_at: new Date().toISOString(),
  }).eq('id', ctx.session.id)

  await admin.from('logs').insert({
    student_id: ctx.student.id,
    exam_id: ctx.exam.id,
    attempt_id: ctx.attempt.id,
    event_type: 'ATTEMPT_STARTED',
    metadata: { deadlineAt: ctx.attempt.deadline_at, generation: generation.data ?? null },
  })

  ;(ctx as any).generation = generation.data ?? null
  return ctx
}


function answerIsPresent(type: string, payload: any, optionsSnapshot: any[] = [], metadataSnapshot: any = {}) {
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) {
    return Array.isArray(payload.selectedOptionIds) && payload.selectedOptionIds.length > 0
  }
  if (type === 'true_false') return typeof payload.answerPayload?.value === 'boolean'
  if (['numeric', 'calculation'].includes(type)) {
    return payload.answerNumeric !== null && payload.answerNumeric !== undefined && String(payload.answerNumeric).trim() !== '' && parseFlexibleNumber(payload.answerNumeric) !== null
  }
  if (type === 'calculation_evidence') {
    const hasNumber = payload.answerNumeric !== null && payload.answerNumeric !== undefined && String(payload.answerNumeric).trim() !== '' && parseFlexibleNumber(payload.answerNumeric) !== null
    return hasNumber && Number(payload.answerPayload?.evidenceCount || 0) > 0
  }
  if (['short_text', 'essay', 'image_essay'].includes(type)) return normalizeText(payload.answerText).length > 0
  if (type === 'attachment') return Number(payload.answerPayload?.evidenceCount || 0) > 0
  if (type === 'case_group') {
    const children = Array.isArray(metadataSnapshot?.caseSubquestions) ? metadataSnapshot.caseSubquestions : []
    if (!children.length) return false
    const caseAnswers = payload.answerPayload?.caseAnswers ?? {}
    return children.every((child: any) => answerIsPresent(String(child.type), caseAnswers?.[child.id] ?? {}, child.options ?? [], child.metadata ?? {}))
  }
  return normalizeText(payload.answerText).length > 0 || Object.keys(payload.answerPayload ?? {}).length > 0
}

function sanitizeSelectedOptionIds(type: string, rawIds: unknown, optionsSnapshot: any[]) {
  if (!['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) return []
  const ids = Array.isArray(rawIds) ? rawIds.map((item) => normalizeText(item)).filter(Boolean) : []
  const allowed = new Set((Array.isArray(optionsSnapshot) ? optionsSnapshot : []).map((item: any) => String(item.id)))
  if (ids.some((id) => !allowed.has(id))) throw new AppError('INVALID_OPTION', 'La respuesta contiene una alternativa no válida.', 400)
  const unique = [...new Set(ids)]
  if (['single_choice', 'image_single_choice'].includes(type) && unique.length > 1) {
    throw new AppError('INVALID_OPTION_COUNT', 'Esta pregunta admite una sola alternativa.', 400)
  }
  return unique
}

function sanitizeCaseAnswers(raw: any, children: any[]) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const allowed = new Map((children ?? []).map((child: any) => [String(child.id), child]))
  const output: Record<string, unknown> = {}
  for (const [childId, answer] of Object.entries(input)) {
    const child: any = allowed.get(childId)
    if (!child) continue
    const value: any = answer && typeof answer === 'object' ? answer : {}
    const childType = String(child.type)
    if (['calculation_evidence', 'attachment', 'case_group'].includes(childType)) {
      throw new AppError('UNSUPPORTED_CASE_CHILD_TYPE', 'El caso contiene una subpregunta no compatible con la ejecución actual.', 409)
    }
    const selectedOptionIds = sanitizeSelectedOptionIds(childType, value.selectedOptionIds, child.options ?? [])
    const answerText = normalizeText(value.answerText)
    const maxText = childType === 'short_text' ? MAX_SHORT_TEXT_CHARS : MAX_LONG_TEXT_CHARS
    assertMaxLength(answerText, maxText, 'ANSWER_TOO_LONG', 'La respuesta excede el límite permitido.')
    let childPayload: Record<string, unknown> = {}
    if (childType === 'true_false' && typeof value.answerPayload?.value === 'boolean') {
      childPayload = { value: value.answerPayload.value }
    }
    output[childId] = {
      answerText: answerText || null,
      answerNumeric: parseFlexibleNumber(value.answerNumeric),
      selectedOptionIds,
      answerPayload: childPayload,
    }
  }
  if (payloadByteLength(output) > MAX_ANSWER_PAYLOAD_BYTES) {
    throw new AppError('ANSWER_PAYLOAD_TOO_LARGE', 'La respuesta estructurada excede el tamaño permitido.', 400)
  }
  return output
}

async function signedMediaUrl(bucket: unknown, path: unknown, ctx: any) {
  const bucketName = normalizeText(bucket)
  const objectPath = normalizeText(path)
  if (!bucketName || !objectPath) return null
  const now = nowMs()
  const deadline = ctx.attempt.deadline_at ? new Date(ctx.attempt.deadline_at).getTime() : now + 60 * 60 * 1000
  const seconds = Math.max(3600, Math.min(24 * 60 * 60, Math.ceil((deadline - now) / 1000) + 3600))
  const { data, error } = await admin.storage.from(bucketName).createSignedUrl(objectPath, seconds)
  if (error) return null
  return data?.signedUrl ?? null
}

async function publicQuestionPayload(row: any, ctx: any) {
  const metadata = row.metadata_snapshot && typeof row.metadata_snapshot === 'object' ? structuredClone(row.metadata_snapshot) : {}
  const signedUrl = await signedMediaUrl(row.media_bucket_snapshot, row.media_path_snapshot, ctx)
  const demoMediaUrl = typeof metadata.demoMediaUrl === 'string' && metadata.demo === true ? metadata.demoMediaUrl : null
  const mediaUrl = signedUrl || demoMediaUrl
  if (Array.isArray(metadata.caseSubquestions)) {
    metadata.caseSubquestions = await Promise.all(metadata.caseSubquestions.map(async (child: any) => {
      const childSignedUrl = await signedMediaUrl(child.mediaBucket, child.mediaPath, ctx)
      const childDemoUrl = child?.metadata?.demo === true && typeof child?.metadata?.demoMediaUrl === 'string' ? child.metadata.demoMediaUrl : null
      return {
        ...child,
        mediaUrl: childSignedUrl || childDemoUrl,
        mediaBucket: undefined,
        mediaPath: undefined,
      }
    }))
  }
  return {
    id: row.id,
    order: row.display_order,
    type: row.question_type,
    prompt: row.prompt_snapshot,
    points: Number(row.points_snapshot),
    options: Array.isArray(row.options_snapshot) ? row.options_snapshot : [],
    mediaUrl,
    metadata,
  }
}

function answerPayload(row: any) {
  if (!row) return null
  return {
    answerText: row.answer_text ?? '',
    answerNumeric: row.answer_numeric ?? '',
    selectedOptionIds: Array.isArray(row.selected_option_ids) ? row.selected_option_ids : [],
    answerPayload: row.answer_payload && typeof row.answer_payload === 'object' ? row.answer_payload : {},
    isAnswered: Boolean(row.is_answered),
    lastSavedAt: row.last_saved_at,
    clientRevision: Number(row.client_revision || 0),
  }
}

async function loadExamEngine(sessionToken: unknown) {
  const ctx = await resolveSession(sessionToken)
  if (ctx.attempt.status === 'created') throw new AppError('ATTEMPT_NOT_STARTED', 'El intento todavía no ha comenzado.', 409)

  const { data: questions, error: questionsError } = await admin
    .from('intento_preguntas')
    .select('id, display_order, question_type, prompt_snapshot, media_bucket_snapshot, media_path_snapshot, points_snapshot, options_snapshot, metadata_snapshot')
    .eq('attempt_id', ctx.attempt.id)
    .order('display_order', { ascending: true })
  if (questionsError) throw new AppError('SERVER_ERROR', 'No se pudieron cargar las preguntas del intento.', 500)

  const [
    { data: answers, error: answersError },
    { data: evidenceRows, error: evidenceError },
    { count: securityIncidentCount, error: securityCountError },
  ] = await Promise.all([
    admin
      .from('respuestas')
      .select('attempt_question_id, answer_text, answer_numeric, selected_option_ids, answer_payload, is_answered, last_saved_at, client_revision')
      .eq('attempt_id', ctx.attempt.id),
    admin
      .from('evidencias')
      .select('id, attempt_question_id, original_filename, mime_type, size_bytes, bucket_name, object_path, uploaded_at')
      .eq('attempt_id', ctx.attempt.id)
      .is('deleted_at', null),
    admin
      .from('logs')
      .select('id', { count: 'exact', head: true })
      .eq('attempt_id', ctx.attempt.id)
      .like('event_type', 'SECURITY_%'),
  ])
  if (answersError) throw new AppError('SERVER_ERROR', 'No se pudieron cargar las respuestas guardadas.', 500)
  if (evidenceError) throw new AppError('SERVER_ERROR', 'No se pudieron cargar las evidencias guardadas.', 500)
  if (securityCountError) throw new AppError('SERVER_ERROR', 'No se pudo recuperar el contador de integridad.', 500)

  const answerMap = new Map((answers ?? []).map((row: any) => [row.attempt_question_id, row]))
  const evidenceMap = new Map((evidenceRows ?? []).map((row: any) => [row.attempt_question_id, row]))
  const publicQuestions = await Promise.all((questions ?? []).map(async (row: any) => {
    const evidence = evidenceMap.get(row.id)
    return {
      ...(await publicQuestionPayload(row, ctx)),
      answer: answerPayload(answerMap.get(row.id)),
      evidence: evidence ? {
        id: evidence.id,
        name: evidence.original_filename,
        mimeType: evidence.mime_type,
        sizeBytes: Number(evidence.size_bytes || 0),
        uploadedAt: evidence.uploaded_at,
        previewUrl: await signedMediaUrl(evidence.bucket_name, evidence.object_path, ctx),
      } : null,
    }
  }))

  const total = publicQuestions.length
  const currentOrder = Math.min(Math.max(Number(ctx.attempt.current_question_order || 1), 1), Math.max(total, 1))
  const maxReached = Math.min(Math.max(Number(ctx.attempt.max_question_order_reached || 1), 1), Math.max(total, 1))
  return {
    ctx,
    questions: publicQuestions,
    runtime: {
      serverNow: new Date().toISOString(),
      currentOrder,
      maxReachedOrder: maxReached,
      totalQuestions: total,
      navigation: frozenRuntimeConfig(ctx).navigation,
      allowBacktrack: frozenRuntimeConfig(ctx).allowBacktrack,
      autoSubmitOnTimeout: frozenRuntimeConfig(ctx).autoSubmitOnTimeout,
      security: { ...frozenRuntimeConfig(ctx).security, incidentCount: Number(securityIncidentCount || 0) },
    },
  }
}

async function saveAnswerForContext(ctx: any, raw: any, eventType = 'ANSWER_SAVED') {
  const questionId = normalizeText(raw?.attemptQuestionId)
  if (!questionId) throw new AppError('QUESTION_REQUIRED', 'No se indicó la pregunta que se desea guardar.', 400)
  const revision = Math.max(0, Number(raw?.clientRevision || 0))
  if (!Number.isSafeInteger(revision)) throw new AppError('INVALID_REVISION', 'La revisión local de la respuesta no es válida.', 400)

  const { data: question, error: questionError } = await admin
    .from('intento_preguntas')
    .select('id, display_order, question_type, options_snapshot, metadata_snapshot')
    .eq('id', questionId)
    .eq('attempt_id', ctx.attempt.id)
    .maybeSingle()
  if (questionError || !question) throw new AppError('QUESTION_NOT_FOUND', 'La pregunta no pertenece a este intento.', 404)

  const { data: existing } = await admin
    .from('respuestas')
    .select('id, client_revision, last_saved_at, is_answered, answer_payload')
    .eq('attempt_question_id', question.id)
    .maybeSingle()

  if (existing && Number(existing.client_revision || 0) > revision) {
    return { ctx, ignoredAsStale: true, revision: Number(existing.client_revision || 0), lastSavedAt: existing.last_saved_at, isAnswered: existing.is_answered }
  }

  const type = String(question.question_type)
  const selectedOptionIds = sanitizeSelectedOptionIds(type, raw?.selectedOptionIds, question.options_snapshot ?? [])
  let answerNumeric: number | null = null
  if (raw?.answerNumeric !== '' && raw?.answerNumeric !== null && raw?.answerNumeric !== undefined) {
    const parsed = parseFlexibleNumber(raw.answerNumeric)
    if (parsed === null) throw new AppError('INVALID_NUMERIC_ANSWER', 'Ingresa un valor numérico válido. Puedes usar punto o coma decimal.', 400)
    answerNumeric = parsed
  }

  const rawAnswerPayload = raw?.answerPayload && typeof raw.answerPayload === 'object' ? raw.answerPayload : {}
  let nestedPayload: Record<string, unknown> = {}
  if (type === 'case_group') {
    const children = Array.isArray(question.metadata_snapshot?.caseSubquestions) ? question.metadata_snapshot.caseSubquestions : []
    nestedPayload = { caseAnswers: sanitizeCaseAnswers(rawAnswerPayload.caseAnswers, children) }
  } else if (type === 'true_false' && typeof rawAnswerPayload.value === 'boolean') {
    nestedPayload = { value: rawAnswerPayload.value }
  } else if (questionAllowsEvidence(type, question.metadata_snapshot)) {
    // Evidence metadata is server-owned. Ignore any client-supplied evidence fields.
    // This also preserves informational evidence attached to automatically graded items.
    nestedPayload = evidencePayloadFields(existing?.answer_payload)
  }
  if (payloadByteLength(nestedPayload) > MAX_ANSWER_PAYLOAD_BYTES) {
    throw new AppError('ANSWER_PAYLOAD_TOO_LARGE', 'La respuesta estructurada excede el tamaño permitido.', 400)
  }

  const answerText = normalizeText(raw?.answerText)
  const maxText = type === 'short_text' ? MAX_SHORT_TEXT_CHARS : MAX_LONG_TEXT_CHARS
  assertMaxLength(answerText, maxText, 'ANSWER_TOO_LONG', 'La respuesta excede el límite permitido.')

  const cleanPayload = {
    answerText: answerText || null,
    answerNumeric,
    selectedOptionIds,
    answerPayload: nestedPayload,
  }
  const isAnswered = answerIsPresent(type, cleanPayload, question.options_snapshot ?? [], question.metadata_snapshot ?? {})
  const savedAt = new Date().toISOString()
  const atomicSave = await admin.rpc('save_attempt_answer_if_newer', {
    p_attempt_question_id: question.id,
    p_attempt_id: ctx.attempt.id,
    p_answer_text: cleanPayload.answerText,
    p_answer_numeric: cleanPayload.answerNumeric,
    p_selected_option_ids: cleanPayload.selectedOptionIds,
    p_answer_payload: cleanPayload.answerPayload,
    p_is_answered: isAnswered,
    p_answered_at: isAnswered ? savedAt : null,
    p_last_saved_at: savedAt,
    p_client_revision: revision,
  })
  if (atomicSave.error || !atomicSave.data) throw new AppError('ANSWER_SAVE_FAILED', 'No se pudo guardar la respuesta.', 500)
  const saveResult: any = atomicSave.data
  const applied = saveResult.applied === true

  if (applied) {
    await Promise.all([
      admin.from('intentos').update({ last_activity_at: savedAt, last_server_sync_at: savedAt }).eq('id', ctx.attempt.id),
      admin.from('logs').insert({
        student_id: ctx.student.id,
        exam_id: ctx.exam.id,
        attempt_id: ctx.attempt.id,
        event_type: eventType,
        metadata: {
          questionOrder: question.display_order,
          isAnswered: Boolean(saveResult.isAnswered),
          clientRevision: revision,
          queuedAt: raw?.queuedAt || null,
        },
      }),
    ])
  } else if (Number(saveResult.clientRevision || 0) > revision) {
    await admin.from('logs').insert({
      student_id: ctx.student.id,
      exam_id: ctx.exam.id,
      attempt_id: ctx.attempt.id,
      event_type: 'ANSWER_IGNORED_STALE',
      metadata: { questionOrder: question.display_order, clientRevision: revision, serverRevision: Number(saveResult.clientRevision || 0) },
    })
  }

  return {
    ctx,
    ignoredAsStale: !applied && Number(saveResult.clientRevision || 0) > revision,
    revision: Number(saveResult.clientRevision || 0),
    lastSavedAt: saveResult.lastSavedAt,
    isAnswered: Boolean(saveResult.isAnswered),
  }
}

async function saveAnswer(sessionToken: unknown, raw: any) {
  const ctx = await resolveSession(sessionToken)
  if (ctx.attempt.status !== 'in_progress') throw new AppError('ATTEMPT_CLOSED', 'Este intento ya no admite cambios.', 409)
  return saveAnswerForContext(ctx, raw, 'ANSWER_SAVED')
}

async function recoverTimedOutAnswers(sessionToken: unknown, rawEntries: unknown) {
  const ctx = await resolveSession(sessionToken)
  const now = Date.now()
  const deadlineMs = ctx.attempt.deadline_at ? new Date(ctx.attempt.deadline_at).getTime() : null
  const forcedCutoffMs = ctx.attempt.forced_submit_at ? new Date(ctx.attempt.forced_submit_at).getTime() : null
  const teacherForced = ctx.attempt.status === 'submitted' && ctx.attempt.submission_reason === 'TEACHER_FORCED' && Number.isFinite(forcedCutoffMs)
  if (!deadlineMs && !teacherForced) throw new AppError('DEADLINE_MISSING', 'El intento no tiene una hora límite válida.', 409)
  if (!teacherForced && now < Number(deadlineMs)) {
    throw new AppError('TIME_NOT_EXPIRED', 'El tiempo del intento todavía no ha terminado.', 409, {
      serverNow: new Date(now).toISOString(),
      deadlineAt: ctx.attempt.deadline_at,
    })
  }
  if (ctx.attempt.status === 'cancelled') {
    throw new AppError('ATTEMPT_CLOSED', 'El intento fue cancelado y no admite recuperación offline.', 409)
  }
  if (!teacherForced && ctx.attempt.status === 'submitted') {
    throw new AppError('ATTEMPT_CLOSED', 'El intento ya está cerrado y no admite recuperación offline.', 409)
  }
  if (!teacherForced && ctx.attempt.status !== 'time_expired') {
    throw new AppError('ATTEMPT_NOT_EXPIRED', 'El intento no está en estado de tiempo agotado.', 409)
  }

  const cutoffMs = teacherForced ? Number(forcedCutoffMs) : Number(deadlineMs)
  const recoveryUntilMs = ctx.attempt.offline_recovery_until
    ? new Date(ctx.attempt.offline_recovery_until).getTime()
    : cutoffMs + OFFLINE_RECOVERY_GRACE_MS
  if (now > recoveryUntilMs) {
    throw new AppError('OFFLINE_RECOVERY_WINDOW_CLOSED', 'La ventana técnica de recuperación offline ya terminó.', 410, {
      cutoffAt: new Date(cutoffMs).toISOString(),
      recoveryUntil: new Date(recoveryUntilMs).toISOString(),
    })
  }

  const entries = Array.isArray(rawEntries) ? rawEntries : []
  if (entries.length > MAX_OFFLINE_RECOVERY_ANSWERS) {
    throw new AppError('OFFLINE_RECOVERY_TOO_LARGE', 'La cola local contiene más respuestas de las permitidas.', 400)
  }
  const startedMs = ctx.attempt.started_at ? new Date(ctx.attempt.started_at).getTime() : cutoffMs
  const results: any[] = []

  for (const entry of entries) {
    const queuedAtMs = Date.parse(normalizeText(entry?.queuedAt))
    if (!Number.isFinite(queuedAtMs) || queuedAtMs < startedMs - 60_000 || queuedAtMs > cutoffMs + 1500) {
      results.push({ attemptQuestionId: normalizeText(entry?.attemptQuestionId), accepted: false, code: 'QUEUE_TIMESTAMP_OUTSIDE_ATTEMPT' })
      continue
    }
    try {
      const saved = await saveAnswerForContext(ctx, entry, teacherForced ? 'ANSWER_RECOVERED_TEACHER_CLOSE' : 'ANSWER_RECOVERED_OFFLINE')
      results.push({
        attemptQuestionId: normalizeText(entry?.attemptQuestionId),
        accepted: true,
        ignoredAsStale: saved.ignoredAsStale,
        clientRevision: saved.revision,
        lastSavedAt: saved.lastSavedAt,
      })
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'RECOVERY_SAVE_FAILED'
      results.push({ attemptQuestionId: normalizeText(entry?.attemptQuestionId), accepted: false, code })
    }
  }

  const acceptedCount = results.filter((item) => item.accepted).length
  const completedAt = new Date().toISOString()
  await admin.from('intentos').update({
    offline_recovery_until: new Date(recoveryUntilMs).toISOString(),
    offline_recovery_completed_at: completedAt,
    offline_recovery_count: Number(ctx.attempt.offline_recovery_count || 0) + acceptedCount,
    last_server_sync_at: completedAt,
  }).eq('id', ctx.attempt.id)

  if (acceptedCount > 0) {
    const regrade = await admin.rpc('regrade_attempt_after_offline_recovery', { p_attempt_id: ctx.attempt.id })
    if (regrade.error) throw new AppError('OFFLINE_RECOVERY_REGRADE_FAILED', 'Las respuestas se recuperaron, pero no se pudo recalcular la calificación.', 500)
  }

  await admin.from('logs').insert({
    student_id: ctx.student.id,
    exam_id: ctx.exam.id,
    attempt_id: ctx.attempt.id,
    event_type: teacherForced ? 'TEACHER_CLOSE_RECOVERY_COMPLETED' : 'OFFLINE_RECOVERY_COMPLETED',
    metadata: {
      acceptedCount,
      rejectedCount: results.length - acceptedCount,
      cutoffAt: new Date(cutoffMs).toISOString(),
      recoveryUntil: new Date(recoveryUntilMs).toISOString(),
    },
  })

  const refreshed = await admin.from('intentos').select('*').eq('id', ctx.attempt.id).single()
  if (refreshed.data) ctx.attempt = refreshed.data
  return { ctx, results, acceptedCount, rejectedCount: results.length - acceptedCount }
}

async function evidenceQuestion(ctx: any, questionId: string) {
  const { data: question, error } = await admin
    .from('intento_preguntas')
    .select('id, attempt_id, display_order, question_type, points_snapshot, options_snapshot, metadata_snapshot')
    .eq('id', questionId)
    .eq('attempt_id', ctx.attempt.id)
    .maybeSingle()
  if (error || !question) throw new AppError('QUESTION_NOT_FOUND', 'La pregunta no pertenece a este intento.', 404)
  if (!questionAllowsEvidence(String(question.question_type), question.metadata_snapshot)) {
    throw new AppError('EVIDENCE_NOT_ALLOWED', 'Esta pregunta no admite evidencia adjunta.', 409)
  }
  return question
}

async function ensureEvidenceResponse(ctx: any, question: any) {
  const { data: existing } = await admin
    .from('respuestas')
    .select('*')
    .eq('attempt_question_id', question.id)
    .maybeSingle()
  if (existing) return existing

  const createdAt = new Date().toISOString()
  const inserted = await admin.from('respuestas').insert({
    attempt_question_id: question.id,
    attempt_id: ctx.attempt.id,
    selected_option_ids: [],
    answer_payload: {},
    is_answered: false,
    review_status: 'not_required',
    client_revision: 0,
    last_saved_at: createdAt,
  }).select('*').single()
  if (!inserted.error && inserted.data) return inserted.data

  // Two fast upload actions may race while creating the response shell.
  // The unique attempt_question_id constraint is authoritative; recover its winner.
  const retry = await admin.from('respuestas').select('*').eq('attempt_question_id', question.id).maybeSingle()
  if (retry.data) return retry.data
  throw new AppError('EVIDENCE_RESPONSE_FAILED', 'No se pudo preparar la evidencia.', 500)
}

async function prepareEvidenceUpload(sessionToken: unknown, rawFile: any) {
  const ctx = await resolveSession(sessionToken)
  if (ctx.attempt.status !== 'in_progress') throw new AppError('ATTEMPT_CLOSED', 'Este intento ya no admite archivos.', 409)

  const questionId = normalizeText(rawFile?.attemptQuestionId)
  const question = await evidenceQuestion(ctx, questionId)
  const originalFilename = normalizeText(rawFile?.name)
  const mimeType = normalizeText(rawFile?.mimeType).toLowerCase()
  const sizeBytes = Number(rawFile?.sizeBytes || 0)

  const limits = await evidenceLimits()
  if (!originalFilename) throw new AppError('EVIDENCE_FILENAME_REQUIRED', 'El archivo no tiene un nombre válido.', 400)
  if (!limits.allowedMime.has(mimeType)) throw new AppError('EVIDENCE_TYPE_NOT_ALLOWED', `Formatos permitidos: ${evidenceTypeLabel(limits.allowedMime)}.`, 400)
  if (!validEvidenceExtension(originalFilename, mimeType)) throw new AppError('EVIDENCE_EXTENSION_MISMATCH', 'La extensión del archivo no coincide con su tipo declarado.', 400)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > limits.maxBytes) {
    throw new AppError('EVIDENCE_SIZE_INVALID', `La evidencia debe pesar más de 0 bytes y como máximo ${Math.round(limits.maxBytes / 1024 / 1024 * 10) / 10} MB.`, 400)
  }

  await ensureEvidenceResponse(ctx, question)
  const safeName = safeEvidenceFilename(originalFilename)
  const nonce = crypto.randomUUID()
  const path = `${ctx.exam.owner_user_id}/${ctx.exam.id}/${ctx.attempt.id}/${question.id}/${nonce}-${safeName}`
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  const { data: signed, error: signedError } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path)
  if (signedError || !signed?.token) throw new AppError('EVIDENCE_UPLOAD_URL_FAILED', 'No se pudo autorizar la carga de la evidencia.', 500)

  const pending = await admin.from('cargas_evidencia_temporales').insert({
    attempt_id: ctx.attempt.id,
    attempt_question_id: question.id,
    object_path: path,
    original_filename: originalFilename.slice(0, 255),
    mime_type: mimeType,
    size_bytes: sizeBytes,
    expires_at: expiresAt,
  }).select('id').single()
  if (pending.error || !pending.data) throw new AppError('EVIDENCE_UPLOAD_PREPARE_FAILED', 'No se pudo preparar la carga.', 500)

  return {
    ctx,
    upload: {
      id: pending.data.id,
      bucket: EVIDENCE_BUCKET,
      path,
      token: signed.token,
      expiresAt,
      maxBytes: limits.maxBytes,
      allowedMimeTypes: [...limits.allowedMime],
    },
  }
}

async function finalizeEvidenceUpload(sessionToken: unknown, uploadIdRaw: unknown) {
  const ctx = await resolveSession(sessionToken)
  if (ctx.attempt.status !== 'in_progress') throw new AppError('ATTEMPT_CLOSED', 'Este intento ya no admite archivos.', 409)
  const uploadId = normalizeText(uploadIdRaw)
  if (!uploadId) throw new AppError('EVIDENCE_UPLOAD_REQUIRED', 'No se indicó la carga que se desea confirmar.', 400)

  const { data: pending, error: pendingError } = await admin
    .from('cargas_evidencia_temporales')
    .select('*')
    .eq('id', uploadId)
    .eq('attempt_id', ctx.attempt.id)
    .maybeSingle()
  if (pendingError || !pending) throw new AppError('EVIDENCE_UPLOAD_NOT_FOUND', 'La autorización de carga no existe.', 404)
  if (pending.finalized_at) {
    // Idempotent retry: the server may have committed the evidence while the
    // response was lost due to a network interruption.
    const { data: existingEvidence } = await admin
      .from('evidencias')
      .select('*')
      .eq('attempt_id', ctx.attempt.id)
      .eq('attempt_question_id', pending.attempt_question_id)
      .contains('metadata', { uploadId: pending.id })
      .is('deleted_at', null)
      .maybeSingle()
    if (!existingEvidence) throw new AppError('EVIDENCE_UPLOAD_ALREADY_FINALIZED', 'Esta carga ya fue confirmada.', 409)
    const preview = await signedMediaUrl(existingEvidence.bucket_name, existingEvidence.object_path, ctx)
    return {
      ctx,
      evidence: {
        id: existingEvidence.id,
        name: existingEvidence.original_filename,
        mimeType: existingEvidence.mime_type,
        sizeBytes: Number(existingEvidence.size_bytes || 0),
        uploadedAt: existingEvidence.uploaded_at,
        previewUrl: preview,
      },
      isAnswered: true,
    }
  }
  if (new Date(pending.expires_at).getTime() <= Date.now()) throw new AppError('EVIDENCE_UPLOAD_EXPIRED', 'La autorización de carga expiró. Selecciona el archivo nuevamente.', 410)

  const limits = await evidenceLimits()
  const question = await evidenceQuestion(ctx, pending.attempt_question_id)
  const prefix = `${ctx.exam.owner_user_id}/${ctx.exam.id}/${ctx.attempt.id}/${question.id}/`
  if (!String(pending.object_path).startsWith(prefix)) throw new AppError('EVIDENCE_PATH_INVALID', 'La ruta de la evidencia no es válida.', 400)

  const slash = String(pending.object_path).lastIndexOf('/')
  const folder = String(pending.object_path).slice(0, slash)
  const filename = String(pending.object_path).slice(slash + 1)
  const listed = await admin.storage.from(EVIDENCE_BUCKET).list(folder, { limit: 20, search: filename })
  const stored = (listed.data ?? []).find((item: any) => item.name === filename)
  if (listed.error || !stored) throw new AppError('EVIDENCE_FILE_NOT_FOUND', 'El archivo no llegó correctamente al almacenamiento.', 409)

  const actualSize = Number(stored.metadata?.size ?? stored.metadata?.contentLength ?? pending.size_bytes)
  const actualMime = normalizeText(stored.metadata?.mimetype ?? pending.mime_type).toLowerCase()
  if (
    actualSize <= 0
    || actualSize > limits.maxBytes
    || !limits.allowedMime.has(actualMime)
    || actualMime !== String(pending.mime_type).toLowerCase()
    || !validEvidenceExtension(String(pending.original_filename), actualMime)
  ) {
    await admin.storage.from(EVIDENCE_BUCKET).remove([pending.object_path])
    throw new AppError('EVIDENCE_FILE_INVALID', 'El archivo almacenado no cumple las restricciones permitidas.', 400)
  }

  const downloaded = await admin.storage.from(EVIDENCE_BUCKET).download(pending.object_path)
  if (downloaded.error || !downloaded.data) {
    await admin.storage.from(EVIDENCE_BUCKET).remove([pending.object_path])
    throw new AppError('EVIDENCE_FILE_VERIFY_FAILED', 'No se pudo verificar el contenido de la evidencia.', 409)
  }
  const verifiedSize = Number(downloaded.data.size || 0)
  const signatureValid = await verifyEvidenceMagic(downloaded.data, actualMime)
  if (!signatureValid || verifiedSize <= 0 || verifiedSize > limits.maxBytes || verifiedSize !== Number(pending.size_bytes)) {
    await admin.storage.from(EVIDENCE_BUCKET).remove([pending.object_path])
    throw new AppError('EVIDENCE_SIGNATURE_INVALID', 'El contenido real del archivo no coincide con un formato permitido.', 400)
  }

  const response = await ensureEvidenceResponse(ctx, question)
  const { data: previousRows } = await admin
    .from('evidencias')
    .select('id,object_path')
    .eq('attempt_question_id', question.id)
    .eq('attempt_id', ctx.attempt.id)
    .is('deleted_at', null)

  const now = new Date().toISOString()
  if (previousRows?.length) {
    await admin.from('evidencias').update({ deleted_at: now }).in('id', previousRows.map((row: any) => row.id))
  }

  const inserted = await admin.from('evidencias').insert({
    response_id: response.id,
    attempt_id: ctx.attempt.id,
    attempt_question_id: question.id,
    bucket_name: EVIDENCE_BUCKET,
    object_path: pending.object_path,
    original_filename: pending.original_filename,
    mime_type: actualMime,
    size_bytes: verifiedSize,
    uploaded_at: now,
    metadata: { source: 'student', uploadId: pending.id, replacedCount: previousRows?.length ?? 0 },
  }).select('*').single()
  if (inserted.error || !inserted.data) {
    if (previousRows?.length) await admin.from('evidencias').update({ deleted_at: null }).in('id', previousRows.map((row: any) => row.id))
    await admin.storage.from(EVIDENCE_BUCKET).remove([pending.object_path])
    throw new AppError('EVIDENCE_REGISTER_FAILED', 'No se pudo registrar la evidencia.', 500)
  }

  const nextPayload = {
    ...(response.answer_payload && typeof response.answer_payload === 'object' ? response.answer_payload : {}),
    evidenceCount: 1,
    evidenceId: inserted.data.id,
    evidenceName: pending.original_filename,
    evidenceMimeType: actualMime,
    evidenceUploadedAt: now,
  }
  const responseForPresence = {
    answerText: response.answer_text,
    answerNumeric: response.answer_numeric,
    selectedOptionIds: response.selected_option_ids ?? [],
    answerPayload: nextPayload,
  }
  const isAnswered = answerIsPresent(String(question.question_type), responseForPresence, question.options_snapshot ?? [], question.metadata_snapshot ?? {})
  const responseUpdate = await admin.from('respuestas').update({
    answer_payload: nextPayload,
    is_answered: isAnswered,
    answered_at: isAnswered ? (response.answered_at || now) : null,
    last_saved_at: now,
  }).eq('id', response.id)
  if (responseUpdate.error) {
    await admin.from('evidencias').update({ deleted_at: now }).eq('id', inserted.data.id)
    if (previousRows?.length) await admin.from('evidencias').update({ deleted_at: null }).in('id', previousRows.map((row: any) => row.id))
    await admin.storage.from(EVIDENCE_BUCKET).remove([pending.object_path])
    throw new AppError('EVIDENCE_RESPONSE_UPDATE_FAILED', 'La evidencia se cargó, pero no pudo asociarse de forma segura a la respuesta.', 500)
  }
  await admin.from('cargas_evidencia_temporales').update({ finalized_at: now }).eq('id', pending.id)

  if (previousRows?.length) {
    const previousPaths = previousRows.map((row: any) => row.object_path).filter(Boolean)
    if (previousPaths.length) await admin.storage.from(EVIDENCE_BUCKET).remove(previousPaths)
  }

  const preview = await signedMediaUrl(EVIDENCE_BUCKET, pending.object_path, ctx)
  await Promise.all([
    admin.from('intentos').update({ last_activity_at: now, last_server_sync_at: now }).eq('id', ctx.attempt.id),
    admin.from('logs').insert({
      student_id: ctx.student.id,
      exam_id: ctx.exam.id,
      attempt_id: ctx.attempt.id,
      event_type: previousRows?.length ? 'EVIDENCE_REPLACED' : 'EVIDENCE_UPLOADED',
      metadata: { questionOrder: question.display_order, evidenceId: inserted.data.id, filename: pending.original_filename, sizeBytes: verifiedSize, mimeType: actualMime },
    }),
  ])

  return {
    ctx,
    evidence: {
      id: inserted.data.id,
      name: inserted.data.original_filename,
      mimeType: inserted.data.mime_type,
      sizeBytes: Number(inserted.data.size_bytes || 0),
      uploadedAt: inserted.data.uploaded_at,
      previewUrl: preview,
    },
    isAnswered,
  }
}

async function deleteEvidence(sessionToken: unknown, evidenceIdRaw: unknown) {
  const ctx = await resolveSession(sessionToken)
  if (ctx.attempt.status !== 'in_progress') throw new AppError('ATTEMPT_CLOSED', 'Este intento ya no admite cambios en evidencias.', 409)
  const evidenceId = normalizeText(evidenceIdRaw)
  if (!evidenceId) throw new AppError('EVIDENCE_REQUIRED', 'No se indicó la evidencia.', 400)

  const { data: evidence, error } = await admin
    .from('evidencias')
    .select('*')
    .eq('id', evidenceId)
    .eq('attempt_id', ctx.attempt.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !evidence) throw new AppError('EVIDENCE_NOT_FOUND', 'La evidencia no existe o ya fue eliminada.', 404)

  const question = await evidenceQuestion(ctx, evidence.attempt_question_id)
  const { data: response } = await admin.from('respuestas').select('*').eq('id', evidence.response_id).maybeSingle()
  const now = new Date().toISOString()
  await admin.from('evidencias').update({ deleted_at: now }).eq('id', evidence.id)
  await admin.storage.from(evidence.bucket_name || EVIDENCE_BUCKET).remove([evidence.object_path])

  if (response) {
    const payload = { ...(response.answer_payload && typeof response.answer_payload === 'object' ? response.answer_payload : {}) }
    for (const key of ['evidenceCount', 'evidenceId', 'evidenceName', 'evidenceMimeType', 'evidenceUploadedAt']) delete payload[key]
    const responseForPresence = {
      answerText: response.answer_text,
      answerNumeric: response.answer_numeric,
      selectedOptionIds: response.selected_option_ids ?? [],
      answerPayload: payload,
    }
    const isAnswered = answerIsPresent(String(question.question_type), responseForPresence, question.options_snapshot ?? [], question.metadata_snapshot ?? {})
    await admin.from('respuestas').update({
      answer_payload: payload,
      is_answered: isAnswered,
      answered_at: isAnswered ? response.answered_at : null,
      last_saved_at: now,
    }).eq('id', response.id)
  }

  await admin.from('logs').insert({
    student_id: ctx.student.id,
    exam_id: ctx.exam.id,
    attempt_id: ctx.attempt.id,
    event_type: 'EVIDENCE_DELETED',
    metadata: { questionOrder: question.display_order, evidenceId: evidence.id, filename: evidence.original_filename },
  })
  return { ctx, evidenceId: evidence.id, isAnswered: false }
}

async function navigateAttempt(sessionToken: unknown, rawOrder: unknown) {
  const ctx = await resolveSession(sessionToken)
  if (ctx.attempt.status !== 'in_progress') throw new AppError('ATTEMPT_CLOSED', 'Este intento ya no admite navegación.', 409)
  const target = Number(rawOrder)
  if (!Number.isInteger(target) || target < 1) throw new AppError('INVALID_QUESTION_ORDER', 'La pregunta solicitada no es válida.', 400)
  const { count, error } = await admin.from('intento_preguntas').select('id', { count: 'exact', head: true }).eq('attempt_id', ctx.attempt.id)
  if (error) throw new AppError('SERVER_ERROR', 'No se pudo validar la navegación.', 500)
  const total = Number(count || 0)
  if (target > total) throw new AppError('INVALID_QUESTION_ORDER', 'La pregunta solicitada no existe.', 400)

  const current = Math.max(1, Number(ctx.attempt.current_question_order || 1))
  const maxReached = Math.max(1, Number(ctx.attempt.max_question_order_reached || 1))
  const runtimeConfig = frozenRuntimeConfig(ctx)
  if (runtimeConfig.navigation === 'sequential') {
    if (target > maxReached + 1) throw new AppError('SEQUENTIAL_NAVIGATION', 'Debes avanzar las preguntas en orden.', 409)
    if (!runtimeConfig.allowBacktrack && target < maxReached) {
      throw new AppError('BACKTRACK_DISABLED', 'Este examen no permite volver a preguntas anteriores.', 409)
    }
    if (!runtimeConfig.allowBacktrack && target < current) {
      throw new AppError('BACKTRACK_DISABLED', 'Este examen no permite volver a preguntas anteriores.', 409)
    }
  }

  const nextMax = Math.max(maxReached, target)
  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await admin.from('intentos').update({
    current_question_order: target,
    max_question_order_reached: nextMax,
    last_activity_at: now,
    last_server_sync_at: now,
  }).eq('id', ctx.attempt.id).select('current_question_order, max_question_order_reached').single()
  if (updateError || !updated) throw new AppError('NAVIGATION_SAVE_FAILED', 'No se pudo guardar la posición del examen.', 500)
  return { ctx, currentOrder: updated.current_question_order, maxReachedOrder: updated.max_question_order_reached, totalQuestions: total }
}

async function pingAttempt(sessionToken: unknown) {
  const ctx = await resolveSession(sessionToken)
  const now = new Date().toISOString()
  if (ctx.attempt.status === 'in_progress') {
    await admin.from('intentos').update({ last_server_sync_at: now }).eq('id', ctx.attempt.id)
  }
  return {
    ctx,
    serverNow: now,
    currentOrder: Number(ctx.attempt.current_question_order || 1),
    maxReachedOrder: Number(ctx.attempt.max_question_order_reached || 1),
  }
}

function optionSummary(options: any[], ids: unknown) {
  const selected = Array.isArray(ids) ? ids.map(String) : []
  const map = new Map((Array.isArray(options) ? options : []).map((option: any, index: number) => [String(option.id), `${String.fromCharCode(65 + index)}. ${normalizeText(option.content)}`]))
  return selected.map((id) => map.get(id) || id).join(' · ')
}

function studentAnswerSummary(type: string, question: any, answer: any) {
  if (!answer) return ''
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) {
    return optionSummary(question.options_snapshot ?? [], answer.selected_option_ids ?? [])
  }
  if (type === 'true_false') {
    return typeof answer.answer_payload?.value === 'boolean' ? (answer.answer_payload.value ? 'Verdadero' : 'Falso') : ''
  }
  if (['numeric', 'calculation', 'calculation_evidence'].includes(type)) {
    return answer.answer_numeric === null || answer.answer_numeric === undefined ? '' : String(answer.answer_numeric)
  }
  if (type === 'attachment') return Number(answer.answer_payload?.evidenceCount || 0) > 0 ? 'Archivo adjunto entregado' : ''
  if (type === 'case_group') return answer.is_answered ? 'Caso respondido' : ''
  return normalizeText(answer.answer_text)
}

function correctAnswerSummary(type: string, question: any) {
  const grading = question.grading_snapshot && typeof question.grading_snapshot === 'object' ? question.grading_snapshot : {}
  const answerKey = grading.answerKey && typeof grading.answerKey === 'object' ? grading.answerKey : {}
  const gradingConfig = grading.gradingConfig && typeof grading.gradingConfig === 'object' ? grading.gradingConfig : {}
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) {
    return optionSummary(question.options_snapshot ?? [], grading.correctOptionIds ?? [])
  }
  if (type === 'true_false') return typeof answerKey.value === 'boolean' ? (answerKey.value ? 'Verdadero' : 'Falso') : ''
  if (type === 'short_text') return Array.isArray(answerKey.answers) ? answerKey.answers.map(String).join(' · ') : ''
  if (['numeric', 'calculation', 'calculation_evidence'].includes(type)) {
    const mode = normalizeText(gradingConfig.numericMode) || ((answerKey.min != null || answerKey.max != null) ? 'range' : grading.numericTolerance != null ? 'tolerance' : 'exact')
    if (mode === 'range') return `${answerKey.min ?? gradingConfig.min ?? '—'} a ${answerKey.max ?? gradingConfig.max ?? '—'}`
    if (mode === 'tolerance') return `${answerKey.value ?? '—'} ± ${grading.numericTolerance ?? 0}`
    return answerKey.value === null || answerKey.value === undefined ? '' : String(answerKey.value)
  }
  return ''
}

async function safeStudentExamCopyDetails(ctx: any) {
  const runtimeConfig = frozenRuntimeConfig(ctx)
  const visibility = String(runtimeConfig.resultVisibility || 'confirmation_only')
  const examEnds = ctx.exam.ends_at ? new Date(ctx.exam.ends_at).getTime() : null
  const answersReleased = Boolean(examEnds && Date.now() >= examEnds && ['correct_answers', 'full_feedback'].includes(visibility))

  const [{ data: questions, error: questionError }, { data: answers, error: answerError }, { data: grade }] = await Promise.all([
    admin.from('intento_preguntas')
      .select('id,display_order,question_type,prompt_snapshot,points_snapshot,options_snapshot,grading_snapshot')
      .eq('attempt_id', ctx.attempt.id)
      .order('display_order', { ascending: true }),
    admin.from('respuestas')
      .select('attempt_question_id,answer_text,answer_numeric,selected_option_ids,answer_payload,is_answered,is_correct,auto_score,manual_score,review_status,teacher_feedback')
      .eq('attempt_id', ctx.attempt.id),
    admin.from('calificaciones')
      .select('pending_manual_reviews,final_grade,is_published')
      .eq('attempt_id', ctx.attempt.id)
      .maybeSingle(),
  ])
  if (questionError || answerError) throw new AppError('RESULT_DETAILS_FAILED', 'No se pudo preparar la copia del examen.', 500)

  const answerMap = new Map((answers ?? []).map((row: any) => [String(row.attempt_question_id), row]))
  const details = (questions ?? []).map((question: any) => {
    const answer: any = answerMap.get(String(question.id)) ?? null
    const reviewed = answer?.review_status === 'reviewed'
    const pending = answer?.review_status === 'pending'
    // The student's own points are not an answer key. Once the attempt has a
    // completed final grade, expose each question score while keeping correct
    // answers and feedback under the independent answer-key embargo.
    const completedGradeReady = Number(grade?.pending_manual_reviews || 0) === 0 && grade?.final_grade !== null && grade?.final_grade !== undefined
    const scoreVisible = completedGradeReady && !pending
    return {
      order: Number(question.display_order),
      prompt: question.prompt_snapshot,
      type: String(question.question_type),
      studentAnswer: studentAnswerSummary(String(question.question_type), question, answer),
      correctAnswer: answersReleased ? correctAnswerSummary(String(question.question_type), question) : null,
      isCorrect: answersReleased ? (answer?.is_correct ?? null) : null,
      score: scoreVisible ? (reviewed ? Number(answer?.manual_score || 0) : Number(answer?.auto_score || 0)) : null,
      scoreHidden: !scoreVisible && !pending,
      maxScore: Number(question.points_snapshot || 0),
      reviewStatus: answer?.review_status ?? 'not_required',
      teacherFeedback: answersReleased && visibility === 'full_feedback' ? (answer?.teacher_feedback || null) : null,
    }
  })

  return {
    details,
    answersReleased,
    pendingManualReviews: Number(grade?.pending_manual_reviews || 0),
    gradeScaleMax: Number(runtimeConfig.gradeScaleMax || 20),
    finalGradeCap: Number(runtimeConfig.finalGradeCap || runtimeConfig.gradeScaleMax || 20),
  }
}

async function safeStudentResultDetails(ctx: any, visibility: string) {
  if (!['correct_answers', 'full_feedback'].includes(visibility)) return { details: null, answersEmbargoed: false }

  // Correct keys must not leak while classmates may still be taking the same exam.
  const examEnds = ctx.exam.ends_at ? new Date(ctx.exam.ends_at).getTime() : null
  if (!examEnds || Date.now() < examEnds) return { details: null, answersEmbargoed: true }

  const [{ data: questions, error: questionError }, { data: answers, error: answerError }] = await Promise.all([
    admin.from('intento_preguntas')
      .select('id,display_order,question_type,prompt_snapshot,points_snapshot,options_snapshot,grading_snapshot')
      .eq('attempt_id', ctx.attempt.id)
      .order('display_order', { ascending: true }),
    admin.from('respuestas')
      .select('attempt_question_id,answer_text,answer_numeric,selected_option_ids,answer_payload,is_answered,is_correct,auto_score,manual_score,review_status,teacher_feedback')
      .eq('attempt_id', ctx.attempt.id),
  ])
  if (questionError || answerError) throw new AppError('RESULT_DETAILS_FAILED', 'No se pudo preparar el detalle de resultados.', 500)

  const answerMap = new Map((answers ?? []).map((row: any) => [String(row.attempt_question_id), row]))
  const details = (questions ?? []).map((question: any) => {
    const answer: any = answerMap.get(String(question.id)) ?? null
    const reviewed = answer?.review_status === 'reviewed'
    return {
      order: Number(question.display_order),
      prompt: question.prompt_snapshot,
      type: String(question.question_type),
      studentAnswer: studentAnswerSummary(String(question.question_type), question, answer),
      correctAnswer: correctAnswerSummary(String(question.question_type), question),
      isCorrect: answer?.is_correct ?? null,
      score: reviewed ? Number(answer?.manual_score || 0) : Number(answer?.auto_score || 0),
      maxScore: Number(question.points_snapshot || 0),
      reviewStatus: answer?.review_status ?? 'not_required',
      teacherFeedback: visibility === 'full_feedback' ? (answer?.teacher_feedback || null) : null,
    }
  })
  return { details, answersEmbargoed: false }
}

async function safeGradingSummary(ctx: any, options: { completedResultAccess?: boolean } = {}) {
  const { data: grade } = await admin
    .from('calificaciones')
    .select('auto_score,manual_score,raw_score,max_raw_score,final_grade,pending_manual_reviews,auto_graded_at')
    .eq('attempt_id', ctx.attempt.id)
    .maybeSingle()
  if (!grade) return null

  const runtimeConfig = frozenRuntimeConfig(ctx)
  const visibility = String(runtimeConfig.resultVisibility || 'confirmation_only')
  const showAfter = runtimeConfig.showResultsAfter ? new Date(runtimeConfig.showResultsAfter).getTime() : null
  const embargoed = Boolean(showAfter && Date.now() < showAfter)
  const base = {
    visibility,
    embargoed,
    pendingManualReviews: Number(grade.pending_manual_reviews || 0),
    autoGradedAt: grade.auto_graded_at,
  }

  const completedResultAccess = options.completedResultAccess === true
  const visibleModes = ['score_only', 'grade', 'correct_answers', 'full_feedback']
  const pendingManualReviews = Number(grade.pending_manual_reviews || 0)
  const completedGradeReady = pendingManualReviews === 0 && grade.final_grade !== null

  // The embargo protects answer keys and feedback. Once manual grading is
  // complete, the student may see their own final score without exposing keys.
  if (embargoed && !completedGradeReady && !completedResultAccess) return base

  // A closed, fully graded attempt may always expose its own final score to the
  // student. Correct answers and feedback remain governed by the configured
  // result visibility/embargo below, so this does not release answer keys early.
  if (visibleModes.includes(visibility) || completedResultAccess || completedGradeReady) {
    const result: Record<string, unknown> = {
      ...base,
      rawScore: Number(grade.raw_score || 0),
      maxRawScore: Number(grade.max_raw_score || 0),
      provisional: pendingManualReviews > 0,
      gradeAvailable: completedResultAccess
        ? pendingManualReviews === 0
        : completedGradeReady || ['grade', 'correct_answers', 'full_feedback'].includes(visibility),
    }
    if (completedResultAccess || completedGradeReady || ['grade', 'correct_answers', 'full_feedback'].includes(visibility)) {
      result.finalGrade = grade.final_grade === null ? null : Number(grade.final_grade)
      result.gradeScaleMax = Number(runtimeConfig.gradeScaleMax || 20)
      result.finalGradeCap = Number(runtimeConfig.finalGradeCap || runtimeConfig.gradeScaleMax || 20)
      result.uncappedFinalGrade = Number(grade.max_raw_score || 0) > 0
        ? Math.round(((Number(grade.raw_score || 0) / Number(grade.max_raw_score || 1)) * Number(runtimeConfig.gradeScaleMax || 20)) * 1000) / 1000
        : 0
      result.passingGrade = Number(runtimeConfig.passingGrade || 0)
    }
    if (!embargoed && ['correct_answers', 'full_feedback'].includes(visibility)) {
      const extra = await safeStudentResultDetails(ctx, visibility)
      result.details = extra.details
      result.answersEmbargoed = extra.answersEmbargoed
    } else if (embargoed) {
      result.answersEmbargoed = true
    }
    return result
  }
  return base
}

async function recordSecurityEvent(sessionToken: unknown, rawEvent: any) {
  const ctx = await resolveSession(sessionToken)
  if (ctx.attempt.status !== 'in_progress') return { ctx, count: 0, type: 'SECURITY_EVENT' }
  let type = normalizeText(rawEvent?.type).toUpperCase().replace(/[^A-Z0-9_]+/g, '_').slice(0, 80)
  if (!type.startsWith('SECURITY_')) type = `SECURITY_${type || 'EVENT'}`
  const metadata = rawEvent?.metadata && typeof rawEvent.metadata === 'object' ? rawEvent.metadata : {}
  if (payloadByteLength(metadata) > 8 * 1024) throw new AppError('SECURITY_EVENT_TOO_LARGE', 'El evento de seguridad es demasiado grande.', 400)
  await admin.from('logs').insert({ student_id: ctx.student.id, exam_id: ctx.exam.id, attempt_id: ctx.attempt.id, event_type: type, metadata })
  const { count } = await admin.from('logs').select('id', { count: 'exact', head: true }).eq('attempt_id', ctx.attempt.id).like('event_type', 'SECURITY_%')
  return { ctx, count: Number(count || 0), type }
}

async function submitAttempt(sessionToken: unknown, rawReason: unknown) {
  const ctx = await resolveSession(sessionToken)
  if (['submitted', 'time_expired', 'cancelled'].includes(ctx.attempt.status)) {
    return { ctx, alreadyClosed: true, grading: await safeGradingSummary(ctx) }
  }
  if (ctx.attempt.status !== 'in_progress') throw new AppError('ATTEMPT_NOT_IN_PROGRESS', 'El intento no está en curso.', 409)

  const now = nowMs()
  const deadline = ctx.attempt.deadline_at ? new Date(ctx.attempt.deadline_at).getTime() : null
  const requested = normalizeText(rawReason).toUpperCase()
  const timedOut = Boolean(deadline && now >= deadline)
  if (requested === 'TIME_EXPIRED' && !timedOut) throw new AppError('TIME_NOT_EXPIRED', 'El tiempo del intento todavía no ha terminado.', 409)
  const reason = timedOut ? 'TIME_EXPIRED' : 'STUDENT_SUBMITTED'
  const status = timedOut ? 'time_expired' : 'submitted'
  const submittedAt = new Date().toISOString()
  const { data: updated, error } = await admin.from('intentos').update({
    status,
    submitted_at: submittedAt,
    submission_reason: reason,
    last_activity_at: submittedAt,
    last_server_sync_at: submittedAt,
  }).eq('id', ctx.attempt.id).eq('status', 'in_progress').select('*').single()
  if (error || !updated) {
    const reread = await admin.from('intentos').select('*').eq('id', ctx.attempt.id).single()
    if (!reread.data || !['submitted', 'time_expired'].includes(reread.data.status)) {
      throw new AppError('SUBMISSION_FAILED', 'No se pudo enviar el examen.', 500)
    }
    ctx.attempt = reread.data
  } else {
    ctx.attempt = updated
  }

  await admin.from('logs').insert({
    student_id: ctx.student.id,
    exam_id: ctx.exam.id,
    attempt_id: ctx.attempt.id,
    event_type: reason,
    metadata: { submittedAt: ctx.attempt.submitted_at },
  })
  const resultAccessCode = await ensureResultAccessCode(ctx.attempt)
  const grading = await safeGradingSummary(ctx)
  return { ctx, alreadyClosed: false, grading, resultAccessCode }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  const corsHeaders = corsHeadersFor(origin)
  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return new Response(null, { status: 403, headers: corsHeaders })
    return new Response('ok', { headers: corsHeaders })
  }
  if (!isAllowedOrigin(origin)) return json({ ok: false, code: 'ORIGIN_NOT_ALLOWED', message: 'Origen no autorizado.' }, 403, corsHeaders)
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' }, 405, corsHeaders)

  try {
    const body = await request.json().catch(() => ({}))
    const action = normalizeText(body.action)
    await enforceRateLimit(request, action, body)

    if (action === 'validate') {
      const ctx = await loadExam(body.accessCode, body.recoveryAttemptId)
      await admin.from('logs').insert({
        exam_id: ctx.exam.id,
        event_type: 'STUDENT_ACCESS_VALIDATED',
        metadata: { userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null },
      })
      return json({ ok: true, exam: publicExamPayload(ctx) }, 200, corsHeaders)
    }

    if (action === 'validate_results') {
      const ctx = await loadExam(body.accessCode, null, true)
      return json({ ok: true, exam: publicExamPayload(ctx) }, 200, corsHeaders)
    }

    if (action === 'result_access') {
      const result = await accessCompletedResults(body.accessCode, body.identity, body.resultAccessCode, request)
      return json({
        ok: true,
        sessionToken: result.sessionToken,
        ...attemptPayload(result.ctx),
        grading: result.grading,
        reportDetails: result.reportDetails,
        resultAccessCode: result.resultAccessCode,
        resultAccess: true,
      }, 200, corsHeaders)
    }

    if (action === 'prepare') {
      const prepared = await prepareAttempt(body.accessCode, body.identity, request, body.recoveryAttemptId)
      return json({
        ok: true,
        sessionToken: prepared.sessionToken,
        resumed: prepared.resumed,
        ...attemptPayload({
          attempt: prepared.attempt,
          student: prepared.student,
          exam: prepared.ctx.exam,
          config: prepared.ctx.config,
          course: prepared.ctx.course,
        }),
      }, 200, corsHeaders)
    }

    if (action === 'status') {
      const ctx = await resolveSession(body.sessionToken)
      const closed = ['submitted', 'time_expired'].includes(ctx.attempt.status)
      let resultAccessCode = null
      if (closed && body.resultAccess !== true) {
        resultAccessCode = body.resultAccessCode
          ? await reconcileResultAccessCodeFromSession(ctx.attempt, body.resultAccessCode)
          : await ensureResultAccessCode(ctx.attempt)
      }
      if (closed) await refreshCompletedGrade(ctx.attempt.id)
      const grading = closed ? await safeGradingSummary(ctx, { completedResultAccess: body.resultAccess === true }) : null
      const reportDetails = closed ? await safeStudentExamCopyDetails(ctx) : null
      return json({ ok: true, ...attemptPayload(ctx), grading, reportDetails, resultAccessCode, resultAccess: body.resultAccess === true }, 200, corsHeaders)
    }

    if (action === 'start') {
      const ctx = await startAttempt(body.sessionToken)
      return json({ ok: true, ...attemptPayload(ctx), generation: (ctx as any).generation ?? null, serverNow: new Date().toISOString() }, 200, corsHeaders)
    }

    if (action === 'engine') {
      const loaded = await loadExamEngine(body.sessionToken)
      return json({ ok: true, ...attemptPayload(loaded.ctx), questions: loaded.questions, runtime: loaded.runtime }, 200, corsHeaders)
    }

    if (action === 'save_answer') {
      const saved = await saveAnswer(body.sessionToken, body.answer)
      return json({ ok: true, ...attemptPayload(saved.ctx), save: {
        ignoredAsStale: saved.ignoredAsStale,
        clientRevision: saved.revision,
        lastSavedAt: saved.lastSavedAt,
        isAnswered: saved.isAnswered,
        serverNow: new Date().toISOString(),
      } }, 200, corsHeaders)
    }

    if (action === 'timeout_recover') {
      const recovered = await recoverTimedOutAnswers(body.sessionToken, body.answers)
      const resultAccessCode = await ensureResultAccessCode(recovered.ctx.attempt)
      return json({
        ok: true,
        ...attemptPayload(recovered.ctx),
        resultAccessCode,
        recovery: {
          acceptedCount: recovered.acceptedCount,
          rejectedCount: recovered.rejectedCount,
          results: recovered.results,
          serverNow: new Date().toISOString(),
        },
        grading: await safeGradingSummary(recovered.ctx),
        reportDetails: await safeStudentExamCopyDetails(recovered.ctx),
      }, 200, corsHeaders)
    }

    if (action === 'prepare_evidence') {
      const prepared = await prepareEvidenceUpload(body.sessionToken, body.file)
      return json({ ok: true, ...attemptPayload(prepared.ctx), upload: prepared.upload, serverNow: new Date().toISOString() }, 200, corsHeaders)
    }

    if (action === 'finalize_evidence') {
      const finalized = await finalizeEvidenceUpload(body.sessionToken, body.uploadId)
      return json({ ok: true, ...attemptPayload(finalized.ctx), evidence: finalized.evidence, isAnswered: finalized.isAnswered, serverNow: new Date().toISOString() }, 200, corsHeaders)
    }

    if (action === 'delete_evidence') {
      const removed = await deleteEvidence(body.sessionToken, body.evidenceId)
      return json({ ok: true, ...attemptPayload(removed.ctx), evidenceId: removed.evidenceId, isAnswered: removed.isAnswered, serverNow: new Date().toISOString() }, 200, corsHeaders)
    }

    if (action === 'navigate') {
      const moved = await navigateAttempt(body.sessionToken, body.targetOrder)
      return json({ ok: true, ...attemptPayload(moved.ctx), navigation: {
        currentOrder: moved.currentOrder,
        maxReachedOrder: moved.maxReachedOrder,
        totalQuestions: moved.totalQuestions,
      }, serverNow: new Date().toISOString() }, 200, corsHeaders)
    }

    if (action === 'ping') {
      const ping = await pingAttempt(body.sessionToken)
      return json({ ok: true, ...attemptPayload(ping.ctx), runtime: {
        serverNow: ping.serverNow,
        currentOrder: ping.currentOrder,
        maxReachedOrder: ping.maxReachedOrder,
      } }, 200, corsHeaders)
    }

    if (action === 'security_event') {
      const recorded = await recordSecurityEvent(body.sessionToken, body.event)
      return json({ ok: true, incidentCount: recorded.count, eventType: recorded.type, serverNow: new Date().toISOString() }, 200, corsHeaders)
    }

    if (action === 'submit') {
      const submitted = await submitAttempt(body.sessionToken, body.reason)
      const resultAccessCode = submitted.resultAccessCode || await ensureResultAccessCode(submitted.ctx.attempt)
      return json({
        ok: true,
        ...attemptPayload(submitted.ctx),
        alreadyClosed: submitted.alreadyClosed,
        grading: submitted.grading ?? null,
        reportDetails: await safeStudentExamCopyDetails(submitted.ctx),
        resultAccessCode,
        serverNow: new Date().toISOString(),
      }, 200, corsHeaders)
    }

    throw new AppError('UNKNOWN_ACTION', 'Acción no reconocida.', 400)
  } catch (error) {
    console.error(error)
    if (error instanceof AppError) {
      return json({ ok: false, code: error.code, message: error.message, details: error.details ?? null }, error.status, corsHeaders)
    }
    return json({ ok: false, code: 'SERVER_ERROR', message: 'Ocurrió un error interno al procesar la solicitud.' }, 500, corsHeaders)
  }
})
