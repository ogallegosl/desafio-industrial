import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import ExamProgress from '../components/ExamProgress'
import ExamTimer from '../components/ExamTimer'
import SaveStatus from '../components/SaveStatus'
import StudentQuestionRenderer from '../components/StudentQuestionRenderer'
import ExamSecurityGuard from '../components/ExamSecurityGuard'
import { useStudentAttempt } from '../contexts/StudentAttemptContext'
import { useExamTimer } from '../hooks/useExamTimer'
import {
  loadStudentExamEngine,
  pingStudentAttempt,
  recoverTimedOutStudentAnswers,
  saveStudentAnswer,
  saveStudentNavigation,
} from '../services/studentExamAccess'
import {
  nextClientRevision,
  seedClientRevisionFloor,
  readExamSnapshot,
  readPendingAnswers,
  removePendingAnswer,
  writeExamSnapshot,
  writePendingAnswer,
} from '../utils/offlineExamQueue'
import { isFlexibleNumber } from '../utils/numbers'
import { isLocalDemoSession } from '../services/localDemoExam'

function defaultAnswer(value = {}) {
  return {
    answerText: value?.answerText ?? '',
    answerNumeric: value?.answerNumeric ?? '',
    selectedOptionIds: Array.isArray(value?.selectedOptionIds) ? value.selectedOptionIds : [],
    answerPayload: value?.answerPayload && typeof value.answerPayload === 'object' ? value.answerPayload : {},
  }
}

function answerPresent(question, rawAnswer, evidence = null) {
  const answer = defaultAnswer(rawAnswer)
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(question.type)) return answer.selectedOptionIds.length > 0
  if (question.type === 'true_false') return typeof answer.answerPayload?.value === 'boolean'
  if (['numeric', 'calculation'].includes(question.type)) return answer.answerNumeric !== '' && answer.answerNumeric !== null && isFlexibleNumber(answer.answerNumeric)
  if (question.type === 'calculation_evidence') return answer.answerNumeric !== '' && answer.answerNumeric !== null && isFlexibleNumber(answer.answerNumeric) && Boolean(evidence || Number(answer.answerPayload?.evidenceCount || 0) > 0)
  if (['short_text', 'essay', 'image_essay'].includes(question.type)) return String(answer.answerText).trim().length > 0
  if (question.type === 'attachment') return Boolean(evidence || Number(answer.answerPayload?.evidenceCount || 0) > 0)
  if (question.type === 'case_group') {
    const children = Array.isArray(question.metadata?.caseSubquestions) ? question.metadata.caseSubquestions : []
    const caseAnswers = answer.answerPayload?.caseAnswers || {}
    return children.length > 0 && children.every((child) => answerPresent(child, caseAnswers[child.id]))
  }
  return String(answer.answerText).trim().length > 0
}

function mergePendingIntoEngine(engine, pending) {
  if (!engine?.questions) return engine
  return {
    ...engine,
    questions: engine.questions.map((question) => ({
      ...question,
      answer: pending[question.id]?.answer ? { ...question.answer, ...pending[question.id].answer } : question.answer,
    })),
  }
}

export default function StudentExamPage() {
  const navigate = useNavigate()
  const { sessionToken, attemptData, refresh } = useStudentAttempt()
  const attemptId = attemptData?.attempt?.id
  const localDemo = isLocalDemoSession(sessionToken)
  const [engine, setEngine] = useState(null)
  const [currentOrder, setCurrentOrder] = useState(1)
  const [maxReachedOrder, setMaxReachedOrder] = useState(1)
  const [answers, setAnswers] = useState({})
  const [evidenceByQuestion, setEvidenceByQuestion] = useState({})
  const [saveStates, setSaveStates] = useState({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [serverNow, setServerNow] = useState(null)
  const [timeLocked, setTimeLocked] = useState(false)
  const [offlineMode, setOfflineMode] = useState(!navigator.onLine)
  const saveTimers = useRef(new Map())
  const answersRef = useRef(answers)
  const engineRef = useRef(engine)
  const currentOrderRef = useRef(currentOrder)
  const maxReachedRef = useRef(maxReachedOrder)
  const timeoutSubmitting = useRef(false)
  const serverClockRef = useRef({ serverMs: null, clientMs: null })

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { engineRef.current = engine }, [engine])
  useEffect(() => { currentOrderRef.current = currentOrder }, [currentOrder])
  useEffect(() => { maxReachedRef.current = maxReachedOrder }, [maxReachedOrder])
  useEffect(() => {
    const parsed = serverNow ? new Date(serverNow).getTime() : NaN
    if (Number.isFinite(parsed)) serverClockRef.current = { serverMs: parsed, clientMs: Date.now() }
  }, [serverNow])

  const estimatedServerIso = useCallback(() => {
    const ref = serverClockRef.current
    if (Number.isFinite(ref.serverMs) && Number.isFinite(ref.clientMs)) {
      return new Date(ref.serverMs + Math.max(0, Date.now() - ref.clientMs)).toISOString()
    }
    return new Date().toISOString()
  }, [])

  const routeToSessionRecovery = useCallback(async (error) => {
    await refresh()
    navigate('/acceso', {
      replace: true,
      state: { recoveryRequired: true, reason: error?.code || 'SESSION_LOST' },
    })
  }, [refresh, navigate])

  const syncOne = useCallback(async (questionId, entryOverride = null) => {
    if (!attemptId || !sessionToken || (!navigator.onLine && !localDemo)) return false
    const pending = readPendingAnswers(attemptId)
    const entry = entryOverride || pending[questionId]
    if (!entry) return true
    setSaveStates((prev) => ({ ...prev, [questionId]: 'saving' }))
    try {
      const result = await saveStudentAnswer(sessionToken, {
        attemptQuestionId: questionId,
        clientRevision: entry.revision,
        ...entry.answer,
      })
      removePendingAnswer(attemptId, questionId, result.save?.clientRevision ?? entry.revision)
      setSaveStates((prev) => ({ ...prev, [questionId]: 'saved' }))
      if (result.save?.serverNow) setServerNow(result.save.serverNow)
      return true
    } catch (error) {
      if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_REQUIRED'].includes(error.code)) {
        await routeToSessionRecovery(error)
        return false
      }
      if (error.code === 'ATTEMPT_CLOSED') {
        // Do not discard the local queue: the timeout recovery path may still
        // consolidate answers created before the deadline.
        setTimeLocked(true)
        setMessage('El servidor cerró el intento. Conservamos las respuestas locales pendientes para intentar consolidarlas de forma segura.')
        return false
      }
      setSaveStates((prev) => ({ ...prev, [questionId]: navigator.onLine ? 'error' : 'offline' }))
      return false
    }
  }, [attemptId, sessionToken, routeToSessionRecovery, localDemo])

  const syncAllPending = useCallback(async () => {
    if (!attemptId || (!navigator.onLine && !localDemo)) return false
    const pending = readPendingAnswers(attemptId)
    const entries = Object.entries(pending).sort((a, b) => Number(a[1].revision) - Number(b[1].revision))
    for (const [questionId, entry] of entries) {
      const ok = await syncOne(questionId, entry)
      if (!ok) return false
    }
    return true
  }, [attemptId, syncOne, localDemo])

  const recoverTimedOutPending = useCallback(async () => {
    if (!attemptId || !sessionToken || (!navigator.onLine && !localDemo)) return null
    const pending = readPendingAnswers(attemptId)
    const answersToRecover = Object.entries(pending)
      .sort((a, b) => Number(a[1].revision) - Number(b[1].revision))
      .map(([questionId, entry]) => ({
        attemptQuestionId: questionId,
        clientRevision: entry.revision,
        queuedAt: entry.queuedAt,
        ...entry.answer,
      }))

    const result = await recoverTimedOutStudentAnswers(sessionToken, answersToRecover)
    for (const item of result.recovery?.results || []) {
      if (item.accepted) removePendingAnswer(attemptId, item.attemptQuestionId, item.clientRevision)
    }
    if (result.recovery?.serverNow) setServerNow(result.recovery.serverNow)
    return result
  }, [attemptId, sessionToken, localDemo])

  const syncNavigationAfterOffline = useCallback(async () => {
    if (!sessionToken || (!navigator.onLine && !localDemo) || !engineRef.current) return
    try {
      const ping = await pingStudentAttempt(sessionToken)
      setServerNow(ping.runtime?.serverNow || ping.serverNow || new Date().toISOString())
      if (ping.attempt?.status !== 'in_progress') {
        await refresh()
        navigate('/estudiante/finalizado', { replace: true })
        return
      }
      const config = engineRef.current.runtime
      const localCurrent = currentOrderRef.current
      const localMax = maxReachedRef.current
      let serverMax = Number(ping.runtime?.maxReachedOrder || 1)
      if (config.navigation === 'sequential' && localMax > serverMax) {
        for (let order = serverMax + 1; order <= localMax; order += 1) {
          const moved = await saveStudentNavigation(sessionToken, order)
          serverMax = Number(moved.navigation?.maxReachedOrder || order)
        }
      }
      const target = config.navigation === 'free' ? localCurrent : Math.min(localCurrent, serverMax)
      const moved = await saveStudentNavigation(sessionToken, target)
      setCurrentOrder(Number(moved.navigation?.currentOrder || target))
      setMaxReachedOrder(Math.max(localMax, Number(moved.navigation?.maxReachedOrder || serverMax)))
    } catch {
      // A later heartbeat will retry. Answers remain locally queued.
    }
  }, [sessionToken, refresh, navigate, localDemo])

  const loadEngine = useCallback(async () => {
    if (!attemptId || !sessionToken) return
    setLoading(true)
    setMessage('')
    const pending = readPendingAnswers(attemptId)
    for (const entry of Object.values(pending)) seedClientRevisionFloor(entry?.revision)
    try {
      const data = await loadStudentExamEngine(sessionToken)
      for (const question of data.questions || []) seedClientRevisionFloor(question.answer?.clientRevision)
      const merged = mergePendingIntoEngine(data, pending)
      const mappedAnswers = Object.fromEntries((merged.questions || []).map((question) => [question.id, defaultAnswer(question.answer)]))
      if (['submitted', 'time_expired', 'cancelled'].includes(merged.attempt?.status)) {
        await refresh()
        navigate('/estudiante/finalizado', { replace: true })
        return
      }
      setEngine(merged)
      setAnswers(mappedAnswers)
      setEvidenceByQuestion(Object.fromEntries((merged.questions || []).map((question) => [question.id, question.evidence || null])))
      setCurrentOrder(Number(merged.runtime?.currentOrder || 1))
      setMaxReachedOrder(Number(merged.runtime?.maxReachedOrder || 1))
      setServerNow(merged.runtime?.serverNow || new Date().toISOString())
      setTimeLocked(['submitted', 'time_expired', 'cancelled'].includes(merged.attempt?.status))
      setOfflineMode(false)
      writeExamSnapshot(attemptId, { ...merged, _cachedAtClient: Date.now() })
      const initialStates = {}
      for (const question of merged.questions || []) initialStates[question.id] = pending[question.id] ? 'pending' : 'saved'
      setSaveStates(initialStates)
    } catch (error) {
      const cached = readExamSnapshot(attemptId)
      if (!navigator.onLine && cached?.questions?.length) {
        for (const question of cached.questions || []) seedClientRevisionFloor(question.answer?.clientRevision)
        const merged = mergePendingIntoEngine(cached, pending)
        setEngine(merged)
        setAnswers(Object.fromEntries(merged.questions.map((question) => [question.id, defaultAnswer(question.answer)])))
        setEvidenceByQuestion(Object.fromEntries(merged.questions.map((question) => [question.id, question.evidence || null])))
        setCurrentOrder(Number(merged.runtime?.currentOrder || 1))
        setMaxReachedOrder(Number(merged.runtime?.maxReachedOrder || 1))
        const cachedServerMs = merged.runtime?.serverNow ? new Date(merged.runtime.serverNow).getTime() : Date.now()
        const cachedAtClient = Number(merged._cachedAtClient || Date.now())
        setServerNow(new Date(cachedServerMs + Math.max(0, Date.now() - cachedAtClient)).toISOString())
        setOfflineMode(true)
        setMessage('Sin conexión. Puedes continuar respondiendo; las respuestas se sincronizarán al recuperar internet.')
      } else if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_REQUIRED'].includes(error.code)) {
        await routeToSessionRecovery(error)
      } else if (error.code === 'ATTEMPT_CLOSED') {
        await refresh()
        navigate('/estudiante/finalizado', { replace: true })
      } else {
        setMessage(error.message || 'No se pudo cargar el examen.')
      }
    } finally {
      setLoading(false)
    }
  }, [attemptId, sessionToken, attemptData?.attempt?.startedAt, refresh, navigate, routeToSessionRecovery])

  useEffect(() => { loadEngine() }, [loadEngine])

  useEffect(() => {
    if (!attemptId || !engine) return
    const cached = {
      ...engine,
      runtime: { ...engine.runtime, currentOrder, maxReachedOrder, serverNow },
      questions: engine.questions.map((question) => ({ ...question, answer: answers[question.id] || question.answer, evidence: evidenceByQuestion[question.id] ?? question.evidence ?? null })),
    }
    writeExamSnapshot(attemptId, { ...cached, _cachedAtClient: Date.now() })
  }, [attemptId, engine, answers, evidenceByQuestion, currentOrder, maxReachedOrder, serverNow])

  useEffect(() => {
    const online = async () => {
      setOfflineMode(false)
      await syncAllPending()
      await syncNavigationAfterOffline()
      if (timeLocked && !timeoutSubmitting.current) {
        timeoutSubmitting.current = true
        try {
          await recoverTimedOutPending()
          await refresh()
          navigate('/estudiante/finalizado', { replace: true })
        } catch (error) {
          if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_REQUIRED'].includes(error.code)) {
            await routeToSessionRecovery(error)
          } else if (error.code === 'TIME_NOT_EXPIRED') {
            if (error.details?.serverNow) setServerNow(error.details.serverNow)
            setTimeLocked(false)
            timeoutSubmitting.current = false
          } else {
            setMessage(error.message || 'No se pudo consolidar todavía la cola local. Se conservará en este dispositivo para reintentar.')
            timeoutSubmitting.current = false
          }
        }
      }
    }
    const offline = () => {
      setOfflineMode(true)
      const current = engineRef.current?.questions?.[currentOrderRef.current - 1]
      if (current) setSaveStates((prev) => ({ ...prev, [current.id]: 'offline' }))
    }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [syncAllPending, syncNavigationAfterOffline, timeLocked, recoverTimedOutPending, refresh, navigate, routeToSessionRecovery])

  useEffect(() => {
    if (!sessionToken || !engine || timeLocked) return undefined
    const id = window.setInterval(async () => {
      if (!navigator.onLine && !localDemo) return
      try {
        const result = await pingStudentAttempt(sessionToken)
        setServerNow(result.runtime?.serverNow || new Date().toISOString())
        setEngine((current) => current ? { ...current, attempt: { ...current.attempt, ...(result.attempt || {}) } } : current)
        if (result.attempt?.status !== 'in_progress') {
          setTimeLocked(true)
          const hasPending = Object.keys(readPendingAnswers(attemptId)).length > 0
          const recoverableTeacherClose = result.attempt?.submissionReason === 'TEACHER_FORCED'
          if (hasPending && (result.attempt?.status === 'time_expired' || recoverableTeacherClose)) {
            try { await recoverTimedOutPending() } catch { /* leave local queue untouched */ }
          }
          await refresh()
          navigate('/estudiante/finalizado', { replace: true })
        }
      } catch (error) {
        if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_REQUIRED'].includes(error.code)) {
          await routeToSessionRecovery(error)
        }
        // Other heartbeat failures do not erase local work.
      }
    }, 5000)
    return () => window.clearInterval(id)
  }, [sessionToken, engine, timeLocked, attemptId, recoverTimedOutPending, refresh, navigate, routeToSessionRecovery, localDemo])

  const handleTimeout = useCallback(async () => {
    if (timeoutSubmitting.current) return
    timeoutSubmitting.current = true
    setTimeLocked(true)
    for (const timerId of saveTimers.current.values()) window.clearTimeout(timerId)
    saveTimers.current.clear()
    setMessage('El tiempo terminó. El intento quedó bloqueado. Si existen respuestas locales pendientes, se consolidarán sin ampliar el cronómetro.')
    if (!navigator.onLine && !localDemo) {
      setOfflineMode(true)
      timeoutSubmitting.current = false
      return
    }
    try {
      await recoverTimedOutPending()
      await refresh()
      navigate('/estudiante/finalizado', { replace: true })
    } catch (error) {
      if (error.code === 'TIME_NOT_EXPIRED') {
        if (error.details?.serverNow) setServerNow(error.details.serverNow)
        setTimeLocked(false)
        setMessage('El reloj local se adelantó ligeramente. Se sincronizó nuevamente con el servidor.')
      } else if (['SESSION_EXPIRED', 'SESSION_INVALID', 'SESSION_REQUIRED'].includes(error.code)) {
        await routeToSessionRecovery(error)
      } else {
        setMessage(error.message || 'No se pudo consolidar todavía la cola local. Las respuestas permanecen guardadas en este dispositivo.')
      }
      timeoutSubmitting.current = false
    }
  }, [recoverTimedOutPending, refresh, navigate, routeToSessionRecovery, localDemo])

  const timer = useExamTimer({
    deadlineAt: engine?.attempt?.deadlineAt || attemptData?.attempt?.deadlineAt,
    serverNow,
    enabled: Boolean(engine && !timeLocked),
    onExpire: handleTimeout,
  })

  const scheduleSave = useCallback((questionId, answer) => {
    if (!attemptId) return
    const revision = nextClientRevision()
    const entry = { revision, answer, queuedAt: estimatedServerIso() }
    writePendingAnswer(attemptId, questionId, entry)
    setSaveStates((prev) => ({ ...prev, [questionId]: (navigator.onLine || localDemo) ? 'saving' : 'offline' }))
    const previous = saveTimers.current.get(questionId)
    if (previous) window.clearTimeout(previous)
    if (navigator.onLine || localDemo) {
      const timerId = window.setTimeout(() => {
        saveTimers.current.delete(questionId)
        syncOne(questionId)
      }, 700)
      saveTimers.current.set(questionId, timerId)
    }
  }, [attemptId, syncOne, estimatedServerIso])

  const updateAnswer = useCallback((questionId, value) => {
    if (timeLocked) return
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
    scheduleSave(questionId, value)
  }, [scheduleSave, timeLocked])

  const updateEvidence = useCallback((questionId, evidence) => {
    if (timeLocked) return
    setEvidenceByQuestion((prev) => ({ ...prev, [questionId]: evidence || null }))
    setAnswers((prev) => {
      const current = defaultAnswer(prev[questionId])
      const answerPayload = { ...(current.answerPayload || {}) }
      for (const key of ['evidenceCount', 'evidenceId', 'evidenceName', 'evidenceMimeType', 'evidenceUploadedAt']) delete answerPayload[key]
      if (evidence) {
        answerPayload.evidenceCount = 1
        answerPayload.evidenceId = evidence.id
        answerPayload.evidenceName = evidence.name
        answerPayload.evidenceMimeType = evidence.mimeType
        answerPayload.evidenceUploadedAt = evidence.uploadedAt
      }
      return { ...prev, [questionId]: { ...current, answerPayload } }
    })
  }, [timeLocked])

  const goTo = useCallback(async (target) => {
    if (!engine || timeLocked) return
    const total = engine.questions.length
    if (target < 1 || target > total || target === currentOrderRef.current) return
    const runtime = engine.runtime || {}
    const current = currentOrderRef.current
    const maxReached = maxReachedRef.current
    if (runtime.navigation === 'sequential') {
      if (target > maxReached + 1) return
      if (!runtime.allowBacktrack && target < current) return
      if (!runtime.allowBacktrack && target < maxReached) return
    }

    const currentQuestion = engine.questions[current - 1]
    if (currentQuestion && (navigator.onLine || localDemo)) await syncOne(currentQuestion.id)

    let nextMax = Math.max(maxReached, target)
    if (navigator.onLine || localDemo) {
      try {
        const moved = await saveStudentNavigation(sessionToken, target)
        setServerNow(moved.serverNow || new Date().toISOString())
        setCurrentOrder(Number(moved.navigation?.currentOrder || target))
        nextMax = Number(moved.navigation?.maxReachedOrder || nextMax)
        setMaxReachedOrder(nextMax)
        return
      } catch (error) {
        setMessage(error.message || 'No se pudo guardar la posición del examen.')
        return
      }
    }
    setCurrentOrder(target)
    setMaxReachedOrder(nextMax)
  }, [engine, timeLocked, sessionToken, syncOne, localDemo])

  const review = useCallback(async () => {
    if (!navigator.onLine && !localDemo) {
      setOfflineMode(true)
      setMessage('Puedes seguir respondiendo sin conexión, pero necesitas recuperar internet para revisar y enviar el examen.')
      return
    }
    const currentQuestion = engine?.questions?.[currentOrderRef.current - 1]
    if (currentQuestion) await syncOne(currentQuestion.id)
    await syncAllPending()
    navigate('/estudiante/revisar')
  }, [engine, syncOne, syncAllPending, navigate, localDemo])

  useEffect(() => () => {
    for (const timerId of saveTimers.current.values()) window.clearTimeout(timerId)
  }, [])

  if (attemptData && ['submitted', 'time_expired', 'cancelled'].includes(attemptData.attempt?.status)) {
    return <Navigate to="/estudiante/finalizado" replace />
  }
  if (loading) return <section className="student-panel"><p>Cargando tu examen…</p></section>
  if (!engine?.questions?.length) {
    return <section className="student-panel"><h1>No se pudieron cargar las preguntas.</h1>{message && <div className="form-alert danger">{message}</div>}<button className="button secondary" onClick={loadEngine}>Reintentar</button></section>
  }

  const questions = engine.questions
  const currentQuestion = questions[currentOrder - 1] || questions[0]
  const currentAnswer = answers[currentQuestion.id] || defaultAnswer(currentQuestion.answer)
  const answeredCount = questions.filter((question) => answerPresent(question, answers[question.id] || question.answer, evidenceByQuestion[question.id] ?? question.evidence)).length
  const currentSaveState = saveStates[currentQuestion.id] || (offlineMode ? 'offline' : 'saved')
  const runtime = engine.runtime || {}
  const previousDisabled = currentOrder <= 1 || (runtime.navigation === 'sequential' && !runtime.allowBacktrack)

  const canMapNavigate = (order) => {
    if (runtime.navigation === 'free') return true
    if (!runtime.allowBacktrack) return order === currentOrder || order === currentOrder + 1
    return order <= maxReachedOrder + 1
  }

  return (
    <section className="exam-runtime" aria-busy={loading}>
      <ExamSecurityGuard
        sessionToken={sessionToken}
        config={runtime.security || engine.exam?.security}
        studentName={attemptData?.student?.displayName || 'Estudiante'}
        examTitle={engine.exam?.title || 'Examen'}
      />
      <div className="mobile-exam-status">
        <ExamTimer value={timer.formatted} warning={timer.warning} critical={timer.critical} />
        <ExamProgress current={currentOrder} total={questions.length} />
      </div>

      {message && <div className={`form-alert ${offlineMode ? 'warning' : timeLocked ? 'danger' : 'info'} exam-runtime-alert`}>{message}</div>}

      <div className="exam-layout">
        <aside className="exam-status-panel">
          <ExamTimer value={timer.formatted} warning={timer.warning} critical={timer.critical} />
          <ExamProgress current={currentOrder} total={questions.length} />
          <SaveStatus state={currentSaveState} />
          <div className="exam-answer-count"><strong>{answeredCount}</strong><span>respondidas de {questions.length}</span></div>
          <div className="question-map" aria-label="Mapa de preguntas">
            {questions.map((question) => {
              const answered = answerPresent(question, answers[question.id] || question.answer, evidenceByQuestion[question.id] ?? question.evidence)
              const allowed = canMapNavigate(question.order)
              return (
                <button
                  type="button"
                  key={question.id}
                  className={`${answered ? 'answered' : ''} ${question.order === currentOrder ? 'current' : ''}`}
                  onClick={() => allowed && goTo(question.order)}
                  disabled={!allowed || timeLocked}
                  aria-label={`Pregunta ${question.order}${answered ? ', respondida' : ', sin responder'}`}
                  aria-current={question.order === currentOrder ? 'step' : undefined}
                >{question.order}</button>
              )
            })}
          </div>
        </aside>

        <div className="exam-workspace">
          <div className="exam-workspace-head">
            <div>
              <p className="eyebrow">{engine.exam?.course?.code || 'Evaluación'}</p>
              <h1>{engine.exam?.title}</h1>
            </div>
            <SaveStatus state={currentSaveState} />
          </div>

          <fieldset className="question-fieldset" disabled={timeLocked}>
            <StudentQuestionRenderer
              question={currentQuestion}
              answer={currentAnswer}
              onChange={(value) => updateAnswer(currentQuestion.id, value)}
              evidence={evidenceByQuestion[currentQuestion.id] ?? currentQuestion.evidence ?? null}
              sessionToken={sessionToken}
              onEvidenceChange={(evidence) => updateEvidence(currentQuestion.id, evidence)}
              disabled={timeLocked}
            />
          </fieldset>

          <div className="exam-navigation">
            <button className="button secondary" type="button" onClick={() => goTo(currentOrder - 1)} disabled={previousDisabled || timeLocked}>Anterior</button>
            <span>{answeredCount} de {questions.length} respondidas</span>
            {currentOrder < questions.length ? (
              <button className="button primary" type="button" onClick={() => goTo(currentOrder + 1)} disabled={timeLocked}>Siguiente</button>
            ) : (
              <button className="button primary" type="button" onClick={review} disabled={timeLocked}>Revisar y enviar</button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
