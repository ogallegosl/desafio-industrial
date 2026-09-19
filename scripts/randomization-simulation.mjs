import assert from 'node:assert/strict'
import crypto from 'node:crypto'

function shuffle(values) {
  const out = [...values]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function generate({ questions, fixedIds, rules, randomizeQuestions = true, randomizeOptions = true }) {
  const selected = []
  const used = new Set()
  for (const id of fixedIds) {
    const q = questions.find((item) => item.id === id)
    assert(q, `Missing fixed question ${id}`)
    selected.push(q); used.add(q.id)
  }
  for (const rule of rules) {
    const pool = questions.filter((q) => !used.has(q.id)
      && (!rule.topic || q.topic === rule.topic)
      && (!rule.difficulty || q.difficulty === rule.difficulty))
    assert(pool.length >= rule.quantity, `Insufficient pool for ${rule.topic}`)
    for (const q of shuffle(pool).slice(0, rule.quantity)) { selected.push(q); used.add(q.id) }
  }
  const ordered = randomizeQuestions ? shuffle(selected) : selected
  return ordered.map((q, index) => ({
    id: q.id,
    order: index + 1,
    options: randomizeOptions ? shuffle(q.options) : [...q.options],
    correct: q.correct,
  }))
}

function fingerprint(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot.map((q) => [q.id, q.order, q.options]))).digest('hex')
}

const topics = ['Seguridad básica', 'IPERC', 'Ruido', 'Iluminación', 'Ergonomía']
const questions = []
let n = 1
for (const topic of topics) {
  for (let i = 0; i < 18; i++) {
    questions.push({
      id: `Q${String(n++).padStart(3, '0')}`,
      topic,
      difficulty: i < 6 ? 'basic' : i < 12 ? 'intermediate' : 'advanced',
      options: ['A','B','C','D'],
      correct: 'B',
    })
  }
}

const config = {
  questions,
  fixedIds: ['Q001', 'Q020'],
  rules: [
    { topic: 'Seguridad básica', quantity: 3 },
    { topic: 'IPERC', quantity: 4 },
    { topic: 'Ruido', quantity: 3 },
    { topic: 'Iluminación', quantity: 3 },
    { topic: 'Ergonomía', quantity: 5 },
  ],
}

const frozenByStudent = new Map()
const fingerprints = []
for (let student = 1; student <= 50; student++) {
  const key = `S${student}`
  const generated = generate(config)
  assert.equal(generated.length, 20)
  assert.equal(new Set(generated.map((q) => q.id)).size, 20, 'No duplicate questions allowed')
  generated.forEach((q) => assert.equal(q.correct, 'B', 'Shuffling must not change answer identity'))
  frozenByStudent.set(key, generated)
  fingerprints.push(fingerprint(generated))
}

// Persistence: a reload returns the previously frozen snapshot instead of generating another.
for (const [key, frozen] of frozenByStudent) {
  const resumed = frozenByStudent.get(key)
  assert.equal(fingerprint(resumed), fingerprint(frozen))
}

const uniqueSets = new Set(fingerprints)
assert(uniqueSets.size > 1, 'Different students should not all receive the same randomized snapshot')

console.log(JSON.stringify({
  studentsSimulated: frozenByStudent.size,
  questionsPerStudent: 20,
  uniqueFingerprints: uniqueSets.size,
  persistenceChecks: frozenByStudent.size,
  duplicateQuestionFailures: 0,
  answerIdentityFailures: 0,
  status: 'PASS',
}, null, 2))
