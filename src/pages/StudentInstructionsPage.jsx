import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStudentAttempt } from '../contexts/StudentAttemptContext'
import { requestExamFullscreen } from '../components/ExamSecurityGuard'

export default function StudentInstructionsPage() {
  const navigate = useNavigate()
  const { attemptData, loading, startAttempt, refresh } = useStudentAttempt()
  const [accepted, setAccepted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState('')
  const startGuardRef = useRef(false)

  useEffect(() => {
    if (!loading && attemptData?.attempt?.status === 'submitted') navigate('/estudiante/finalizado', { replace: true })
    if (!loading && attemptData?.attempt?.status === 'time_expired') navigate('/estudiante/finalizado', { replace: true })
  }, [attemptData, loading, navigate])

  if (loading || !attemptData) {
    return <section className="student-panel instructions-panel"><p>Recuperando información del examen…</p></section>
  }

  const { exam, attempt } = attemptData
  const isResume = attempt.status === 'in_progress'

  const handleStart = async () => {
    if (startGuardRef.current) return
    if (!accepted && !isResume) {
      setMessage('Confirma que has leído las instrucciones antes de iniciar.')
      return
    }
    startGuardRef.current = true
    setStarting(true)
    setMessage('')
    try {
      const security = exam?.security || {}
      if (security.enabled !== false && security.requireSeb === true && !/(SafeExamBrowser|\bSEB\b)/i.test(navigator.userAgent || '')) {
        setMessage('Este examen requiere Safe Exam Browser (SEB). Abre el examen desde SEB para continuar.')
        return
      }
      if (security.enabled !== false && security.requireFullscreen !== false && document.fullscreenEnabled && !document.fullscreenElement) {
        const fullscreenOk = await requestExamFullscreen()
        if (!fullscreenOk) {
          setMessage('Para iniciar este examen debes permitir el modo de pantalla completa.')
          return
        }
      }
      await startAttempt()
      navigate('/estudiante/examen')
    } catch (error) {
      setMessage(error.message)
      await refresh()
    } finally {
      startGuardRef.current = false
      setStarting(false)
    }
  }

  return (
    <section className="student-panel instructions-panel">
      <p className="eyebrow">Antes de comenzar</p>
      {attemptData?.localDemo && <div className="form-alert info local-demo-banner" role="status"><strong>Modo DEMO local.</strong> No usa Supabase ni envía información a internet; el avance se guarda únicamente en este navegador.</div>}
      <h1>{exam.title}</h1>
      <p className="lead">{exam.description || 'Lee las condiciones antes de iniciar. El cronómetro se activará después de la confirmación.'}</p>

      <div className="exam-facts">
        <div><span>Duración</span><strong>{exam.durationMinutes} min</strong></div>
        <div><span>Intento</span><strong>{attempt.number} de {exam.maxAttempts}</strong></div>
        <div><span>Estado</span><strong>{isResume ? 'En curso' : 'Preparado'}</strong></div>
        <div><span>Curso</span><strong>{exam.course?.code || exam.course?.name || '—'}</strong></div>
      </div>

      <div className="instructions-box">
        <h2>Indicaciones</h2>
        {exam.instructions ? <p className="preserve-lines">{exam.instructions}</p> : (
          <ol>
            <li>Responde todas las preguntas antes de enviar.</li>
            <li>Algunas preguntas podrán solicitar una fotografía o archivo del procedimiento.</li>
            <li>El orden de preguntas y alternativas puede variar entre estudiantes.</li>
            <li>El intento preparado no consume tiempo hasta que confirmes el inicio.</li>
            <li>Durante la evaluación se registran cambios de pestaña, salidas de pantalla completa y otros eventos de integridad.</li>
          </ol>
        )}
      </div>

      <div className="mobile-exam-guidance" role="note">
        <strong>Si rendirás desde celular</strong>
        <span>La plataforma intentará mantener la pantalla encendida mientras el examen esté visible. Evita cambiar de aplicación. Si tu navegador no admite esta función, aumenta temporalmente el tiempo de bloqueo automático de pantalla antes de iniciar.</span>
      </div>

      {message && <div className="form-alert danger" role="alert">{message}</div>}

      {!isResume && (
        <label className="checkbox-row">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>He leído las instrucciones y estoy preparado para iniciar.</span>
        </label>
      )}

      <button className="button primary" onClick={handleStart} disabled={starting}>
        {starting ? 'Iniciando…' : isResume ? 'Continuar examen' : 'Iniciar examen'}
      </button>
    </section>
  )
}
