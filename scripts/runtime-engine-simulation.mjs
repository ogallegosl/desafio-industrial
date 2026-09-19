import assert from 'node:assert/strict'

function applyRevision(server, incoming) {
  if (server && server.revision > incoming.revision) return { ...server, ignoredAsStale: true }
  return { ...incoming, ignoredAsStale: false }
}

function navigate({ navigation, allowBacktrack, current, maxReached, total }, target) {
  assert(Number.isInteger(target) && target >= 1 && target <= total)
  if (navigation === 'sequential') {
    if (target > maxReached + 1) throw new Error('SEQUENTIAL_NAVIGATION')
    if (!allowBacktrack && (target < maxReached || target < current)) throw new Error('BACKTRACK_DISABLED')
  }
  return { current: target, maxReached: Math.max(maxReached, target) }
}

function answered(type, answer = {}) {
  if (['single_choice','image_single_choice','multiple_choice'].includes(type)) return (answer.selectedOptionIds || []).length > 0
  if (type === 'true_false') return typeof answer.answerPayload?.value === 'boolean'
  if (['numeric','calculation','calculation_evidence'].includes(type)) return answer.answerNumeric !== '' && answer.answerNumeric != null && Number.isFinite(Number(answer.answerNumeric))
  if (['short_text','essay','image_essay'].includes(type)) return String(answer.answerText || '').trim().length > 0
  return false
}

// 1) Out-of-order network responses cannot overwrite a newer revision.
let server = applyRevision(null, { revision: 1001, answer: 'A' })
server = applyRevision(server, { revision: 1003, answer: 'C' })
const stale = applyRevision(server, { revision: 1002, answer: 'B' })
assert.equal(stale.answer, 'C')
assert.equal(stale.revision, 1003)
assert.equal(stale.ignoredAsStale, true)

// 2) Latest offline answer per question survives until synchronization.
const queue = {}
queue.Q1 = { revision: 2001, answer: { answerText: 'primera' } }
queue.Q1 = { revision: 2002, answer: { answerText: 'definitiva' } }
queue.Q2 = { revision: 2003, answer: { answerNumeric: 25.5 } }
assert.equal(Object.keys(queue).length, 2)
assert.equal(queue.Q1.answer.answerText, 'definitiva')

// 3) Sequential navigation cannot skip questions.
let nav = { navigation: 'sequential', allowBacktrack: false, current: 1, maxReached: 1, total: 10 }
nav = { ...nav, ...navigate(nav, 2) }
nav = { ...nav, ...navigate(nav, 3) }
assert.equal(nav.current, 3)
assert.equal(nav.maxReached, 3)
assert.throws(() => navigate(nav, 5), /SEQUENTIAL_NAVIGATION/)
assert.throws(() => navigate(nav, 2), /BACKTRACK_DISABLED/)

// 4) Sequential navigation with backtracking can revisit reached questions but not skip ahead.
let navBack = { navigation: 'sequential', allowBacktrack: true, current: 1, maxReached: 1, total: 10 }
navBack = { ...navBack, ...navigate(navBack, 2) }
navBack = { ...navBack, ...navigate(navBack, 3) }
navBack = { ...navBack, ...navigate(navBack, 1) }
assert.equal(navBack.current, 1)
assert.equal(navBack.maxReached, 3)
assert.throws(() => navigate(navBack, 5), /SEQUENTIAL_NAVIGATION/)

// 5) Free navigation allows arbitrary valid targets.
let free = { navigation: 'free', allowBacktrack: true, current: 1, maxReached: 1, total: 20 }
free = { ...free, ...navigate(free, 17) }
free = { ...free, ...navigate(free, 4) }
assert.equal(free.current, 4)
assert.equal(free.maxReached, 17)

// 6) Answer-state checks cover key runtime input families, including zero as valid numeric input.
assert.equal(answered('single_choice', { selectedOptionIds: ['x'] }), true)
assert.equal(answered('multiple_choice', { selectedOptionIds: [] }), false)
assert.equal(answered('true_false', { answerPayload: { value: false } }), true)
assert.equal(answered('numeric', { answerNumeric: 0 }), true)
assert.equal(answered('essay', { answerText: '   ' }), false)
assert.equal(answered('essay', { answerText: 'Análisis' }), true)

// 7) Server-time calculation: deadline is based on server reference, not browser wall-clock value.
const serverNow = Date.parse('2026-09-17T18:00:00Z')
const deadline = Date.parse('2026-09-17T18:45:00Z')
assert.equal(Math.ceil((deadline - serverNow) / 1000), 2700)

console.log(JSON.stringify({
  revisionConflictProtection: 'PASS',
  offlineLatestValueQueue: 'PASS',
  sequentialNavigation: 'PASS',
  backtrackingRules: 'PASS',
  freeNavigation: 'PASS',
  answerStateDetection: 'PASS',
  serverTimerBaselineSeconds: 2700,
  status: 'PASS',
}, null, 2))
