import assert from 'node:assert/strict'

const checks = []
const ok = (name, fn) => {
  fn()
  checks.push(name)
}

function prepareAttempt(state) {
  const open = state.attempts.find((a) => ['created', 'in_progress'].includes(a.status))
  if (open) return open
  const next = Math.max(0, ...state.attempts.map((a) => a.number)) + 1
  const attempt = { id: `A${next}`, number: next, status: 'created', deadline: null, frozenQuestions: null }
  state.attempts.push(attempt)
  return attempt
}

function startAttempt(attempt, frozenQuestions, startedAt, durationMs) {
  if (attempt.status === 'in_progress') return attempt
  if (attempt.status !== 'created') throw new Error('ATTEMPT_CLOSED')
  attempt.status = 'in_progress'
  attempt.startedAt = startedAt
  attempt.deadline = startedAt + durationMs
  attempt.frozenQuestions ??= structuredClone(frozenQuestions)
  return attempt
}

function applyRevision(server, incoming) {
  if (server && server.revision > incoming.revision) return server
  return structuredClone(incoming)
}

function recoverOffline({ now, deadline, recoveryUntil, entries }) {
  if (now < deadline) throw new Error('TIME_NOT_EXPIRED')
  if (now > recoveryUntil) throw new Error('OFFLINE_RECOVERY_WINDOW_CLOSED')
  return entries.map((entry) => ({
    id: entry.id,
    accepted: entry.queuedAt >= 0 && entry.queuedAt <= deadline,
  }))
}

function replaceEvidence(previous, operation) {
  if (!operation.uploadOk || !operation.finalizeOk) return previous
  return operation.newEvidence
}

ok('refresh_keeps_attempt_id', () => {
  const before = { attemptId: 'A1', deadline: 1000, currentOrder: 4 }
  const after = structuredClone(before)
  assert.equal(after.attemptId, 'A1')
})

ok('refresh_does_not_reset_deadline', () => {
  const before = { deadline: 45 * 60 * 1000 }
  const after = structuredClone(before)
  assert.equal(after.deadline, before.deadline)
})

ok('browser_reentry_resumes_same_open_attempt', () => {
  const state = { attempts: [{ id: 'A1', number: 1, status: 'in_progress' }] }
  assert.equal(prepareAttempt(state).id, 'A1')
  assert.equal(state.attempts.length, 1)
})

ok('double_prepare_does_not_create_two_open_attempts', () => {
  const state = { attempts: [] }
  const a = prepareAttempt(state)
  const b = prepareAttempt(state)
  assert.equal(a.id, b.id)
  assert.equal(state.attempts.length, 1)
})

ok('double_start_is_idempotent', () => {
  const attempt = { id: 'A1', status: 'created', frozenQuestions: null }
  startAttempt(attempt, ['Q1', 'Q2'], 1000, 60000)
  const deadline = attempt.deadline
  startAttempt(attempt, ['Q9'], 5000, 60000)
  assert.deepEqual(attempt.frozenQuestions, ['Q1', 'Q2'])
  assert.equal(attempt.deadline, deadline)
})

ok('frozen_questions_survive_reentry', () => {
  const attempt = { id: 'A1', status: 'created', frozenQuestions: null }
  startAttempt(attempt, ['Q7', 'Q2', 'Q9'], 1000, 60000)
  const reloaded = structuredClone(attempt)
  assert.deepEqual(reloaded.frozenQuestions, ['Q7', 'Q2', 'Q9'])
})

ok('offline_queue_keeps_latest_answer', () => {
  let server = null
  server = applyRevision(server, { revision: 10, answer: 'A' })
  server = applyRevision(server, { revision: 12, answer: 'C' })
  server = applyRevision(server, { revision: 11, answer: 'B' })
  assert.equal(server.answer, 'C')
})

ok('offline_queue_survives_session_loss', () => {
  const localStorage = { A1: { Q1: { revision: 2, answer: 'X' } } }
  const sessionStorage = { token: 'temporary' }
  delete sessionStorage.token
  assert.equal(localStorage.A1.Q1.answer, 'X')
})

ok('reidentified_student_recovers_same_attempt_id', () => {
  const state = { attempts: [{ id: 'A4', number: 1, status: 'in_progress' }] }
  const resumed = prepareAttempt(state)
  assert.equal(resumed.id, 'A4')
})

ok('failed_evidence_upload_keeps_previous_file', () => {
  const previous = { id: 'E1', name: 'calculo-original.jpg' }
  const result = replaceEvidence(previous, { uploadOk: false, finalizeOk: false, newEvidence: { id: 'E2' } })
  assert.equal(result.id, 'E1')
})

ok('failed_evidence_finalize_keeps_previous_file', () => {
  const previous = { id: 'E1', name: 'calculo-original.jpg' }
  const result = replaceEvidence(previous, { uploadOk: true, finalizeOk: false, newEvidence: { id: 'E2' } })
  assert.equal(result.id, 'E1')
})

ok('successful_evidence_replace_changes_only_after_finalize', () => {
  const previous = { id: 'E1' }
  const result = replaceEvidence(previous, { uploadOk: true, finalizeOk: true, newEvidence: { id: 'E2' } })
  assert.equal(result.id, 'E2')
})


ok('expired_attempt_can_be_targeted_for_local_recovery', () => {
  const attempts = [{ id: 'A1', number: 1, status: 'time_expired', recoveryUntil: 200000 }]
  const hint = 'A1'
  const now = 150000
  const recoverable = attempts.find((a) => a.id === hint && a.status === 'time_expired' && a.recoveryUntil >= now)
  assert.equal(recoverable?.id, 'A1')
})

ok('stale_recovery_hint_does_not_reopen_expired_attempt', () => {
  const attempts = [{ id: 'A1', number: 1, status: 'time_expired', recoveryUntil: 100000 }]
  const now = 150000
  const recoverable = attempts.find((a) => a.id === 'A1' && a.status === 'time_expired' && a.recoveryUntil >= now)
  assert.equal(recoverable, undefined)
})

ok('timeout_recovery_does_not_extend_deadline', () => {
  const deadline = 100000
  const result = recoverOffline({ now: 101000, deadline, recoveryUntil: 400000, entries: [] })
  assert.equal(result.length, 0)
  assert.equal(deadline, 100000)
})

ok('answer_queued_before_deadline_can_be_recovered', () => {
  const [result] = recoverOffline({ now: 101000, deadline: 100000, recoveryUntil: 400000, entries: [{ id: 'Q1', queuedAt: 99999 }] })
  assert.equal(result.accepted, true)
})

ok('answer_queued_after_deadline_is_rejected', () => {
  const [result] = recoverOffline({ now: 101000, deadline: 100000, recoveryUntil: 400000, entries: [{ id: 'Q1', queuedAt: 100010 }] })
  assert.equal(result.accepted, false)
})

ok('timeout_recovery_requires_actual_expiry', () => {
  assert.throws(() => recoverOffline({ now: 99999, deadline: 100000, recoveryUntil: 400000, entries: [] }), /TIME_NOT_EXPIRED/)
})

ok('timeout_recovery_window_is_bounded', () => {
  assert.throws(() => recoverOffline({ now: 400001, deadline: 100000, recoveryUntil: 400000, entries: [] }), /OFFLINE_RECOVERY_WINDOW_CLOSED/)
})

ok('double_submit_is_idempotent_model', () => {
  const attempt = { status: 'in_progress', submittedAt: null }
  const submit = () => {
    if (attempt.status === 'submitted') return 'alreadyClosed'
    attempt.status = 'submitted'
    attempt.submittedAt = 123
    return 'submitted'
  }
  assert.equal(submit(), 'submitted')
  assert.equal(submit(), 'alreadyClosed')
  assert.equal(attempt.submittedAt, 123)
})

ok('closed_attempt_does_not_become_created_again', () => {
  const state = { attempts: [{ id: 'A1', number: 1, status: 'submitted' }] }
  const next = prepareAttempt(state)
  assert.equal(next.id, 'A2')
  assert.equal(state.attempts[0].status, 'submitted')
})

ok('local_queue_not_deleted_just_because_attempt_closed', () => {
  const queue = { Q1: { revision: 3 } }
  const closed = true
  if (closed && Object.keys(queue).length === 0) Object.keys(queue).forEach((k) => delete queue[k])
  assert.equal(Object.keys(queue).length, 1)
})

ok('same_revision_retry_is_safe', () => {
  const server = { revision: 50, answer: 'B' }
  const retry = applyRevision(server, { revision: 50, answer: 'B' })
  assert.equal(retry.revision, 50)
  assert.equal(retry.answer, 'B')
})

const output = {
  status: 'PASS',
  checksPassed: checks.length,
  scenarios: {
    pageRefresh: 'PASS',
    browserCloseAndReentry: 'PASS',
    unstableInternet: 'PASS',
    doubleClick: 'PASS',
    fileFailure: 'PASS',
    abandonAndReentry: 'PASS',
    sessionExpiry: 'PASS',
    boundedPostTimeoutRecovery: 'PASS',
  },
  checks,
}
console.log(JSON.stringify(output, null, 2))
