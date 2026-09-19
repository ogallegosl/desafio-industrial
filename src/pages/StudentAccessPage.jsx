import { useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { accessStudentResults, prepareStudentAttempt, validateExamCode, validateExamResultsCode } from '../services/studentExamAccess'
import { getLocalDemoCode } from '../services/localDemoExam'
import { useStudentAttempt } from '../contexts/StudentAttemptContext'
import { readRecoveryMarker } from '../utils/examRecovery'

const unavailableCodes = new Set(['EXAM_NOT_STARTED', 'EXAM_CLOSED', 'EXAM_NOT_AVAILABLE', 'MAX_ATTEMPTS_REACHED', 'STUDENT_NOT_AUTHORIZED'])

export default function StudentAccessPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { establishSession, clearSession } = useStudentAttempt()
  const [step, setStep] = useState(1)
  const [accessCode, setAccessCode] = useState('')
  const [accessMode, setAccessMode] = useState('exam')
  const [examInfo, setExamInfo] = useState(null)
  const [identity, setIdentity] = useState({ firstName: '', lastName: '' })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const codeSubmittingRef = useRef(false)
  const identitySubmittingRef = useRef(false)
  const recoveryMarker = useMemo(() => readRecoveryMarker(), [])
  const recoveryRequested = Boolean(location.state?.recoveryRequired || recoveryMarker?.status === 'in_progress')

  const validateCodeForMode = async (mode, codeOverride = null) => {
    if (codeSubmittingRef.current) return
    const codeToValidate = String(codeOverride ?? accessCode).trim()
    if (!codeToValidate) {
      setMessage('Ingresa el código o contraseña del examen.')
      return
    }

    codeSubmittingRef.current = true
    setAccessMode(mode)
    clearSession()
    setLoading(true)
    setMessage('')
    try {
      const data = mode === 'results'
        ? await validateExamResultsCode(codeToValidate)
        : await validateExamCode(codeToValidate, recoveryMarker?.attemptId || null)
      setAccessCode(codeToValidate)
      setExamInfo(data.exam)
      setStep(2)
    } catch (error) {
      if (mode === 'exam' && unavailableCodes.has(error.code)) {
        navigate('/examen-no-disponible', { state: { code: error.code, message: error.message, details: error.details } })
      } else setMessage(error.message)
    } finally {
      codeSubmittingRef.current = false
      setLoading(false)
    }
  }

  const handleIdentity = async (event) => {
    event.preventDefault()
    if (identitySubmittingRef.current) return
    if (!identity.firstName.trim() || !identity.lastName.trim()) {
      setMessage('Ingresa tus apellidos y nombres.')
      return
    }
    identitySubmittingRef.current = true
    setLoading(true)
    setMessage('')
    try {
      const payload = { firstName: identity.firstName.trim(), lastName: identity.lastName.trim() }
      const data = accessMode === 'results'
        ? await accessStudentResults(accessCode, payload)
        : await prepareStudentAttempt(accessCode, payload, recoveryMarker?.attemptId || null)
      establishSession(data.sessionToken, data)
      navigate(accessMode === 'results' ? '/estudiante/finalizado' : '/estudiante/instrucciones')
    } catch (error) {
      if (unavailableCodes.has(error.code)) {
        navigate('/examen-no-disponible', { state: { code: error.code, message: error.message, details: error.details } })
      } else setMessage(error.message)
    } finally {
      identitySubmittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <section className="split-auth simplified-student-access">
      <div className="auth-context">
        <p className="eyebrow">Desafío Industrial</p>
        <h1>Ingreso al examen</h1>
        <p className="access-short-copy">Ingeniería Industrial UNSA</p>
      </div>

      {step === 1 ? (
        <form className="auth-card" onSubmit={(event) => { event.preventDefault(); validateCodeForMode('exam') }}>
          {recoveryRequested && <div className="form-alert warning" role="status">Se detectó un intento previo. Ingresa nuevamente el código y tus datos para recuperarlo sin reiniciar el tiempo.</div>}
          <div><span className="form-step">1 de 2</span><h2>Código de acceso</h2><p>Escribe el código entregado por el docente.</p></div>
          {message && <div className="form-alert danger" role="alert">{message}</div>}
          <div className="local-demo-callout" role="note">
            <div><strong>Prueba local</strong><span>Recorre el examen de demostración sin Supabase.</span></div>
            <button className="button tertiary compact" type="button" disabled={loading} onClick={() => validateCodeForMode('exam', getLocalDemoCode())}>Probar DEMO · {getLocalDemoCode()}</button>
          </div>
          <label>Código del examen<input type="text" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="off" autoCapitalize="characters" placeholder="Ej. DEMO2026" disabled={loading} /></label>
          <div className="form-actions-row">
            <button className="button primary full" type="submit" disabled={loading}>{loading && accessMode === 'exam' ? 'Validando…' : 'Ingresar'}</button>
            <button className="button secondary full" type="button" disabled={loading} onClick={() => validateCodeForMode('results')}>{loading && accessMode === 'results' ? 'Consultando…' : 'Consultar resultados'}</button>
          </div>
        </form>
      ) : (
        <form className="auth-card" onSubmit={handleIdentity}>
          <div><span className="form-step">2 de 2</span><h2>Identificación</h2><p><strong>{examInfo?.title}</strong></p></div>
          {message && <div className="form-alert danger" role="alert">{message}</div>}
          <label>Apellidos <span className="required-mark">*</span><input value={identity.lastName} onChange={(e) => setIdentity((current) => ({ ...current, lastName: e.target.value }))} autoComplete="family-name" /></label>
          <label>Nombres <span className="required-mark">*</span><input value={identity.firstName} onChange={(e) => setIdentity((current) => ({ ...current, firstName: e.target.value }))} autoComplete="given-name" /></label>
          <div className="form-actions-row">
            <button className="button secondary" type="button" disabled={loading} onClick={() => { setStep(1); setMessage('') }}>Volver</button>
            <button className="button primary" type="submit" disabled={loading}>{loading ? 'Preparando…' : accessMode === 'results' ? 'Ver resultados' : 'Continuar'}</button>
          </div>
        </form>
      )}
    </section>
  )
}
