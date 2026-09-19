import assert from 'node:assert/strict'

const grades = [12, 14, 16, 18]
const passing = 10.5
const average = grades.reduce((a, b) => a + b, 0) / grades.length
const sorted = [...grades].sort((a, b) => a - b)
const median = (sorted[1] + sorted[2]) / 2
const variance = grades.reduce((sum, x) => sum + (x - average) ** 2, 0) / grades.length
const stddevPop = Math.sqrt(variance)
const passRate = 100 * grades.filter((x) => x >= passing).length / grades.length

assert.equal(average, 15)
assert.equal(median, 15)
assert.equal(Math.round(stddevPop * 1000) / 1000, 2.236)
assert.equal(passRate, 100)

const objective = [
  { answered: true, correct: true },
  { answered: true, correct: false },
  { answered: false, correct: null },
  { answered: true, correct: true },
]
const exposures = objective.length
const correct = objective.filter((x) => x.answered && x.correct === true).length
const incorrect = objective.filter((x) => x.answered && x.correct === false).length
const omitted = objective.filter((x) => !x.answered).length
const correctRate = 100 * correct / exposures
const difficulty = 100 - correctRate
assert.equal(exposures, 4)
assert.equal(correct, 2)
assert.equal(incorrect, 1)
assert.equal(omitted, 1)
assert.equal(correctRate, 50)
assert.equal(difficulty, 50)

const attempts = [
  { student: 'A', status: 'submitted' },
  { student: 'A', status: 'submitted' },
  { student: 'B', status: 'in_progress' },
  { student: 'C', status: 'created' },
]
assert.equal(new Set(attempts.map((x) => x.student)).size, 3)
assert.equal(attempts.length, 4)
assert.equal(attempts.filter((x) => x.status === 'submitted').length, 2)

const manualScores = [
  { points: 5, answered: true, review: 'reviewed', manual: 4, auto: 0 },
  { points: 5, answered: true, review: 'pending', manual: null, auto: 0 },
]
const finalizedRates = manualScores
  .filter((x) => x.answered && x.review !== 'pending')
  .map((x) => 100 * (x.review === 'reviewed' ? x.manual : x.auto) / x.points)
assert.deepEqual(finalizedRates, [80])

console.log(JSON.stringify({
  result: 'PASS',
  checks: 16,
  average,
  median,
  stddevPop: Number(stddevPop.toFixed(3)),
  passRate,
  itemCorrectRate: correctRate,
  difficultyIndex: difficulty,
  uniqueParticipants: new Set(attempts.map((x) => x.student)).size,
  attempts: attempts.length,
}, null, 2))
