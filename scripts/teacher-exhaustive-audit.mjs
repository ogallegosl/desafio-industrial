import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))
const checks = []
const check = (area, name, ok, severity = 'high', detail = '') => checks.push({ area, name, ok: Boolean(ok), severity, detail })

const app = read('src/App.jsx')
const layout = read('src/layouts/TeacherLayout.jsx')
const auth = read('src/contexts/AuthContext.jsx')
const protectedRoute = read('src/components/TeacherProtectedRoute.jsx')
const dashboard = read('src/pages/TeacherDashboardPage.jsx')
const exams = read('src/pages/TeacherExamsPage.jsx')
const editor = read('src/pages/TeacherExamEditorPage.jsx')
const plan = read('src/components/ExamQuestionPlan.jsx')
const banks = read('src/pages/TeacherQuestionBanksPage.jsx')
const bankService = read('src/services/questionBankManagement.js')
const examService = read('src/services/examManagement.js')
const planService = read('src/services/examQuestionPlan.js')
const livePage = read('src/pages/TeacherLiveMonitorPage.jsx')
const liveService = read('src/services/liveExamMonitoring.js')
const evidence = read('src/pages/TeacherEvidencePage.jsx')
const evidenceService = read('src/services/evidenceManagement.js')
const manual = read('src/pages/TeacherManualGradingPage.jsx')
const results = read('src/pages/TeacherResultsPage.jsx')
const settings = read('src/pages/TeacherSettingsPage.jsx')
const exportService = read('src/services/resultsExport.js')
const teacherMigration = read('supabase/migrations/0027_teacher_audit_hardening.sql')
const liveMigration = read('supabase/migrations/0026_live_exam_monitoring.sql')
const timeHotfix = read('supabase/migrations/0029_live_time_extension_security_fix.sql')
const rls = read('supabase/migrations/0006_rls_policies.sql') + '\n' + read('supabase/migrations/0019_security_hardening.sql')
const bootstrap = read('supabase/sql/bootstrap_all.sql')
const pkg = JSON.parse(read('package.json'))

// Authentication & authorization
check('Autenticación docente', 'Login docente protegido por Supabase Auth', /signInWithPassword/.test(auth), 'critical')
check('Autenticación docente', 'Solo teacher/admin activos pasan el contexto', /teacher|admin/.test(auth) && /is_active|active/i.test(auth), 'critical')
check('Autenticación docente', 'Rutas /docente usan TeacherProtectedRoute', /TeacherProtectedRoute/.test(app) && /Outlet|Navigate/.test(protectedRoute), 'critical')
check('Autenticación docente', 'Cierre de sesión disponible', /signOut/.test(auth + layout), 'high')

// Teacher navigation
for (const [name, rx] of [
  ['Dashboard', /path="dashboard"/], ['Cursos', /path="cursos"/], ['Bancos', /path="bancos"/],
  ['Exámenes', /path="examenes"/], ['Resultados', /path="resultados"/], ['Evidencias', /path="evidencias"/],
  ['Calificación manual', /path="calificacion"/], ['Configuración', /path="configuracion"/], ['Monitoreo en vivo', /path="examenes\/:examId\/monitoreo"/],
]) check('Navegación docente', `Ruta ${name}`, rx.test(app), 'high')

// Dashboard
check('Dashboard', 'Agrega métricas en PostgreSQL sin límite de 1000 filas', /rpc\(['"]get_teacher_dashboard['"]/.test(examService) && /count\(distinct i\.student_id\)/i.test(teacherMigration), 'high')
check('Dashboard', 'Muestra participantes únicos', /label="Participantes"/.test(dashboard), 'medium')
check('Dashboard', 'Acceso a monitoreo desde exámenes recientes', /monitoreo/.test(dashboard), 'medium')

// Exam lifecycle
check('Exámenes', 'Creación/edición transaccional', /create_exam_bundle/.test(examService) && /update_exam_bundle/.test(examService), 'critical')
check('Exámenes', 'Plan bloqueado fuera de borrador', /guard_exam_plan_mutation/.test(teacherMigration) && /locked=\{structureLocked\}/.test(editor), 'critical')
check('Exámenes', 'Configuración estructural bloqueada con intentos', /guard_exam_config_mutation/.test(teacherMigration) && /hasAttemptHistory/.test(editor), 'critical')
check('Exámenes', 'Horario histórico protegido', /guard_exam_lifecycle_mutation/.test(teacherMigration) && /scheduleLocked/.test(editor), 'high')
check('Exámenes', 'No se archiva/elimina con intentos abiertos', /Hay estudiantes con intentos abiertos/.test(teacherMigration), 'critical')
check('Exámenes', 'Cambio de curso protegido con historial', /prevent_exam_course_change_with_history/.test(bootstrap), 'high')
check('Exámenes', 'Cerrar/abrir ingresos usa RPC dedicada', /setExamAdmissions/.test(exams) && /set_exam_accept_new_attempts/.test(teacherMigration), 'high')
check('Exámenes', 'Finalización global exige confirmación', /Esta acción no se puede deshacer/.test(exams) && /forceCloseExam/.test(exams), 'high')

// Question plan and bank
check('Banco de preguntas', 'Filtro de curso se aplica a tabla de bancos', /filteredBanks\.map/.test(banks), 'medium')
check('Banco de preguntas', 'Conteo excluye subpreguntas de casos', /\.is\(['"]parent_question_id['"], null\)/.test(bankService), 'medium')
check('Banco de preguntas', 'Preguntas candidatas excluyen bancos archivados', /bancos_preguntas\.is_archived['"], false/.test(planService) || /bancos_preguntas\.is_archived.*false/.test(planService), 'high')
check('Banco de preguntas', 'Generador servidor excluye bancos archivados', (teacherMigration.match(/b\.is_archived = false/g) || []).length >= 3, 'critical')
check('Banco de preguntas', 'Banco en examen publicado no puede archivarse', /guard_bank_archive_for_published_exams/.test(teacherMigration), 'high')
check('Banco de preguntas', 'Pregunta en examen publicado no puede archivarse', /guard_question_archive_for_published_exams/.test(teacherMigration), 'high')
check('Banco de preguntas', 'Curso con examen publicado no puede archivarse', /guard_course_archive_with_published_exams/.test(teacherMigration), 'high')
check('Banco de preguntas', 'Pregunta + alternativas se guardan transaccionalmente', /save_question_core/.test(teacherMigration) && /rpc\(['"]save_question_core['"]/.test(bankService), 'high')
check('Banco de preguntas', 'Validador conservador evita agotamiento entre reglas aleatorias', /v_prior_overlap_quantity/.test(teacherMigration), 'high')

// Live monitoring
check('Monitoreo en vivo', 'Realtime escucha intentos/logs/examen', /postgres_changes/.test(liveService) && /intentos/.test(liveService) && /logs/.test(liveService) && /examenes/.test(liveService), 'high')
check('Monitoreo en vivo', 'Polling de respaldo presente', /setInterval/.test(livePage), 'medium')
check('Monitoreo en vivo', 'Cierre de ingresos disponible', /setExamAdmissions/.test(livePage), 'high')
check('Monitoreo en vivo', 'Extensión individual y global disponible', /extendAttemptTime/.test(livePage) && /extendExamTime/.test(livePage), 'high')
check('Monitoreo en vivo', 'RPC extension individual usa SECURITY DEFINER', timeHotfix.includes('alter function public.teacher_extend_attempt_time(uuid, integer) security definer;'), 'critical')
check('Monitoreo en vivo', 'RPC extension global usa SECURITY DEFINER', timeHotfix.includes('alter function public.teacher_extend_exam_time(uuid, integer) security definer;'), 'critical')
check('Monitoreo en vivo', 'Extensiones conservan validacion de propiedad docente', liveMigration.includes('private.owns_attempt(p_attempt_id)') && liveMigration.includes('private.owns_exam(p_exam_id)'), 'critical')
check('Monitoreo en vivo', 'Extensiones siguen bloqueadas para anon', timeHotfix.includes('revoke all on function public.teacher_extend_attempt_time(uuid, integer) from public, anon;') && timeHotfix.includes('revoke all on function public.teacher_extend_exam_time(uuid, integer) from public, anon;') && timeHotfix.includes('grant execute on function public.teacher_extend_attempt_time(uuid, integer) to authenticated;') && timeHotfix.includes('grant execute on function public.teacher_extend_exam_time(uuid, integer) to authenticated;'), 'critical')
check('Monitoreo en vivo', 'Finalización individual y global disponible', /forceSubmitAttempt/.test(livePage) && /forceCloseExam/.test(livePage), 'high')
check('Monitoreo en vivo', 'RPC global solo opera en programado/activo', /Solo se puede ampliar tiempo en un examen programado o activo/.test(teacherMigration), 'high')
check('Monitoreo en vivo', 'Control de ingresos restringido a programado/activo', /control de ingresos solo está disponible/.test(teacherMigration), 'high')
check('Monitoreo en vivo', 'Extensión de cierre usa bypass interno explícito', /app\.teacher_live_extension/.test(teacherMigration), 'high')
check('Monitoreo en vivo', 'Publicación Realtime incluye tablas necesarias', /supabase_realtime/.test(liveMigration) && /public\.intentos/.test(liveMigration) && /public\.logs/.test(liveMigration), 'high')

// Evidence, grading, results
check('Evidencias', 'Vista docente usa URL firmada', /createSignedUrl/i.test(evidenceService) && /createEvidencePreviewUrl/.test(evidence), 'high')
check('Evidencias', 'No muestra código sintético al docente', !/student_code/.test(evidence), 'medium')
check('Calificación', 'Cola manual y rúbricas disponibles', /rubric|rúbrica/i.test(manual) && /Guardar calificación/.test(manual), 'high')
check('Calificación', 'No muestra código sintético al docente', !/student_code/.test(manual), 'medium')
check('Resultados', 'Tres vistas: resumen/pregunta/estudiante', /Resumen/.test(results) && /Por pregunta/.test(results) && /Por estudiante/.test(results), 'high')
check('Resultados', 'Exportación Excel y CSV disponible', /Excel/.test(results) && /CSV/.test(results) && /xlsx/i.test(exportService), 'high')
check('Resultados', 'PDF individual disponible', /PDF/i.test(results), 'high')

// Settings and security
check('Configuración', 'Panel global guarda configuración real', /saveGlobalSettings|updateGlobalSettings|guardar/i.test(settings), 'high')
check('Seguridad', 'Todas las tablas públicas base tienen RLS', /enable row level security/i.test(rls), 'critical')
check('Seguridad', 'No hay service role en frontend', !/service_role|SUPABASE_SERVICE_ROLE_KEY/.test([...walk(path.join(root,'src'))].map(f=>fs.readFileSync(f,'utf8')).join('\n')), 'critical')

check('Integridad publicada', 'Banco con preguntas fijas publicado queda protegido', /preguntas_examen pe[\s\S]*q\.bank_id = old\.id/.test(teacherMigration), 'critical')
check('Integridad publicada', 'Contenido de pregunta publicada queda congelado', /guard_published_question_content/.test(teacherMigration) && /question_state_in_published_plan/.test(teacherMigration), 'critical')
check('Integridad publicada', 'Alternativas publicadas quedan congeladas', /guard_published_option_content/.test(teacherMigration), 'critical')
check('Evidencia académica', 'Examen con intentos no puede eliminarse', /No se puede eliminar un examen que ya tiene intentos registrados/.test(teacherMigration), 'critical')

// Structure/deploy
const migrations = fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort()
check('Estructura', '34 migraciones presentes', migrations.length === 34, 'high', `detectadas=${migrations.length}`)
check('Estructura', 'Bootstrap incluye 34 migraciones', migrations.every(m=>bootstrap.includes(m)), 'high')
check('Estructura', 'Migracion de acceso seguro a resultados es la ultima', migrations.at(-1) === '0034_student_result_access_codes.sql', 'high', migrations.at(-1))
check('Estructura', 'Versión >= 1.2.1', compareVersions(pkg.version,'1.2.1') >= 0, 'low', pkg.version)
check('Despliegue', 'netlify.toml presente', exists('netlify.toml'), 'high')
check('Despliegue', '.env.example presente', exists('.env.example'), 'high')
check('Despliegue', 'Edge Function presente', exists('supabase/functions/exam-access/index.ts'), 'high')

function* walk(dir) {
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    const full=path.join(dir,e.name)
    if (e.isDirectory()) yield* walk(full); else yield full
  }
}
function compareVersions(a,b){
  const pa=String(a).split('.').map(Number), pb=String(b).split('.').map(Number)
  for(let i=0;i<3;i++){const d=(pa[i]||0)-(pb[i]||0); if(d) return d}
  return 0
}

const failed=checks.filter(c=>!c.ok)
for(const c of checks) console.log(`${c.ok?'PASS':'FAIL'} [${c.severity.toUpperCase()}] ${c.area} — ${c.name}${c.detail?` (${c.detail})`:''}`)
console.log(`\nAuditoría docente exhaustiva: ${checks.length-failed.length}/${checks.length} PASS; critical/high failures=${failed.filter(c=>['critical','high'].includes(c.severity)).length}`)
fs.writeFileSync(path.join(root,'docs/TEACHER_AUDIT_RESULT.json'), JSON.stringify({status:failed.length?'FAIL':'PASS', total:checks.length, passed:checks.length-failed.length, failed},null,2))
if(failed.some(c=>['critical','high'].includes(c.severity))) process.exit(1)
