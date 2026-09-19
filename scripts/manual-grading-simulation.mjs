import assert from 'node:assert/strict'

function rubricValid(criteria, questionMax) {
  if (!criteria.length) return false
  let max = 0
  let score = 0
  for (const item of criteria) {
    const itemMax = Number(item.maxPoints)
    const itemScore = Number(item.score)
    if (!item.name || !(itemMax > 0) || itemScore < 0 || itemScore > itemMax) return false
    max += itemMax
    score += itemScore
  }
  return Math.abs(max - questionMax) <= 0.001 ? { score, max } : false
}

function recalc(rows, scale = 20) {
  const pending = rows.filter((r) => r.reviewStatus === 'pending').length
  const autoScore = rows.reduce((sum, r) => sum + (r.reviewStatus === 'reviewed' ? 0 : (r.autoScore || 0)), 0)
  const manualScore = rows.reduce((sum, r) => sum + (r.reviewStatus === 'reviewed' ? (r.manualScore || 0) : 0), 0)
  const raw = rows.reduce((sum, r) => sum + (r.reviewStatus === 'reviewed' ? (r.manualScore || 0) : (r.autoScore || 0)), 0)
  const max = rows.reduce((sum, r) => sum + r.max, 0)
  const finalGrade = pending === 0 ? (max > 0 ? Math.round((Math.min(raw, max) / max) * scale * 1000) / 1000 : 0) : null
  return { pending, autoScore, manualScore, raw: Math.min(raw, max), max, finalGrade }
}

// 1-5 rubric validation.
assert.deepEqual(rubricValid([{ name:'Procedimiento', maxPoints:2, score:1.5 }, { name:'Resultado', maxPoints:3, score:2.5 }], 5), { score:4, max:5 })
assert.equal(rubricValid([{ name:'A', maxPoints:2, score:2 }], 5), false)
assert.equal(rubricValid([{ name:'', maxPoints:5, score:5 }], 5), false)
assert.equal(rubricValid([{ name:'A', maxPoints:5, score:6 }], 5), false)
assert.equal(rubricValid([{ name:'A', maxPoints:5, score:-1 }], 5), false)

// 6-10 pending review keeps grade provisional.
let state = recalc([
  { reviewStatus:'not_required', autoScore:4, manualScore:null, max:4 },
  { reviewStatus:'pending', autoScore:2, manualScore:null, max:3 },
  { reviewStatus:'pending', autoScore:0, manualScore:null, max:3 },
], 20)
assert.equal(state.pending, 2)
assert.equal(state.autoScore, 6)
assert.equal(state.manualScore, 0)
assert.equal(state.raw, 6)
assert.equal(state.finalGrade, null)

// 11-15 a manual review replaces the automatic preliminary score.
state = recalc([
  { reviewStatus:'not_required', autoScore:4, manualScore:null, max:4 },
  { reviewStatus:'reviewed', autoScore:2, manualScore:2.5, max:3 },
  { reviewStatus:'pending', autoScore:0, manualScore:null, max:3 },
], 20)
assert.equal(state.pending, 1)
assert.equal(state.autoScore, 4)
assert.equal(state.manualScore, 2.5)
assert.equal(state.raw, 6.5)
assert.equal(state.finalGrade, null)

// 16-20 closing the last pending answer produces a final grade.
state = recalc([
  { reviewStatus:'not_required', autoScore:4, manualScore:null, max:4 },
  { reviewStatus:'reviewed', autoScore:2, manualScore:2.5, max:3 },
  { reviewStatus:'reviewed', autoScore:0, manualScore:2, max:3 },
], 20)
assert.equal(state.pending, 0)
assert.equal(state.autoScore, 4)
assert.equal(state.manualScore, 4.5)
assert.equal(state.raw, 8.5)
assert.equal(state.max, 10)
assert.equal(state.finalGrade, 17)

// 21-24 re-review changes the final grade without double counting.
state = recalc([
  { reviewStatus:'not_required', autoScore:4, max:4 },
  { reviewStatus:'reviewed', autoScore:2, manualScore:3, max:3 },
  { reviewStatus:'reviewed', autoScore:0, manualScore:3, max:3 },
], 20)
assert.equal(state.raw, 10)
assert.equal(state.autoScore, 4)
assert.equal(state.manualScore, 6)
assert.equal(state.finalGrade, 20)

console.log(JSON.stringify({
  rubricValidationChecks: 5,
  provisionalGradeChecks: 5,
  manualReplacementChecks: 5,
  finalGradeChecks: 5,
  reReviewChecks: 4,
  totalChecks: 24,
  status: 'PASS',
}, null, 2))
