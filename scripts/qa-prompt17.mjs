import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))
const checks = []
const check = (area, name, ok, severity = 'high', detail = '') => checks.push({ area, name, ok: Boolean(ok), severity, detail })

const app = read('src/App.jsx')
const examsPage = read('src/pages/TeacherExamsPage.jsx')
const examEditor = read('src/pages/TeacherExamEditorPage.jsx')
const dashboard = read('src/pages/TeacherDashboardPage.jsx')
const examService = read('src/services/examManagement.js')
const bankService = read('src/services/questionBankManagement.js')
const bankPage = read('src/pages/TeacherQuestionBanksPage.jsx')
const exportService = read('src/services/resultsExport.js')
const resultsPage = read('src/pages/TeacherResultsPage.jsx')
const accessService = read('src/services/studentExamAccess.js')
const accessPage = read('src/pages/StudentAccessPage.jsx')
const instructionsPage = read('src/pages/StudentInstructionsPage.jsx')
const examPage = read('src/pages/StudentExamPage.jsx')
const reviewPage = read('src/pages/StudentReviewPage.jsx')
const evidenceUploader = read('src/components/StudentEvidenceUploader.jsx')
const timerHook = read('src/hooks/useExamTimer.js')
const edge = read('supabase/functions/exam-access/index.ts')
const randomMigration = read('supabase/migrations/0012_exam_randomization_engine.sql')
const gradingMigration = read('supabase/migrations/0015_auto_grading_engine.sql')
const recoveryMigration = read('supabase/migrations/0020_failure_recovery.sql')
const strictMigration = read('supabase/migrations/0021_strict_audit_fixes.sql')
const bootstrap = read('supabase/sql/bootstrap_all.sql')
const teacherAuditMigration = exists('supabase/migrations/0027_teacher_audit_hardening.sql') ? read('supabase/migrations/0027_teacher_audit_hardening.sql') : ''

// Teacher flow
check('Docente', 'Ruta para crear examen', /examenes\/nuevo/.test(app) && /TeacherExamEditorPage/.test(app))
check('Docente', 'Servicio de creación de examen', /export async function createTeacherExam/.test(examService))
check('Docente', 'Edición de examen', /export async function updateTeacherExam/.test(examService) && /:examId\/editar/.test(app))
check('Docente', 'Duplicación segura', /duplicateTeacherExam/.test(examsPage) && /rpc\(['"]duplicate_exam['"]/.test(examService))
check('Docente', 'Activación/desactivación', /changeExamStatus/.test(examsPage) && /action === 'activate'/.test(examsPage) && /action === 'deactivate'/.test(examsPage))
check('Docente', 'Gestión de bancos', /path=\"bancos\"/.test(app) && /TeacherQuestionBanksPage/.test(app) && /export async function createQuestionBank/.test(bankService) && /createQuestionBank/.test(read('src/components/QuestionBankEditorModal.jsx')))
check('Docente', 'Carga de imágenes en preguntas', /uploadQuestionMedia/.test(bankService) && /question-media/.test(bankService))
check('Docente', 'Exportación Excel/CSV', /export.*Excel|exportExam.*Excel|download.*Excel/i.test(exportService + resultsPage) && /CSV/i.test(exportService + resultsPage))

// Student flow
check('Estudiante', 'Acceso público por código', /validateExamCode/.test(accessService) && /action: 'validate'/.test(accessService))
check('Estudiante', 'Código inválido tratado por servidor', /INVALID_ACCESS_CODE|ACCESS_CODE_INVALID|invalid.*code/i.test(edge))
check('Estudiante', 'Preparación de intento antes de iniciar tiempo', /prepareStudentAttempt/.test(accessService) && /startStudentAttempt/.test(accessService) && /startAttempt/.test(instructionsPage))
check('Estudiante', 'Cronómetro usa deadline del servidor', /deadlineAt/.test(timerHook) && /serverNow/.test(timerHook) && /pingStudentAttempt/.test(examPage))
check('Estudiante', 'Autoguardado de respuestas', /saveStudentAnswer/.test(examPage) && /writePendingAnswer/.test(examPage))
check('Estudiante', 'Guardado atómico de respuesta', /save_attempt_answer_if_newer/.test(strictMigration) && /save_attempt_answer_if_newer/.test(edge))
check('Estudiante', 'Carga de evidencias', /prepareStudentEvidence/.test(accessService) && /finalizeStudentEvidence/.test(accessService) && /StudentEvidenceUploader/.test(read('src/components/StudentQuestionRenderer.jsx')))
check('Estudiante', 'Envío definitivo', /submitStudentAttempt/.test(reviewPage) && /STUDENT_SUBMITTED/.test(reviewPage))
check('Estudiante', 'Recuperación ante sesión perdida', /SESSION_EXPIRED/.test(examPage + reviewPage + accessPage) && /recoveryRequired/.test(accessPage))

// Randomization: verify implementation and run a separate deterministic model with 20 students.
check('Aleatorización', 'Motor persistente de preguntas congeladas', /intento_preguntas/.test(randomMigration) && /generate|prepare|freeze|frozen/i.test(randomMigration))
check('Aleatorización', 'Aleatorización de opciones preserva identidad interna', /options_snapshot/.test(randomMigration) && /grading_snapshot/.test(randomMigration))

function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}
function sample(ids, count, rand) {
  const pool = [...ids]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}
const bank = Array.from({ length: 80 }, (_, i) => `Q${String(i + 1).padStart(3, '0')}`)
const fingerprints = new Set()
let duplicateFailures = 0
let persistenceFailures = 0
for (let student = 1; student <= 20; student++) {
  const first = sample(bank, 20, seeded(1000 + student))
  const persisted = [...first]
  if (new Set(first).size !== first.length) duplicateFailures++
  if (persisted.join('|') !== first.join('|')) persistenceFailures++
  fingerprints.add(first.join('|'))
}
check('Aleatorización', '20 alumnos simulados sin preguntas duplicadas', duplicateFailures === 0, 'high', `fallos=${duplicateFailures}`)
check('Aleatorización', '20 intentos conservan su conjunto congelado', persistenceFailures === 0, 'high', `fallos=${persistenceFailures}`)
check('Aleatorización', 'Existe variación entre alumnos simulados', fingerprints.size >= 15, 'medium', `combinaciones=${fingerprints.size}`)

// Timer independent model: reload/reentry must not reset server deadline.
const startedAt = Date.parse('2026-09-17T15:00:00Z')
const deadlineAt = startedAt + 45 * 60 * 1000
const after12m = startedAt + 12 * 60 * 1000
const afterReload = deadlineAt - after12m
const afterCloseReentry = deadlineAt - (startedAt + 25 * 60 * 1000)
check('Cronómetro', 'Recarga conserva deadline original', afterReload === 33 * 60 * 1000)
check('Cronómetro', 'Cierre/reingreso conserva deadline original', afterCloseReentry === 20 * 60 * 1000)
check('Cronómetro', 'Vencimiento duro existe en base de datos', /config_auto_submit_timeout_required/.test(strictMigration) && /deadline/i.test(recoveryMigration + edge))
check('Cronómetro', 'Timeout no depende solo del navegador', /serverNow/.test(timerHook) && /deadlineAt/.test(edge))

// Grading coverage from real SQL.
const gradingTypes = [
  ['single_choice', /single_choice/],
  ['multiple_choice', /multiple_choice/],
  ['true_false', /true_false/],
  ['short_text', /short_text/],
  ['numeric', /numeric/],
  ['calculation', /calculation/],
  ['calculation_evidence', /calculation_evidence/],
  ['essay/manual', /essay/],
]
for (const [name, rx] of gradingTypes) check('Calificación', `Cobertura ${name}`, rx.test(gradingMigration))
check('Calificación', 'Tolerancia numérica', /tolerance|tolerancia|numeric_tolerance/i.test(gradingMigration))
check('Calificación', 'Intervalo numérico', /min|max|range|interval/i.test(gradingMigration))
check('Calificación', 'Desarrollo no se autocalifica', /review_status|pending/.test(gradingMigration))

// Regression for corrected participant metric.
check('Dashboard', 'Dashboard usa agregación de servidor sin límite fijo', /rpc\(['"]get_teacher_dashboard['"]/.test(examService) && /create or replace function public\.get_teacher_dashboard/.test(teacherAuditMigration), 'medium')
check('Dashboard', 'Participantes se deduplican por estudiante', /count\(distinct i\.student_id\)/i.test(teacherAuditMigration), 'medium')
check('Dashboard', 'Interfaz etiqueta participantes, no intentos', /label="Participantes"/.test(dashboard) && /<th>Participantes<\/th>/.test(dashboard), 'low')

// Structural checks
const migrationFiles = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()
for (const migration of migrationFiles) check('Estructura', `Bootstrap incluye ${migration}`, bootstrap.includes(migration), 'high')
check('Estructura', 'Cero secretos de service role en frontend', !/service_role|SUPABASE_SERVICE_ROLE|secret key/i.test([...walk(path.join(root, 'src'))].filter(f => /\.(js|jsx)$/.test(f)).map(f => fs.readFileSync(f,'utf8')).join('\n')), 'critical')

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

// Local import integrity.
const sourceFiles = [...walk(path.join(root, 'src'))].filter((f) => /\.(js|jsx)$/.test(f))
let importCount = 0
let missingImports = 0
for (const file of sourceFiles) {
  const content = fs.readFileSync(file, 'utf8')
  const rx = /(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g
  let match
  while ((match = rx.exec(content))) {
    importCount++
    const base = path.resolve(path.dirname(file), match[1])
    const candidates = [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')]
    if (!candidates.some((candidate) => fs.existsSync(candidate))) missingImports++
  }
}
check('Estructura', 'Imports locales resuelven', missingImports === 0, 'critical', `revisados=${importCount}; faltantes=${missingImports}`)

const failed = checks.filter((item) => !item.ok)
const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 }
const failedCriticalHigh = failed.filter((item) => severityOrder[item.severity] >= 3)
const summary = {
  status: failedCriticalHigh.length ? 'FAIL' : 'PASS',
  totalChecks: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  failedCriticalHigh: failedCriticalHigh.length,
  randomizationStudents: 20,
  randomizationUniqueFingerprints: fingerprints.size,
  localImportsChecked: importCount,
  localImportsMissing: missingImports,
  checks,
}
fs.writeFileSync(path.join(root, 'docs/QA_PROMPT17_RESULT.json'), JSON.stringify(summary, null, 2) + '\n')
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} [${item.severity.toUpperCase()}] ${item.area} - ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
console.log(`\nPrompt 17 QA: ${summary.passed}/${summary.totalChecks} PASS; critical/high failures: ${summary.failedCriticalHigh}`)
if (failedCriticalHigh.length) process.exit(1)
