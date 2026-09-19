import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ExamTimer from '../components/ExamTimer'
import ExamSecurityGuard from '../components/ExamSecurityGuard'
import { useStudentAttempt } from '../contexts/StudentAttemptContext'
import { useExamTimer } from '../hooks/useExamTimer'
import { loadStudentExamEngine, pingStudentAttempt, recoverTimedOutStudentAnswers, saveStudentAnswer, submitStudentAttempt } from '../services/studentExamAccess'
import { readPendingAnswers, removePendingAnswer } from '../utils/offlineExamQueue'
import { isFlexibleNumber } from '../utils/numbers'
import { isLocalDemoSession } from '../services/localDemoExam'

function answerPresent(question, raw = {}, evidence = null) {
  const selected = Array.isArray(raw?.selectedOptionIds) ? raw.selectedOptionIds : []
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(question.type)) return selected.length > 0
  if (question.type === 'true_false') return typeof raw?.answerPayload?.value === 'boolean'
  if (['numeric', 'calculation'].includes(question.type)) return raw?.answerNumeric !== '' && raw?.answerNumeric !== null && raw?.answerNumeric !== undefined && isFlexibleNumber(raw.answerNumeric)
  if (question.type === 'calculation_evidence') return raw?.answerNumeric !== '' && raw?.answerNumeric !== null && raw?.answerNumeric !== undefined && isFlexibleNumber(raw.answerNumeric) && Boolean(evidence || Number(raw?.answerPayload?.evidenceCount || 0) > 0)
  if (['short_text', 'essay', 'image_essay'].includes(question.type)) return String(raw?.answerText ?? '').trim().length > 0
  if (question.type === 'attachment') return Boolean(evidence || Number(raw?.answerPayload?.evidenceCount || 0) > 0)
  if (question.type === 'case_group') {
    const children = Array.isArray(question.metadata?.caseSubquestions) ? question.metadata.caseSubquestions : []
    const caseAnswers = raw?.answerPayload?.caseAnswers || {}
    return children.length > 0 && children.every((child) => answerPresent(child, caseAnswers[child.id]))
  }
  return String(raw?.answerText ?? '').trim().length > 0
}

export default function StudentReviewPage() {
  const navigate = useNavigate()
  const { sessionToken, attemptData, refresh, establishSession } = useStudentAttempt()
  const attemptId = attemptData?.attempt?.id
  const localDemo = isLocalDemoSession(sessionToken)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [serverNow, setServerNow] = useState(null)
  const submitGuardRef = useRef(false)

  const routeToSessionRecovery = useCallback(async (error) => {
    await refresh()
    navigate('/acceso', { replace: true, state: { recoveryRequired: true, reason: error?.code || 'SESSION_LOST' } })
  }, [refresh, navigate])

  const load = useCallback(async () => {
    if (!sessionToken) return
    setLoading(true)
    try {
      const result = await loadStudentExamEngine(sessionToken)
      if (['submitted', 'time_expired', 'cancelled'].includes(result.attempt?.status)) {
        await refresh()
        navigate('/estudiante/finalizado', { replace: true })
        return
      }
      const pending = readPendingAnswers(attemptId)
      const merged = {
        ...result,
        questions: (result.questions || []).map((question) => ({
          ...question,
          answer: pending[question.id]?.answer ? { ...question.answer, ...pending[question.id].answer } : question.answer,
        })),
      }
      setData(merged)
      setServerNow(result.runtime?.serverNow || new Date().toISOString())
    } catch (error) {
      if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_REQUIRED'].includes(error.code)) {
        await routeToSessionRecovery(error)
      } else if (error.code === 'ATTEMPT_CLOSED') {
        await refresh()
        navigate('/estudiante/finalizado', { replace: true })
      } else setMessage(error.message || 'No se pudo cargar el resumen del examen.')
    } finally {
      setLoading(false)
    }
  }, [sessionToken, attemptId, refresh, navigate, routeToSessionRecovery])

  useEffect(() => { load() }, [load])



  const flushPending = useCallback(async () => {
    if (!attemptId || (!navigator.onLine && !localDemo)) return false
    const pending = readPendingAnswers(attemptId)
    const entries = Object.entries(pending).sort((a, b) => Number(a[1].revision) - Number(b[1].revision))
    if (localDemo && entries.length) {
      // The local demo persists in localStorage. Consolidating the whole queue in
      // one operation avoids repeatedly serializing evidence and prevents the
      // browser from appearing frozen when the student presses Enviar.
      const result = await recoverTimedOutStudentAnswers(sessionToken, entries.map(([questionId, entry]) => ({
        attemptQuestionId: questionId, clientRevision: entry.revision, queuedAt: entry.queuedAt, ...entry.answer,
      })))
      for (const item of result.recovery?.results || []) {
        if (item.accepted) removePendingAnswer(attemptId, item.attemptQuestionId, item.clientRevision)
      }
      if (result.recovery?.serverNow) setServerNow(result.recovery.serverNow)
      return true
    }
    for (const [questionId, entry] of entries) {
      const result = await saveStudentAnswer(sessionToken, { attemptQuestionId: questionId, clientRevision: entry.revision, queuedAt: entry.queuedAt, ...entry.answer })
      removePendingAnswer(attemptId, questionId, result.save?.clientRevision ?? entry.revision)
      if (result.save?.serverNow) setServerNow(result.save.serverNow)
    }
    return true
  }, [attemptId, sessionToken, localDemo])

  const recoverTimedOutPending = useCallback(async () => {
    if (!attemptId || !sessionToken || (!navigator.onLine && !localDemo)) return null
    const pending = readPendingAnswers(attemptId)
    const entries = Object.entries(pending).map(([questionId, entry]) => ({
      attemptQuestionId: questionId,
      clientRevision: entry.revision,
      queuedAt: entry.queuedAt,
      ...entry.answer,
    }))
    const result = await recoverTimedOutStudentAnswers(sessionToken, entries)
    for (const item of result.recovery?.results || []) {
      if (item.accepted) removePendingAnswer(attemptId, item.attemptQuestionId, item.clientRevision)
    }
    if (result.recovery?.serverNow) setServerNow(result.recovery.serverNow)
    return result
  }, [attemptId, sessionToken, localDemo])

  useEffect(() => {
    if (!sessionToken || !data || submitting) return undefined
    const id = window.setInterval(async () => {
      if (!navigator.onLine && !localDemo) return
      try {
        const result = await pingStudentAttempt(sessionToken)
        setServerNow(result.runtime?.serverNow || new Date().toISOString())
        setData((current) => current ? { ...current, attempt: { ...current.attempt, ...(result.attempt || {}) } } : current)
        if (result.attempt?.status !== 'in_progress') {
          const pending = readPendingAnswers(attemptId)
          if (Object.keys(pending).length && (result.attempt?.status === 'time_expired' || result.attempt?.submissionReason === 'TEACHER_FORCED')) {
            try { await recoverTimedOutPending() } catch { /* preserve queue */ }
          }
          await refresh()
          navigate('/estudiante/finalizado', { replace: true })
        }
      } catch (error) {
        if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_REQUIRED'].includes(error.code)) await routeToSessionRecovery(error)
      }
    }, 5000)
    return () => window.clearInterval(id)
  }, [sessionToken, data, submitting, localDemo, attemptId, recoverTimedOutPending, refresh, navigate, routeToSessionRecovery])

  const finalize = useCallback(async (reason = 'STUDENT_SUBMITTED') => {
    if (submitGuardRef.current || submitting) return
    submitGuardRef.current = true
    setSubmitting(true)
    setMessage('')
    try {
      if (!navigator.onLine && !localDemo) throw new Error('Necesitas conexión para enviar el examen. Tus respuestas continúan guardadas localmente.')
      // Give React one frame to paint the Enviando… state before any storage/network work.
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
      let finalData = null
      if (reason === 'TIME_EXPIRED') {
        finalData = await recoverTimedOutPending()
      } else {
        await flushPending()
        finalData = await submitStudentAttempt(sessionToken, reason)
      }
      if (finalData?.attempt) establishSession(sessionToken, finalData)
      else await refresh()
      navigate('/estudiante/finalizado', { replace: true })
    } catch (error) {
      if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_REQUIRED'].includes(error.code)) {
        await routeToSessionRecovery(error)
      } else if (error.code === 'TIME_NOT_EXPIRED') {
        if (error.details?.serverNow) setServerNow(error.details.serverNow)
        setMessage('El reloj se sincronizó nuevamente con el servidor; todavía quedan unos segundos de examen.')
      } else {
        setMessage(error.message || 'No se pudo enviar el examen. Las respuestas locales pendientes se conservan.')
      }
    } finally {
      submitGuardRef.current = false
      setSubmitting(false)
    }
  }, [submitting, flushPending, recoverTimedOutPending, sessionToken, refresh, establishSession, navigate, routeToSessionRecovery, localDemo])

  const handleExpire = useCallback(() => { finalize('TIME_EXPIRED') }, [finalize])
  const timer = useExamTimer({
    deadlineAt: data?.attempt?.deadlineAt || attemptData?.attempt?.deadlineAt,
    serverNow,
    enabled: Boolean(data && !submitting),
    onExpire: handleExpire,
  })

  const summary = useMemo(() => {
    const questions = data?.questions || []
    const answered = questions.filter((question) => answerPresent(question, question.answer, question.evidence)).length
    return { total: questions.length, answered, unanswered: questions.length - answered }
  }, [data])

  if (loading) return <section className="student-panel"><p>Preparando la revisión final…</p></section>
  if (!data) return <section className="student-panel"><h1>No se pudo abrir la revisión.</h1>{message && <div className="form-alert danger">{message}</div>}<Link className="button secondary" to="/estudiante/examen">Volver</Link></section>

  return (
    <section className="student-panel review-before-submit runtime-review">
      <ExamSecurityGuard
        sessionToken={sessionToken}
        config={data?.runtime?.security || attemptData?.exam?.security}
        studentName={attemptData?.student?.displayName || 'Estudiante'}
        examTitle={attemptData?.exam?.title || 'Examen'}
      />
      <div className="review-title-row">
        <div>
          <p className="eyebrow">Antes de enviar</p>
          <h1>Revisa el estado de tus respuestas.</h1>
        </div>
        <ExamTimer value={timer.formatted} warning={timer.warning} critical={timer.critical} />
      </div>

      <div className="review-summary">
        <div><strong>{summary.total}</strong><span>preguntas</span></div>
        <div><strong>{summary.answered}</strong><span>respondidas</span></div>
        <div><strong>{summary.unanswered}</strong><span>sin responder</span></div>
      </div>

      {summary.unanswered > 0 && <div className="form-alert warning">Todavía tienes {summary.unanswered} pregunta{summary.unanswered === 1 ? '' : 's'} sin responder. Puedes enviar el examen, pero esas preguntas quedarán registradas como omitidas.</div>}
      {message && <div className="form-alert danger">{message}</div>}

      <div className="review-question-grid">
        {data.questions.map((question) => {
          const answered = answerPresent(question, question.answer, question.evidence)
          return <div className={`review-question-chip ${answered ? 'answered' : 'unanswered'}`} key={question.id}><b>{question.order}</b><span>{answered ? 'Respondida' : 'Sin responder'}</span></div>
        })}
      </div>

      <div className="review-actions">
        <Link className="button secondary" to="/estudiante/examen">Volver al examen</Link>
        <button className="button primary" type="button" onClick={() => finalize('STUDENT_SUBMITTED')} disabled={submitting || timer.expired}>
          {submitting ? 'Enviando…' : 'Enviar examen definitivamente'}
        </button>
      </div>
      <p className="muted-copy">Después del envío no podrás modificar tus respuestas.</p>
    </section>
  )
}
