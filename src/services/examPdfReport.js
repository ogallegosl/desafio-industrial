import { buildTextPdf, downloadBlob, safePdfFilename } from '../utils/simplePdf'
import { formatCorrectResponse, formatResponse, secondsToClock } from '../utils/resultsExportFormatting'

function dateTime(value) {
  if (!value) return '-'
  try { return new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) } catch { return String(value) }
}

export function downloadStudentAttemptPdf(attemptData) {
  const student = attemptData?.student || {}
  const attempt = attemptData?.attempt || {}
  const exam = attemptData?.exam || {}
  const grading = attemptData?.grading || {}
  const name = [student.lastName, student.firstName].filter(Boolean).join(', ') || student.displayName || 'Estudiante'
  const sections = []
  const detailLines = (grading.details || []).flatMap((item) => [
    { text: `Pregunta ${item.order}. ${item.prompt}`, bold: true, after: 1 },
    { text: `Respuesta: ${item.studentAnswer || 'Sin respuesta'}`, indent: 10 },
    ...(item.correctAnswer ? [{ text: `Respuesta correcta: ${item.correctAnswer}`, indent: 10 }] : []),
    { text: `Puntaje: ${item.score ?? '-'} / ${item.maxScore ?? '-'}${item.reviewStatus === 'pending' ? ' · Revisión manual pendiente' : ''}`, indent: 10, after: 6 },
  ])
  if (detailLines.length) sections.push({ heading: 'Preguntas y respuestas', lines: detailLines })
  else sections.push({ heading: 'Comprobante de evaluación', lines: ['El examen fue registrado correctamente. El detalle de respuestas se encuentra disponible para el docente.'] })

  const blob = buildTextPdf({
    title: 'Comprobante individual del examen',
    metadataLines: [
      ['Estudiante', name], ['Examen', exam.title || 'Examen'], ['Curso', exam.course?.name || '-'], ['Intento', attempt.number || '-'],
      ['Inicio', dateTime(attempt.startedAt)], ['Finalización', dateTime(attempt.submittedAt || attempt.deadlineAt)],
      ['Puntaje', grading.rawScore != null ? `${grading.rawScore} / ${grading.maxRawScore}` : 'Pendiente'],
      ['Nota', grading.finalGrade != null ? `${grading.finalGrade} / ${grading.gradeScaleMax}` : grading.provisional ? 'Pendiente de revisión' : '-'],
    ],
    sections,
  })
  const filename = `Examen_${safePdfFilename(name)}_${safePdfFilename(exam.title)}.pdf`
  downloadBlob(blob, filename)
  return filename
}

export function downloadTeacherAttemptPdf({ exam, student, details }) {
  const name = [student?.lastName, student?.firstName].filter(Boolean).join(', ') || 'Estudiante'
  const attemptDetails = (details || []).filter((row) => row.attemptId === student.attemptId)
  const lines = attemptDetails.flatMap((row) => [
    { text: `Pregunta ${row.questionOrder}. ${row.prompt}`, bold: true, after: 1 },
    { text: `Respuesta del estudiante: ${formatResponse(row)}`, indent: 10 },
    { text: `Respuesta correcta / criterio: ${formatCorrectResponse(row)}`, indent: 10 },
    { text: `Puntaje: ${row.effectiveScore ?? 0} / ${row.points ?? 0}${row.reviewStatus === 'pending' ? ' · Revisión pendiente' : ''}`, indent: 10 },
    ...(row.teacherFeedback ? [{ text: `Retroalimentación: ${row.teacherFeedback}`, indent: 10 }] : []),
    { text: '', after: 4 },
  ])
  const blob = buildTextPdf({
    title: 'Examen rendido - reporte individual',
    metadataLines: [
      ['Estudiante', name], ['Examen', exam?.title || 'Examen'], ['Curso', exam?.cursos?.name || '-'], ['Intento', student?.attemptNumber || '-'],
      ['Inicio', dateTime(student?.startedAt)], ['Finalización', dateTime(student?.submittedAt || student?.deadlineAt)], ['Tiempo', secondsToClock(student?.elapsedSeconds) || '-'],
      ['Puntaje', student?.rawScore != null ? `${student.rawScore} / ${student.maxRawScore}` : '-'], ['Nota', student?.finalGrade != null ? String(student.finalGrade) : 'Pendiente'],
      ['Incidencias de integridad', student?.securityIncidents ?? 0],
    ],
    sections: [{ heading: 'Preguntas y respuestas', lines: lines.length ? lines : ['No se encontraron respuestas para este intento.'] }],
  })
  const filename = `Examen_${safePdfFilename(name)}_intento_${student?.attemptNumber || 1}.pdf`
  downloadBlob(blob, filename)
  return filename
}
