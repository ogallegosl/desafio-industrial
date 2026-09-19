const PREFIX = 'sevii.exam.pending.'
const SNAPSHOT_PREFIX = 'sevii.exam.snapshot.'

function safeParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}

export function queueKey(attemptId) {
  return `${PREFIX}${attemptId}`
}

export function snapshotKey(attemptId) {
  return `${SNAPSHOT_PREFIX}${attemptId}`
}

export function readPendingAnswers(attemptId) {
  if (!attemptId) return {}
  return safeParse(window.localStorage.getItem(queueKey(attemptId)), {})
}

export function writePendingAnswer(attemptId, questionId, entry) {
  const current = readPendingAnswers(attemptId)
  current[questionId] = entry
  window.localStorage.setItem(queueKey(attemptId), JSON.stringify(current))
  return current
}

export function removePendingAnswer(attemptId, questionId, revision) {
  const current = readPendingAnswers(attemptId)
  if (current[questionId] && Number(current[questionId].revision) <= Number(revision)) delete current[questionId]
  if (Object.keys(current).length) window.localStorage.setItem(queueKey(attemptId), JSON.stringify(current))
  else window.localStorage.removeItem(queueKey(attemptId))
  return current
}

export function clearPendingAnswers(attemptId) {
  if (attemptId) window.localStorage.removeItem(queueKey(attemptId))
}

export function writeExamSnapshot(attemptId, snapshot) {
  if (!attemptId) return
  try { window.localStorage.setItem(snapshotKey(attemptId), JSON.stringify(snapshot)) } catch { /* storage quota */ }
}

export function readExamSnapshot(attemptId) {
  if (!attemptId) return null
  return safeParse(window.localStorage.getItem(snapshotKey(attemptId)), null)
}

export function clearExamSnapshot(attemptId) {
  if (attemptId) window.localStorage.removeItem(snapshotKey(attemptId))
}

let revisionCounter = 0
let revisionFloor = 0

export function seedClientRevisionFloor(value) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > revisionFloor) revisionFloor = numeric
}

export function nextClientRevision() {
  revisionCounter = (revisionCounter + 1) % 1000
  const clockCandidate = Date.now() * 1000 + revisionCounter
  revisionFloor = Math.max(revisionFloor + 1, clockCandidate)
  return revisionFloor
}
