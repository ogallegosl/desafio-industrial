const store = new Map()
global.window = {
  localStorage: {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
}

const demo = await import('../src/services/localDemoExam.js')

const checks = []
function check(name, condition) {
  checks.push({ name, pass: Boolean(condition) })
  if (!condition) throw new Error(`FAIL: ${name}`)
}

check('Código DEMO2026 reconocido', demo.isLocalDemoCode('demo2026'))
const validated = await demo.demoValidateCode()
check('Examen DEMO expone 15 preguntas', validated.exam.questionCount === 15)
check('Examen DEMO solicita solo apellidos y nombres', validated.exam.requiredFields.studentCode === false && validated.exam.requiredFields.firstName === true && validated.exam.requiredFields.lastName === true)

const prepared = await demo.demoPrepareAttempt({ firstName: 'Alumno', lastName: 'Prueba' })
check('Sesión DEMO local creada', demo.isLocalDemoSession(prepared.sessionToken))
check('Intento inicia preparado', prepared.attempt.status === 'created')

const started = await demo.demoStartAttempt(prepared.sessionToken)
check('Intento inicia en progreso', started.attempt.status === 'in_progress')
check('Deadline creado', Boolean(started.attempt.deadlineAt))

let engine = await demo.demoLoadEngine(prepared.sessionToken)
check('Motor contiene 15 preguntas', engine.questions.length === 15)
check('Incluye pregunta visual', engine.questions.some((q) => q.type === 'image_single_choice' && q.mediaUrl))
check('Incluye cálculo con evidencia', engine.questions.some((q) => q.type === 'calculation_evidence'))
check('Incluye caso con subpreguntas', engine.questions.some((q) => q.type === 'case_group' && q.metadata?.caseSubquestions?.length === 2))
check('Integridad inicia en cero', Number(engine.runtime?.security?.incidentCount || 0) === 0)
for (let i = 0; i < 4; i += 1) await demo.demoRecordSecurityEvent(prepared.sessionToken, { type: 'SECURITY_VISIBILITY_INTERRUPTION', metadata: { durationMs: 1000 + i } })
engine = await demo.demoLoadEngine(prepared.sessionToken)
check('Contador de integridad persiste al recargar/cambiar de vista', Number(engine.runtime?.security?.incidentCount || 0) === 4)

await demo.demoSaveAnswer(prepared.sessionToken, { attemptQuestionId: 'demo-q01', clientRevision: 1, selectedOptionIds: ['q01-b'] })
await demo.demoSaveAnswer(prepared.sessionToken, { attemptQuestionId: 'demo-q03', clientRevision: 2, answerPayload: { value: false } })
await demo.demoSaveAnswer(prepared.sessionToken, { attemptQuestionId: 'demo-q04', clientRevision: 3, answerNumeric: '5' })
await demo.demoSaveAnswer(prepared.sessionToken, { attemptQuestionId: 'demo-q07', clientRevision: 4, answerText: 'dB' })
for (let order = 2; order <= 7; order += 1) await demo.demoNavigate(prepared.sessionToken, order)
engine = await demo.demoLoadEngine(prepared.sessionToken)
check('Autoguardado persiste respuesta', engine.questions.find((q) => q.id === 'demo-q01')?.answer?.selectedOptionIds?.[0] === 'q01-b')
check('Navegación queda persistida', engine.runtime.currentOrder === 7)

const ping = await demo.demoPing(prepared.sessionToken)
check('Heartbeat DEMO responde', ping.attempt.status === 'in_progress' && Boolean(ping.runtime.serverNow))

const submitted = await demo.demoSubmit(prepared.sessionToken, 'STUDENT_SUBMITTED')
check('Entrega cierra el intento', submitted.attempt.status === 'submitted')
check('Genera calificación DEMO', submitted.grading && submitted.grading.rawScore > 0)
check('Incluye detalle de respuestas correctas', Array.isArray(submitted.grading.details) && submitted.grading.details.length === 15)

const results = await demo.demoAccessResults({ firstName: 'Alumno', lastName: 'Prueba' })
check('Resultado puede consultarse localmente', results.grading?.rawScore === submitted.grading.rawScore)

const next = await demo.demoPrepareAttempt({ firstName: 'Alumno', lastName: 'Prueba' })
check('Nuevo ingreso después de entregar crea otro intento', next.attempt.number === 2 && next.attempt.status === 'created')

console.log(`Local DEMO audit: ${checks.filter((x) => x.pass).length}/${checks.length} PASS`)
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}`)
