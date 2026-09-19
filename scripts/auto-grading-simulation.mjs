import assert from 'node:assert/strict'

function normalizeText(value, config = {}) {
  let next = String(value ?? '')
  if (config.trimWhitespace !== false) next = next.trim()
  if (config.collapseWhitespace === true) next = next.replace(/\s+/g, ' ')
  if ((config.mode || 'case_insensitive') === 'case_insensitive') next = next.toLowerCase()
  return next
}

function setEqual(a = [], b = []) {
  const left = [...new Set(a.map(String))].sort()
  const right = [...new Set(b.map(String))].sort()
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function parseFlexibleNumber(value) {
  if (value === '' || value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const raw = String(value).trim().replace(/\s+/g, '')
  if (!raw || (raw.includes(',') && raw.includes('.'))) return null
  const parsed = Number(raw.includes(',') ? raw.replace(',', '.') : raw)
  return Number.isFinite(parsed) ? parsed : null
}

function grade({ type, points = 1, grading = {}, answer = {} }) {
  const answerKey = grading.answerKey || {}
  const config = grading.gradingConfig || {}
  if (['essay', 'image_essay', 'attachment'].includes(type)) return { isCorrect: null, autoScore: 0, needsManual: true }

  let correct = false
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) {
    correct = setEqual(answer.selectedOptionIds || [], grading.correctOptionIds || [])
  } else if (type === 'true_false') {
    correct = typeof answer.answerPayload?.value === 'boolean' && answer.answerPayload.value === answerKey.value
  } else if (type === 'short_text') {
    const candidate = normalizeText(answer.answerText, config)
    correct = (answerKey.answers || []).some((value) => candidate === normalizeText(value, config))
  } else if (['numeric', 'calculation', 'calculation_evidence'].includes(type)) {
    const numeric = parseFlexibleNumber(answer.answerNumeric)
    const mode = config.numericMode || (answerKey.min != null || answerKey.max != null ? 'range' : grading.numericTolerance != null ? 'tolerance' : 'exact')
    if (numeric != null) {
      if (mode === 'range') correct = numeric >= Number(config.min ?? answerKey.min) && numeric <= Number(config.max ?? answerKey.max)
      else if (mode === 'tolerance') correct = Math.abs(numeric - Number(answerKey.value)) <= Number(grading.numericTolerance ?? 0)
      else correct = numeric === Number(answerKey.value)
    }
    const needsManual = type === 'calculation_evidence'
    if (needsManual && Number(answer.answerPayload?.evidenceCount || 0) <= 0) correct = false
    return { isCorrect: correct, autoScore: correct ? points : 0, needsManual, method: mode }
  }
  return { isCorrect: correct, autoScore: correct ? points : 0, needsManual: false }
}

const cases = [
  ['single correct', { type: 'single_choice', points: 2, grading: { correctOptionIds: ['b'] }, answer: { selectedOptionIds: ['b'] } }, 2, true],
  ['single wrong', { type: 'single_choice', points: 2, grading: { correctOptionIds: ['b'] }, answer: { selectedOptionIds: ['a'] } }, 0, false],
  ['multiple exact regardless order', { type: 'multiple_choice', points: 3, grading: { correctOptionIds: ['b', 'd'] }, answer: { selectedOptionIds: ['d', 'b'] } }, 3, true],
  ['multiple partial is wrong', { type: 'multiple_choice', points: 3, grading: { correctOptionIds: ['b', 'd'] }, answer: { selectedOptionIds: ['b'] } }, 0, false],
  ['true false correct', { type: 'true_false', points: 1, grading: { answerKey: { value: false } }, answer: { answerPayload: { value: false } } }, 1, true],
  ['short case insensitive', { type: 'short_text', points: 1, grading: { answerKey: { answers: ['Pareto'] }, gradingConfig: { mode: 'case_insensitive', trimWhitespace: true } }, answer: { answerText: '  PARETO ' } }, 1, true],
  ['short exact fails case', { type: 'short_text', points: 1, grading: { answerKey: { answers: ['Pareto'] }, gradingConfig: { mode: 'exact', trimWhitespace: true } }, answer: { answerText: 'pareto' } }, 0, false],
  ['short collapse spaces', { type: 'short_text', points: 1, grading: { answerKey: { answers: ['control estadístico'] }, gradingConfig: { mode: 'case_insensitive', trimWhitespace: true, collapseWhitespace: true } }, answer: { answerText: 'CONTROL   ESTADÍSTICO' } }, 1, true],
  ['numeric exact point', { type: 'numeric', points: 2, grading: { answerKey: { value: 25.5 }, gradingConfig: { numericMode: 'exact' } }, answer: { answerNumeric: '25.5' } }, 2, true],
  ['numeric exact comma', { type: 'numeric', points: 2, grading: { answerKey: { value: 25.5 }, gradingConfig: { numericMode: 'exact' } }, answer: { answerNumeric: '25,5' } }, 2, true],
  ['numeric tolerance inside', { type: 'numeric', points: 2, grading: { answerKey: { value: 25 }, numericTolerance: 0.5, gradingConfig: { numericMode: 'tolerance' } }, answer: { answerNumeric: 25.49 } }, 2, true],
  ['numeric tolerance boundary', { type: 'numeric', points: 2, grading: { answerKey: { value: 25 }, numericTolerance: 0.5, gradingConfig: { numericMode: 'tolerance' } }, answer: { answerNumeric: 25.5 } }, 2, true],
  ['numeric tolerance outside', { type: 'numeric', points: 2, grading: { answerKey: { value: 25 }, numericTolerance: 0.5, gradingConfig: { numericMode: 'tolerance' } }, answer: { answerNumeric: 25.51 } }, 0, false],
  ['numeric range lower inclusive', { type: 'numeric', points: 2, grading: { answerKey: { min: 24.5, max: 25.5 }, gradingConfig: { numericMode: 'range', min: 24.5, max: 25.5 } }, answer: { answerNumeric: 24.5 } }, 2, true],
  ['numeric range upper inclusive', { type: 'numeric', points: 2, grading: { answerKey: { min: 24.5, max: 25.5 }, gradingConfig: { numericMode: 'range', min: 24.5, max: 25.5 } }, answer: { answerNumeric: 25.5 } }, 2, true],
  ['numeric range outside', { type: 'numeric', points: 2, grading: { answerKey: { min: 24.5, max: 25.5 }, gradingConfig: { numericMode: 'range', min: 24.5, max: 25.5 } }, answer: { answerNumeric: 26 } }, 0, false],
  ['calculation auto', { type: 'calculation', points: 4, grading: { answerKey: { value: 0.82 }, numericTolerance: 0.01, gradingConfig: { numericMode: 'tolerance' } }, answer: { answerNumeric: 0.825 } }, 4, true],
  ['calculation evidence auto + manual flag', { type: 'calculation_evidence', points: 4, grading: { answerKey: { value: 0.82 }, numericTolerance: 0.01, gradingConfig: { numericMode: 'tolerance' } }, answer: { answerNumeric: 0.82, answerPayload: { evidenceCount: 1 } } }, 4, true, true],
  ['calculation evidence missing file', { type: 'calculation_evidence', points: 4, grading: { answerKey: { value: 0.82 }, numericTolerance: 0.01, gradingConfig: { numericMode: 'tolerance' } }, answer: { answerNumeric: 0.82, answerPayload: { evidenceCount: 0 } } }, 0, false, true],
  ['essay manual', { type: 'essay', points: 5, grading: {}, answer: { answerText: 'Desarrollo' } }, 0, null, true],
  ['attachment manual', { type: 'attachment', points: 5, grading: {}, answer: {} }, 0, null, true],
]

for (const [name, input, expectedScore, expectedCorrect, expectedManual = false] of cases) {
  const result = grade(input)
  assert.equal(result.autoScore, expectedScore, `${name}: score`)
  assert.equal(result.isCorrect, expectedCorrect, `${name}: correct`)
  assert.equal(Boolean(result.needsManual), expectedManual, `${name}: manual`)
}

assert.equal(parseFlexibleNumber('1,25'), 1.25)
assert.equal(parseFlexibleNumber('1.25'), 1.25)
assert.equal(parseFlexibleNumber('1,2.5'), null)

const pureAuto = [
  grade({ type: 'single_choice', points: 2, grading: { correctOptionIds: ['1'] }, answer: { selectedOptionIds: ['1'] } }),
  grade({ type: 'numeric', points: 3, grading: { answerKey: { value: 10 }, gradingConfig: { numericMode: 'exact' } }, answer: { answerNumeric: 10 } }),
]
const raw = pureAuto.reduce((sum, item) => sum + item.autoScore, 0)
assert.equal(raw, 5)
assert.equal((raw / 5) * 20, 20)

console.log(JSON.stringify({
  result: 'PASS',
  assertions: cases.length + 5,
  covered: ['single_choice', 'multiple_choice', 'true_false', 'short_text', 'numeric_exact', 'numeric_tolerance', 'numeric_range', 'calculation', 'calculation_evidence', 'manual_review', 'decimal_comma'],
}, null, 2))
