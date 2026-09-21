import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getStudentAttemptStatus, startStudentAttempt } from '../services/studentExamAccess'
import { writeRecoveryMarker } from '../utils/examRecovery'

const STORAGE_KEY = 'sevii.studentAttemptSession'
const StudentAttemptContext = createContext(null)

function readStoredSession() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function StudentAttemptProvider({ children }) {
  const [sessionToken, setSessionToken] = useState(() => readStoredSession()?.sessionToken ?? null)
  const [attemptData, setAttemptData] = useState(() => readStoredSession()?.attemptData ?? null)
  const [loading, setLoading] = useState(Boolean(readStoredSession()?.sessionToken))
  const [error, setError] = useState(null)

  const persist = useCallback((token, data) => {
    setSessionToken(token)
    setAttemptData(data)
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionToken: token, attemptData: data }))
    writeRecoveryMarker(data)
  }, [])

  const clearSession = useCallback(() => {
    // Deliberately keep the non-sensitive recovery marker in localStorage.
    // If the tab/browser closes or the temporary session expires, the student can
    // re-enter the code and identity and the server will resume the same open attempt.
    setSessionToken(null)
    setAttemptData(null)
    setError(null)
    window.sessionStorage.removeItem(STORAGE_KEY)
  }, [])

  const refresh = useCallback(async () => {
    if (!sessionToken) {
      setLoading(false)
      return null
    }
    setLoading(true)
    try {
      const resultAccess = Boolean(attemptData?.resultAccess)
      const currentResultAccessCode = attemptData?.resultAccessCode || ''
      const data = await getStudentAttemptStatus(sessionToken, resultAccess, currentResultAccessCode)
      const preservedResultCode = data?.resultAccessCode || attemptData?.resultAccessCode || null
      const merged = preservedResultCode ? { ...data, resultAccessCode: preservedResultCode } : data
      const persisted = resultAccess ? { ...merged, resultAccess: true } : merged
      persist(sessionToken, persisted)
      setError(null)
      return persisted
    } catch (nextError) {
      setError(nextError)
      if (['SESSION_INVALID', 'SESSION_EXPIRED', 'SESSION_REQUIRED'].includes(nextError.code)) clearSession()
      return null
    } finally {
      setLoading(false)
    }
  }, [sessionToken, attemptData?.resultAccess, attemptData?.resultAccessCode, persist, clearSession])

  useEffect(() => {
    if (sessionToken) refresh()
    else setLoading(false)
  }, [sessionToken, refresh])

  const establishSession = useCallback((token, data) => {
    persist(token, data)
    setError(null)
  }, [persist])

  const startAttempt = useCallback(async () => {
    if (!sessionToken) throw new Error('No existe una sesión de examen preparada.')
    const data = await startStudentAttempt(sessionToken)
    persist(sessionToken, data)
    return data
  }, [sessionToken, persist])

  const value = useMemo(() => ({
    sessionToken,
    attemptData,
    loading,
    error,
    establishSession,
    refresh,
    startAttempt,
    clearSession,
  }), [sessionToken, attemptData, loading, error, establishSession, refresh, startAttempt, clearSession])

  return <StudentAttemptContext.Provider value={value}>{children}</StudentAttemptContext.Provider>
}

export function useStudentAttempt() {
  const context = useContext(StudentAttemptContext)
  if (!context) throw new Error('useStudentAttempt debe utilizarse dentro de StudentAttemptProvider.')
  return context
}
