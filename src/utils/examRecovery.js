const RECOVERY_KEY = 'sevii.exam.recovery-marker'

function safeParse(raw, fallback = null) {
  try { return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}

export function writeRecoveryMarker(attemptData) {
  const attempt = attemptData?.attempt
  if (!attempt?.id) return
  const marker = {
    attemptId: attempt.id,
    status: attempt.status,
    attemptNumber: attempt.number,
    startedAt: attempt.startedAt || null,
    deadlineAt: attempt.deadlineAt || null,
    examTitle: attemptData?.exam?.title || null,
    courseCode: attemptData?.exam?.course?.code || null,
    updatedAt: new Date().toISOString(),
  }
  try { window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(marker)) } catch { /* unavailable storage */ }
}

export function readRecoveryMarker() {
  try { return safeParse(window.localStorage.getItem(RECOVERY_KEY)) } catch { return null }
}

export function clearRecoveryMarker(attemptId = null) {
  try {
    if (!attemptId) {
      window.localStorage.removeItem(RECOVERY_KEY)
      return
    }
    const marker = readRecoveryMarker()
    if (!marker || marker.attemptId === attemptId) window.localStorage.removeItem(RECOVERY_KEY)
  } catch { /* unavailable storage */ }
}
