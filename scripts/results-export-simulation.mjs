import assert from 'node:assert/strict'
import {
  buildDetailRows,
  buildGeneralRows,
  formatCorrectResponse,
  formatResponse,
  secondsToClock,
} from '../src/utils/resultsExportFormatting.js'

const exam = { title: 'Parcial de Seguridad', cursos: { name: 'Ingeniería de Seguridad' } }
const students = [{
  studentCode: '2026001', lastName: 'Torres', firstName: 'Ana', email: 'ana@example.edu', section: 'A',
  attemptNumber: 1, status: 'submitted', startedAt: '2026-09-17T14:00:00Z', submittedAt: '2026-09-17T14:40:30Z',
  deadlineAt: '2026-09-17T14:45:00Z', elapsedSeconds: 2430, correct: 8, incorrect: 1, omitted: 1,
  autoScore: 14, manualScore: 2, rawScore: 16, maxRawScore: 20, finalGrade: 16, pendingManualReviews: 0,
}]

const options = [
  { id: 'o1', content: 'Lux', displayOrder: 1 },
  { id: 'o2', content: 'dB', displayOrder: 2 },
  { id: 'o3', content: 'Hz', displayOrder: 3 },
]

const details = [
  {
    studentCode: '2026001', lastName: 'Torres', firstName: 'Ana', email: 'ana@example.edu', section: 'A', attemptNumber: 1,
    questionOrder: 1, type: 'single_choice', prompt: 'Unidad del nivel sonoro', points: 2, options,
    grading: { correctOptionIds: ['o2'] }, selectedOptionIds: ['o2'], answerPayload: {}, isAnswered: true, isCorrect: true,
    autoScore: 2, manualScore: null, effectiveScore: 2, reviewStatus: 'not_required', evidenceFiles: [],
  },
  {
    studentCode: '2026001', lastName: 'Torres', firstName: 'Ana', email: 'ana@example.edu', section: 'A', attemptNumber: 1,
    questionOrder: 2, type: 'numeric', prompt: 'Calcule la dosis', points: 2, options: [],
    grading: { answerKey: { value: 50 }, numericTolerance: 2, gradingConfig: { numericMode: 'tolerance' } },
    answerNumeric: 49.5, answerPayload: {}, isAnswered: true, isCorrect: true, autoScore: 2, effectiveScore: 2,
    reviewStatus: 'not_required', evidenceFiles: [],
  },
  {
    studentCode: '2026001', lastName: 'Torres', firstName: 'Ana', email: 'ana@example.edu', section: 'A', attemptNumber: 1,
    questionOrder: 3, type: 'calculation_evidence', prompt: 'Índice NIOSH', points: 4, options: [],
    grading: { answerKey: { value: 1.2 }, numericTolerance: 0.1, gradingConfig: { numericMode: 'tolerance', requireEvidence: true } },
    answerNumeric: 1.18, answerPayload: { evidenceCount: 1 }, isAnswered: true, isCorrect: true, autoScore: 4, manualScore: 3.5,
    effectiveScore: 3.5, reviewStatus: 'reviewed', teacherFeedback: 'Procedimiento correcto.', evidenceFiles: [{ filename: 'calculo.jpg' }],
  },
]

assert.equal(secondsToClock(2430), '00:40:30')
assert.equal(formatResponse(details[0]), 'B. dB')
assert.equal(formatCorrectResponse(details[0]), 'B. dB')
assert.equal(formatResponse(details[1]), '49.5')
assert.equal(formatCorrectResponse(details[1]), '50 ± 2')
assert.match(formatResponse(details[2]), /calculo\.jpg/)
assert.match(formatCorrectResponse(details[2]), /Evidencia requerida/)

const general = buildGeneralRows({ exam, students })
assert.equal(general.length, 1)
assert.equal(general[0].Curso, 'Ingeniería de Seguridad')
assert.equal(general[0].Examen, 'Parcial de Seguridad')
assert.equal(general[0]['Tiempo utilizado'], '00:40:30')
assert.equal(general[0]['Puntaje total'], 16)
assert.equal(general[0].Nota, 16)
assert.ok(general[0].Inicio instanceof Date)
assert.ok(general[0].Fin instanceof Date)

const detail = buildDetailRows({ details })
assert.equal(detail.length, 3)
assert.equal(detail[0].Alumno, 'Torres, Ana')
assert.equal(detail[0]['Respuesta correcta'], 'B. dB')
assert.equal(detail[2].Puntaje, 3.5)
assert.equal(detail[2].Retroalimentación, 'Procedimiento correcto.')
assert.equal(detail[2].Revisión, 'Revisada')

console.log(JSON.stringify({
  status: 'PASS',
  checks: 18,
  generalRows: general.length,
  detailRows: detail.length,
  sampleGeneral: general[0],
  sampleDetail: detail[0],
}, null, 2))
