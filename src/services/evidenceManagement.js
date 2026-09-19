import { supabase, hasSupabaseConfig } from './supabaseClient'
import { STORAGE_BUCKETS, TABLES } from './databaseSchema'

function ensureSupabase() {
  if (!hasSupabaseConfig || !supabase) throw new Error('La conexión con Supabase todavía no está configurada.')
}

export async function listSubmittedEvidence() {
  ensureSupabase()
  const { data: evidenceRows, error: evidenceError } = await supabase
    .from(TABLES.EVIDENCE)
    .select('id,response_id,attempt_id,attempt_question_id,original_filename,mime_type,size_bytes,uploaded_at,bucket_name,object_path,metadata')
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })

  if (evidenceError) throw evidenceError
  if (!evidenceRows?.length) return []

  const attemptIds = [...new Set(evidenceRows.map((row) => row.attempt_id).filter(Boolean))]
  const questionIds = [...new Set(evidenceRows.map((row) => row.attempt_question_id).filter(Boolean))]

  const [{ data: attempts, error: attemptsError }, { data: questions, error: questionsError }] = await Promise.all([
    supabase.from(TABLES.ATTEMPTS).select('id,status,submitted_at,student_id,exam_id').in('id', attemptIds),
    questionIds.length
      ? supabase.from(TABLES.ATTEMPT_QUESTIONS).select('id,display_order,prompt_snapshot,points_snapshot,question_type').in('id', questionIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (attemptsError) throw attemptsError
  if (questionsError) throw questionsError

  const closedAttempts = (attempts || []).filter((row) => ['submitted', 'time_expired'].includes(row.status))
  const allowedAttemptIds = new Set(closedAttempts.map((row) => row.id))
  const filtered = evidenceRows.filter((row) => allowedAttemptIds.has(row.attempt_id))
  if (!filtered.length) return []

  const studentIds = [...new Set(closedAttempts.map((row) => row.student_id).filter(Boolean))]
  const examIds = [...new Set(closedAttempts.map((row) => row.exam_id).filter(Boolean))]
  const [{ data: students, error: studentsError }, { data: exams, error: examsError }] = await Promise.all([
    studentIds.length
      ? supabase.from(TABLES.STUDENTS).select('id,student_code,first_name,last_name,email,section').in('id', studentIds)
      : Promise.resolve({ data: [], error: null }),
    examIds.length
      ? supabase.from(TABLES.EXAMS).select('id,title,course_id').in('id', examIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (studentsError) throw studentsError
  if (examsError) throw examsError

  const attemptMap = new Map(closedAttempts.map((row) => [row.id, row]))
  const studentMap = new Map((students || []).map((row) => [row.id, row]))
  const examMap = new Map((exams || []).map((row) => [row.id, row]))
  const questionMap = new Map((questions || []).map((row) => [row.id, row]))

  return filtered.map((row) => {
    const attempt = attemptMap.get(row.attempt_id)
    return {
      ...row,
      attempt,
      student: attempt ? studentMap.get(attempt.student_id) ?? null : null,
      exam: attempt ? examMap.get(attempt.exam_id) ?? null : null,
      question: questionMap.get(row.attempt_question_id) ?? null,
    }
  })
}

export async function createEvidencePreviewUrl(evidence, expiresIn = 900) {
  ensureSupabase()
  if (!evidence?.object_path) return null
  const bucket = evidence.bucket_name || STORAGE_BUCKETS.STUDENT_EVIDENCE
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(evidence.object_path, expiresIn)
  if (error) throw error
  return data?.signedUrl || null
}
