import { supabase, hasSupabaseConfig } from './supabaseClient'
import { listTeacherExams } from './examManagement'

function ensureSupabase() {
  if (!hasSupabaseConfig || !supabase) throw new Error('La conexión con Supabase todavía no está configurada.')
}

function rpcPayload(data, fallback) {
  if (data == null) return fallback
  return data
}

export async function listExamsForAnalytics() {
  return listTeacherExams()
}

export async function getExamAnalytics(examId) {
  ensureSupabase()
  if (!examId) throw new Error('Selecciona un examen para consultar sus resultados.')

  const [overviewResult, questionResult, studentResult, incidentResult, attemptMetaResult] = await Promise.all([
    supabase.rpc('get_exam_overview', { p_exam_id: examId }),
    supabase.rpc('get_exam_question_analytics', { p_exam_id: examId }),
    supabase.rpc('get_exam_student_results', { p_exam_id: examId }),
    supabase.from('logs').select('attempt_id,event_type,event_at,metadata').eq('exam_id', examId).like('event_type', 'SECURITY_%'),
    supabase.from('intentos').select('id,submission_reason,forced_submit_at,forced_submit_reason').eq('exam_id', examId),
  ])

  if (overviewResult.error) throw overviewResult.error
  if (questionResult.error) throw questionResult.error
  if (studentResult.error) throw studentResult.error
  if (incidentResult.error) throw incidentResult.error
  if (attemptMetaResult.error) throw attemptMetaResult.error

  const attemptIds = (attemptMetaResult.data || []).map((row) => row.id).filter(Boolean)
  const gradeResult = attemptIds.length
    ? await supabase
        .from('calificaciones')
        .select('attempt_id,auto_score,manual_score,raw_score,max_raw_score,final_grade,pending_manual_reviews')
        .in('attempt_id', attemptIds)
    : { data: [], error: null }
  if (gradeResult.error) throw gradeResult.error

  // calificaciones is the authoritative persisted grade row. Overlay it on the
  // analytics RPC so a manual review completed moments ago cannot leave the
  // teacher panel or a generated PDF showing a stale "Pendiente" value.
  const gradeByAttempt = new Map((gradeResult.data || []).map((row) => [row.attempt_id, row]))
  const attemptMeta = new Map((attemptMetaResult.data || []).map((row) => [row.id, row]))
  const incidentCounts = new Map()
  for (const row of incidentResult.data || []) {
    if (!row.attempt_id || row.event_type === 'SECURITY_TAB_RETURNED') continue
    incidentCounts.set(row.attempt_id, (incidentCounts.get(row.attempt_id) || 0) + 1)
  }
  const students = rpcPayload(studentResult.data, []).map((row) => {
    const grade = gradeByAttempt.get(row.attemptId)
    const finalGrade = grade?.final_grade ?? row.finalGrade
    return {
      ...row,
      autoScore: grade?.auto_score ?? row.autoScore,
      manualScore: grade?.manual_score ?? row.manualScore,
      rawScore: grade?.raw_score ?? row.rawScore,
      maxRawScore: grade?.max_raw_score ?? row.maxRawScore,
      finalGrade,
      pendingManualReviews: finalGrade != null
        ? 0
        : Number(grade?.pending_manual_reviews ?? row.pendingManualReviews ?? 0),
      securityIncidents: incidentCounts.get(row.attemptId) || 0,
      submissionReason: attemptMeta.get(row.attemptId)?.submission_reason || null,
      forcedSubmitAt: attemptMeta.get(row.attemptId)?.forced_submit_at || null,
      forcedSubmitReason: attemptMeta.get(row.attemptId)?.forced_submit_reason || null,
    }
  })

  const overview = { ...rpcPayload(overviewResult.data, {}) }
  const closedStudents = students.filter((row) => ['submitted', 'time_expired'].includes(row.status))
  const gradedStudents = closedStudents.filter((row) => row.finalGrade != null && Number.isFinite(Number(row.finalGrade)))
  overview.pendingManualReviews = students.reduce((sum, row) => sum + Number(row.pendingManualReviews || 0), 0)
  overview.gradedAttempts = gradedStudents.length
  if (gradedStudents.length) {
    overview.averageGrade = gradedStudents.reduce((sum, row) => sum + Number(row.finalGrade), 0) / gradedStudents.length
  }

  return {
    overview,
    questions: rpcPayload(questionResult.data, []),
    students,
    securityIncidents: incidentResult.data || [],
  }
}
