import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStudentAttempt } from '../contexts/StudentAttemptContext'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'
import { clearExamSnapshot, clearPendingAnswers, readPendingAnswers, removePendingAnswer } from '../utils/offlineExamQueue'
import { recoverTimedOutStudentAnswers } from '../services/studentExamAccess'
import { clearRecoveryMarker } from '../utils/examRecovery'
import { downloadStudentAttemptPdf } from '../services/examPdfReport'

function resultTone(item) {
  if (item?.isCorrect === true) return 'correct'
  if (item?.isCorrect === false) return 'incorrect'
  return 'manual'
}

export default function ExamFinishedPage() {
  const { formatDateTime } = useGlobalSettings()
  const { attemptData, clearSession, refresh, sessionToken } = useStudentAttempt()
  const attempt = attemptData?.attempt
  const exam = attemptData?.exam
  const expired = attempt?.status === 'time_expired'
  const submitted = attempt?.status === 'submitted'
  const teacherForced = attempt?.submissionReason === 'TEACHER_FORCED'
  const recoverableClose = expired || teacherForced
  const grading = attemptData?.grading
  const isResultReentry = Boolean(attemptData?.resultAccess)
  const completedGradeReady = Boolean(grading && Number(grading.pendingManualReviews || 0) === 0 && grading.finalGrade != null)
  const canShowScore = grading && grading.rawScore != null
    && (!grading.embargoed || completedGradeReady)
    && (grading.visibility !== 'confirmation_only' || isResultReentry || completedGradeReady)
  const canShowGrade = canShowScore && grading.finalGrade != null
  const [pendingLocalCount, setPendingLocalCount] = useState(() => attempt?.id ? Object.keys(readPendingAnswers(attempt.id)).length : 0)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const recoveryStartedRef = useRef(false)

  const recoverLocalPending = useCallback(async () => {
    if (!attempt?.id || !sessionToken || !recoverableClose || recovering) return false
    const pending = readPendingAnswers(attempt.id)
    const entries = Object.entries(pending).map(([questionId, entry]) => ({
      attemptQuestionId: questionId,
      clientRevision: entry.revision,
      queuedAt: entry.queuedAt,
      ...entry.answer,
    }))
    if (!entries.length) {
      setPendingLocalCount(0)
      return true
    }
    if (!navigator.onLine) {
      setRecoveryMessage('Aún existen respuestas locales pendientes. Recupera la conexión antes de salir de esta pantalla.')
      return false
    }
    setRecovering(true)
    setRecoveryMessage('Consolidando respuestas locales pendientes…')
    try {
      const result = await recoverTimedOutStudentAnswers(sessionToken, entries)
      for (const item of result.recovery?.results || []) {
        if (item.accepted) removePendingAnswer(attempt.id, item.attemptQuestionId, item.clientRevision)
      }
      const remaining = Object.keys(readPendingAnswers(attempt.id)).length
      setPendingLocalCount(remaining)
      if (remaining === 0) {
        setRecoveryMessage('Las respuestas locales pendientes fueron consolidadas correctamente.')
        clearExamSnapshot(attempt.id)
      } else {
        setRecoveryMessage(`Quedan ${remaining} respuesta${remaining === 1 ? '' : 's'} local${remaining === 1 ? '' : 'es'} sin consolidar. No cierres esta pantalla todavía.`)
      }
      await refresh()
      return remaining === 0
    } catch (error) {
      setRecoveryMessage(error.message || 'No se pudo consolidar la cola local. Los datos permanecerán guardados en este dispositivo.')
      return false
    } finally {
      setRecovering(false)
    }
  }, [attempt?.id, recoverableClose, recovering, sessionToken, refresh])

  useEffect(() => {
    // Never erase a local queue merely because the attempt is closed. A timeout
    // may have happened while the connection was down. Clear only after the queue
    // is empty or after it has been recovered.
    if (attempt?.id && ['submitted', 'time_expired', 'cancelled'].includes(attempt?.status)) {
      const pending = Object.keys(readPendingAnswers(attempt.id)).length
      setPendingLocalCount(pending)
      if (pending === 0) clearExamSnapshot(attempt.id)
    }
  }, [attempt?.id, attempt?.status])

  useEffect(() => {
    if (!recoverableClose || !attempt?.id || !sessionToken || pendingLocalCount <= 0 || recoveryStartedRef.current) return
    recoveryStartedRef.current = true
    recoverLocalPending()
  }, [recoverableClose, attempt?.id, sessionToken, pendingLocalCount, recoverLocalPending])

  const downloadPdf = async () => {
    if (!attemptData || pdfBusy) return
    setPdfBusy(true)
    try {
      // Always refresh immediately before generating the PDF. Manual grading can
      // change after the student reaches this page, so the in-memory snapshot may
      // otherwise keep showing a stale "Pendiente" result.
      const fresh = await refresh()
      if (!fresh) throw new Error('No se pudo actualizar el resultado antes de generar el PDF. Intenta nuevamente.')
      await downloadStudentAttemptPdf(fresh)
    } finally {
      setPdfBusy(false)
    }
  }

  const exit = () => {
    if (pendingLocalCount > 0) return
    clearPendingAnswers(attempt?.id)
    clearExamSnapshot(attempt?.id)
    clearRecoveryMarker(attempt?.id)
    clearSession()
  }

  return (
    <section className="student-panel completed-card">
      <div className="completion-mark">{expired ? '!' : '✓'}</div>
      <p className="eyebrow">Intento cerrado</p>
      {attemptData?.localDemo && <div className="form-alert info local-demo-banner" role="status"><strong>Resultado DEMO local.</strong> Este resultado existe solo en este navegador. Las preguntas abiertas se muestran como pendientes para simular la revisión docente.</div>}
      <h1>{expired ? 'El tiempo terminó y el examen fue cerrado.' : teacherForced ? 'El docente finalizó la evaluación.' : submitted ? 'Tu examen fue enviado correctamente.' : 'El intento ya está cerrado.'}</h1>
      <p>{exam?.title || 'Examen'}</p>
      <div className="completion-details">
        <div><span>Inicio</span><strong>{formatDateTime(attempt?.startedAt)}</strong></div>
        <div><span>Cierre</span><strong>{formatDateTime(attempt?.submittedAt || attempt?.deadlineAt)}</strong></div>
        <div><span>Intento</span><strong>{attempt?.number || '—'}</strong></div>
        <div><span>Estado</span><strong>{expired ? 'Tiempo agotado' : teacherForced ? 'Finalizado por docente' : submitted ? 'Enviado' : attempt?.status || 'Cerrado'}</strong></div>
      </div>
      {canShowScore && <div className="completion-details grading-summary">
        <div><span>Puntos obtenidos</span><strong>{grading.rawScore} / {grading.maxRawScore}</strong></div>
        <div>
          <span>Nota final</span>
          <strong>{canShowGrade ? grading.finalGrade : grading.provisional ? 'Pendiente' : 'No publicada'}</strong>
          {Number(grading.finalGradeCap || grading.gradeScaleMax || 20) < Number(grading.gradeScaleMax || 20) && <small>Máximo programado: {grading.finalGradeCap}</small>}
        </div>
        <div><span>Corrección</span><strong>{grading.provisional ? 'Pendiente de revisión' : 'Completada'}</strong></div>
      </div>}
      {attemptData?.resultAccessCode && (
        <div className="form-alert info" role="note">
          <strong>Código personal de resultados: {attemptData.resultAccessCode}</strong>
          <span> Guárdalo y no lo compartas. Lo necesitarás junto con el código del examen y tus datos para volver a ingresar y descargar tu examen corregido.</span>
        </div>
      )}
      {grading?.embargoed && <p className="muted-copy">Las respuestas correctas y la retroalimentación permanecen protegidas hasta la fecha configurada por el docente. Si tu corrección ya terminó, tu propia nota final puede mostrarse sin liberar la clave de respuestas.</p>}
      {grading?.provisional && <p className="muted-copy">La nota final permanece pendiente porque existen respuestas que requieren revisión manual. Puedes descargar ahora una copia de tu examen con tus respuestas registradas y volver más adelante mediante <strong>Consultar mi examen / resultados</strong> para obtener el PDF actualizado.</p>}
      {!grading?.provisional && isResultReentry && canShowGrade && <p className="muted-copy">La revisión está completa. El PDF que descargues ahora incorpora tu nota final actualizada.</p>}
      {grading?.answersEmbargoed && <p className="muted-copy">Las respuestas correctas se habilitarán cuando cierre la ventana general del examen, para no exponer claves mientras otros estudiantes aún pueden rendirlo.</p>}
      {Array.isArray(grading?.details) && grading.details.length > 0 && (
        <section className="student-result-details" aria-label="Detalle de resultados">
          <h2>Detalle por pregunta</h2>
          {grading.details.map((item) => (
            <article className={`student-result-item ${resultTone(item)}`} key={`${item.order}-${item.prompt}`}>
              <div className="student-result-heading">
                <strong>Pregunta {item.order}</strong>
                <span>{item.score} / {item.maxScore} pt</span>
              </div>
              <p>{item.prompt}</p>
              <div className="student-result-answer"><span>Tu respuesta</span><strong>{item.studentAnswer || 'Sin respuesta'}</strong></div>
              {item.correctAnswer && <div className="student-result-answer"><span>Respuesta correcta</span><strong>{item.correctAnswer}</strong></div>}
              {item.teacherFeedback && <div className="student-result-feedback"><span>Retroalimentación docente</span><p>{item.teacherFeedback}</p></div>}
            </article>
          ))}
        </section>
      )}
      {!canShowScore && !grading?.embargoed && <p className="muted-copy">Tu examen quedó registrado. Puedes descargar una copia con tus respuestas. La nota final aparecerá cuando la corrección esté completa y corresponda su publicación.</p>}
      {recoveryMessage && <div className={`form-alert ${pendingLocalCount > 0 ? 'warning' : 'info'}`}>{recoveryMessage}</div>}
      {pendingLocalCount > 0 && (
        <div className="review-actions">
          <button className="button primary" type="button" onClick={recoverLocalPending} disabled={recovering || !navigator.onLine}>
            {recovering ? 'Recuperando…' : `Reintentar sincronización (${pendingLocalCount})`}
          </button>
          <span className="muted-copy">La salida permanecerá bloqueada para no borrar respuestas locales pendientes.</span>
        </div>
      )}
      <div className="completion-actions">
        <button className="button primary" type="button" onClick={downloadPdf} disabled={pdfBusy}>{pdfBusy ? 'Generando PDF…' : 'Descargar mi examen (PDF)'}</button>
        {pendingLocalCount === 0
          ? <Link className="button secondary" to="/" onClick={exit}>Salir</Link>
          : <button className="button secondary" type="button" disabled>Salir</button>}
      </div>
    </section>
  )
}
