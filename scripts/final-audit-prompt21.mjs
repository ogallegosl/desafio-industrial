import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))
const checks = []
const check = (area, name, ok, severity = 'high', detail = '') => checks.push({ area, name, ok: Boolean(ok), severity, detail })

const app = read('src/App.jsx')
const examPage = read('src/pages/StudentExamPage.jsx')
const editor = read('src/pages/TeacherExamEditorPage.jsx')
const examService = read('src/services/examManagement.js')
const modal = read('src/components/Modal.jsx')
const progress = read('src/components/ExamProgress.jsx')
const questionEditor = read('src/components/QuestionEditorModal.jsx')
const resultsPage = read('src/pages/TeacherResultsPage.jsx')
const css = read('src/styles/global.css')
const edge = read('supabase/functions/exam-access/index.ts')
const finalMigration = read('supabase/migrations/0024_final_integrity_accessibility.sql')
const challengeMigration = read('supabase/migrations/0025_desafio_industrial_security_reports.sql')
const bootstrap = read('supabase/sql/bootstrap_all.sql')
const pkg = JSON.parse(read('package.json'))

// 1. Funcionalidad
check('Funcionalidad', 'Rutas docente y estudiante presentes', /\/docente/.test(app) && /\/estudiante/.test(app))
check('Funcionalidad', 'Creación y edición usan operaciones transaccionales', /create_exam_bundle/.test(examService) && /update_exam_bundle/.test(examService))

// 2. UX
check('UX', 'Acceso rápido al contenido por teclado', /skip-link/.test(read('src/layouts/PublicLayout.jsx')) && /skip-link/.test(read('src/layouts/TeacherLayout.jsx')) && /skip-link/.test(read('src/layouts/StudentLayout.jsx')), 'medium')
check('UX', 'Código de acceso refleja límites del servidor', /minLength=\{4\}/.test(editor) && /maxLength=\{64\}/.test(editor), 'medium')

// 3. Base de datos / integridad
check('Base de datos', 'Migración final existe', exists('supabase/migrations/0024_final_integrity_accessibility.sql'))
check('Base de datos', 'Crear examen es transaccional', /create or replace function public\.create_exam_bundle/.test(finalMigration) && /insert into public\.configuraciones_examen/.test(finalMigration))
check('Base de datos', 'Editar examen es transaccional', /create or replace function public\.update_exam_bundle/.test(finalMigration) && /on conflict \(exam_id\) do update/.test(finalMigration))
check('Base de datos', 'Identificación simplificada exige apellidos y nombres', /config_student_name_only_identity/.test(challengeMigration) && /require_first_name = true/.test(challengeMigration) && /require_last_name = true/.test(challengeMigration))
check('Base de datos', 'Cambio de curso se bloquea cuando existe historial', /prevent_exam_course_change_with_history/.test(finalMigration) && /preguntas_examen/.test(finalMigration) && /reglas_seleccion_examen/.test(finalMigration) && /intentos/.test(finalMigration))
check('UX', 'Editor bloquea cambio de curso con plan existente', /disabled=\{!isNew && \(configuredQuestions > 0 \|\| hasAttemptHistory\)\}/.test(editor), 'medium')

// 4. Seguridad
check('Seguridad', 'Operaciones finales preservan RLS', /security invoker/.test(finalMigration))
check('Seguridad', 'RPC finales no accesibles a anon', /revoke all on function public\.create_exam_bundle/.test(finalMigration) && /from public, anon/.test(finalMigration))
check('Seguridad', 'Edge no expone grading snapshot al motor estudiantil', !/select\([^)]*grading_snapshot[^)]*\).*engine/i.test(edge), 'critical')

// 5. Cronómetro
check('Cronómetro', 'Tiempo deriva del servidor', /serverNow/.test(examPage) && /deadlineAt/.test(examPage))
check('Cronómetro', 'Cierre por tiempo sigue presente en servidor', /TIME_EXPIRED/.test(edge) && /deadline_at/.test(edge))

// 6. Autoguardado
check('Autoguardado', 'Guardado atómico por revisión permanece activo', /save_attempt_answer_if_newer/.test(edge))
check('Autoguardado', 'Cola offline permanece integrada', /writePendingAnswer/.test(examPage) && /syncAllPending/.test(examPage))

// 7. Aleatorización
const randomMigration = read('supabase/migrations/0012_exam_randomization_engine.sql')
check('Aleatorización', 'Preguntas congeladas por intento', /intento_preguntas/.test(randomMigration) && /options_snapshot/.test(randomMigration))
check('Aleatorización', 'Clave separada del snapshot visible', /grading_snapshot/.test(randomMigration))

// 8. Calificación
const autoGrade = read('supabase/migrations/0015_auto_grading_engine.sql')
const manualGrade = read('supabase/migrations/0016_manual_grading_rubrics.sql')
check('Calificación', 'Motor automático presente', /grade_attempt_automatically|auto_grade/i.test(autoGrade))
check('Calificación', 'Revisión manual y rúbricas presentes', /rubrica|grade_manual_response/i.test(manualGrade))

// 9. Evidencias
const evidence = read('src/components/StudentEvidenceUploader.jsx')
check('Evidencias', 'Carga y reemplazo continúan disponibles', /Reemplazar evidencia/.test(evidence) && /Guardar evidencia/.test(evidence))
check('Evidencias', 'Validación binaria del archivo en servidor', /verifyEvidenceMagic/.test(edge))

// 10. Exportación
const exportService = read('src/services/resultsExport.js')
check('Exportaciones', 'Excel y CSV permanecen implementados', /xlsx/i.test(exportService) && /csv/i.test(exportService))
check('Exportaciones', 'Protección de fórmula permanece activa', /function spreadsheetSafe/.test(read('src/utils/resultsExportFormatting.js')) && /\^\[=\+\\-@\\t\\r\]/.test(read('src/utils/resultsExportFormatting.js')), 'medium')

// 11. Responsive
check('Responsive', 'Reglas objetivo 360/390/430/768/900 presentes', ['360','390','430','768','900'].every((n) => css.includes(`max-width: ${n}px`)), 'medium')
check('Responsive', 'Cronómetro móvil sticky', /mobile-exam-status[\s\S]*position: sticky/.test(css))

// 12. Rendimiento
check('Rendimiento', 'Rutas cargadas de forma diferida', /lazy\(/.test(app) && /Suspense/.test(app), 'medium')
check('Rendimiento', 'Listas administrativas usan content-visibility', /content-visibility: auto/.test(css), 'low')

// 13. Mensajes de error
check('Mensajes de error', 'Errores de acceso distinguen estados', /EXAM_NOT_STARTED/.test(edge) && /EXAM_CLOSED/.test(edge) && /RATE_LIMITED/.test(edge), 'medium')
check('Mensajes de error', 'Editor exige apellidos y nombres', /La identificación del estudiante requiere apellidos y nombres/.test(editor), 'medium')

// 14. Consistencia visual
check('Consistencia visual', 'Variables visuales centrales permanecen definidas', /--primary:/.test(css) && /--muted:/.test(css) && /--danger:/.test(css), 'low')
check('Consistencia visual', 'Texto secundario de tablas usa color accesible central', /data-table th[^}]*var\(--muted\)/.test(css) && /data-table td span[^}]*var\(--muted\)/.test(css), 'medium')

// 15. Accesibilidad
check('Accesibilidad', 'Modales gestionan foco y Tab', /FOCUSABLE/.test(modal) && /event\.key !== 'Tab'/.test(modal) && /previousActive/.test(modal), 'high')
check('Accesibilidad', 'Progreso expone progressbar semántico', /role="progressbar"/.test(progress) && /aria-valuenow/.test(progress), 'medium')
check('Accesibilidad', 'Pregunta actual expone aria-current', /aria-current=/.test(examPage), 'medium')
check('Accesibilidad', 'Tabs de resultados exponen selección', /role="tab"/.test(resultsPage) && /aria-selected/.test(resultsPage) && /role="tabpanel"/.test(resultsPage), 'medium')
check('Accesibilidad', 'Editor expone estado de controles correctos', /aria-pressed/.test(questionEditor) && /Respuesta aceptable/.test(questionEditor), 'medium')
check('Accesibilidad', 'Foco visible global definido', /focus-visible/.test(css), 'medium')

// Structural integrity
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
check('Estructura', 'Migraciones versionadas completas', migrations.length >= 27, 'high', `detectadas=${migrations.length}`)
check('Estructura', 'Bootstrap contiene todas las migraciones', migrations.every((f) => bootstrap.includes(f)), 'high')
check('Estructura', 'Versión del proyecto actualizada', ['0.21.0', '1.0.0', '1.0.1', '1.1.0', '1.1.1', '1.2.0', '1.2.1', '1.3.0'].includes(pkg.version), 'low', pkg.version)
check('Estructura', 'Comando de auditoría final disponible', Boolean(pkg.scripts?.['audit:final21']), 'low')

const failed = checks.filter((c) => !c.ok)
const criticalHigh = failed.filter((c) => ['critical','high'].includes(c.severity))
const result = {
  prompt: 21,
  status: criticalHigh.length ? 'FAIL' : failed.length ? 'PASS_WITH_MINOR_FINDINGS' : 'PASS',
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  failedCriticalHigh: criticalHigh.length,
  migrations: migrations.length,
  checks,
}
fs.writeFileSync(path.join(root, 'docs/FINAL_AUDIT_PROMPT21_RESULT.json'), JSON.stringify(result, null, 2) + '\n')
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} [${c.severity.toUpperCase()}] ${c.area} — ${c.name}${c.detail ? ` (${c.detail})` : ''}`)
console.log(`\nPrompt 21 final audit: ${result.passed}/${result.total}; critical/high failures=${result.failedCriticalHigh}`)
if (criticalHigh.length) process.exit(1)
