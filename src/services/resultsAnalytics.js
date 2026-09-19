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

  const [overviewResult, questionResult, studentResult, incidentResult] = await Promise.all([
    supabase.rpc('get_exam_overview', { p_exam_id: examId }),
    supabase.rpc('get_exam_question_analytics', { p_exam_id: examId }),
    supabase.rpc('get_exam_student_results', { p_exam_id: examId }),
    supabase.from('logs').select('attempt_id,event_type,event_at,metadata').eq('exam_id', examId).like('event_type', 'SECURITY_%'),
  ])

  if (overviewResult.error) throw overviewResult.error
  if (questionResult.error) throw questionResult.error
  if (studentResult.error) throw studentResult.error
  if (incidentResult.error) throw incidentResult.error

  const incidentCounts = new Map()
  for (const row of incidentResult.data || []) {
    if (!row.attempt_id || row.event_type === 'SECURITY_TAB_RETURNED') continue
    incidentCounts.set(row.attempt_id, (incidentCounts.get(row.attempt_id) || 0) + 1)
  }
  const students = rpcPayload(studentResult.data, []).map((row) => ({ ...row, securityIncidents: incidentCounts.get(row.attemptId) || 0 }))

  return {
    overview: rpcPayload(overviewResult.data, {}),
    questions: rpcPayload(questionResult.data, []),
    students,
    securityIncidents: incidentResult.data || [],
  }
}
