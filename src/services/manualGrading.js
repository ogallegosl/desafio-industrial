import { supabase, hasSupabaseConfig } from './supabaseClient'
import { STORAGE_BUCKETS, TABLES } from './databaseSchema'

function ensureSupabase() {
  if (!hasSupabaseConfig || !supabase) throw new Error('La conexión con Supabase todavía no está configurada.')
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

export async function listManualReviews() {
  ensureSupabase()

  const { data: responses, error: responseError } = await supabase
    .from(TABLES.ANSWERS)
    .select('id,attempt_question_id,attempt_id,answer_text,answer_numeric,selected_option_ids,answer_payload,is_answered,is_correct,auto_score,manual_score,review_status,teacher_feedback,manual_grading_details,manual_graded_at,reviewed_by_user_id,answered_at,last_saved_at')
    .in('review_status', ['pending', 'reviewed'])
    .order('updated_at', { ascending: false })

  if (responseError) throw responseError
  if (!responses?.length) return []

  const attemptIds = unique(responses.map((row) => row.attempt_id))
  const questionIds = unique(responses.map((row) => row.attempt_question_id))

  const [{ data: attempts, error: attemptsError }, { data: questions, error: questionsError }, { data: evidence, error: evidenceError }] = await Promise.all([
    supabase.from(TABLES.ATTEMPTS).select('id,exam_id,student_id,status,attempt_number,started_at,submitted_at,deadline_at').in('id', attemptIds),
    supabase.from(TABLES.ATTEMPT_QUESTIONS).select('id,attempt_id,question_id,display_order,question_type,prompt_snapshot,points_snapshot,options_snapshot,metadata_snapshot,rubric_snapshot').in('id', questionIds),
    supabase.from(TABLES.EVIDENCE).select('id,response_id,attempt_id,attempt_question_id,original_filename,mime_type,size_bytes,uploaded_at,bucket_name,object_path,metadata').in('attempt_id', attemptIds).is('deleted_at', null),
  ])

  if (attemptsError) throw attemptsError
  if (questionsError) throw questionsError
  if (evidenceError) throw evidenceError

  const closedAttempts = (attempts || []).filter((row) => ['submitted', 'time_expired'].includes(row.status))
  const allowedAttemptIds = new Set(closedAttempts.map((row) => row.id))
  const filteredResponses = responses.filter((row) => allowedAttemptIds.has(row.attempt_id))
  if (!filteredResponses.length) return []

  const studentIds = unique(closedAttempts.map((row) => row.student_id))
  const examIds = unique(closedAttempts.map((row) => row.exam_id))

  const [{ data: students, error: studentsError }, { data: exams, error: examsError }, { data: grades, error: gradesError }] = await Promise.all([
    studentIds.length ? supabase.from(TABLES.STUDENTS).select('id,student_code,first_name,last_name,email,section').in('id', studentIds) : Promise.resolve({ data: [], error: null }),
    examIds.length ? supabase.from(TABLES.EXAMS).select('id,title,course_id').in('id', examIds) : Promise.resolve({ data: [], error: null }),
    attemptIds.length ? supabase.from(TABLES.GRADES).select('attempt_id,auto_score,manual_score,raw_score,max_raw_score,final_grade,pending_manual_reviews,is_published,graded_at').in('attempt_id', attemptIds) : Promise.resolve({ data: [], error: null }),
  ])

  if (studentsError) throw studentsError
  if (examsError) throw examsError
  if (gradesError) throw gradesError

  const attemptMap = new Map(closedAttempts.map((row) => [row.id, row]))
  const questionMap = new Map((questions || []).map((row) => [row.id, row]))
  const studentMap = new Map((students || []).map((row) => [row.id, row]))
  const examMap = new Map((exams || []).map((row) => [row.id, row]))
  const gradeMap = new Map((grades || []).map((row) => [row.attempt_id, row]))
  const evidenceByResponse = new Map()
  for (const item of evidence || []) {
    const bucket = evidenceByResponse.get(item.response_id) || []
    bucket.push(item)
    evidenceByResponse.set(item.response_id, bucket)
  }

  return filteredResponses.map((response) => {
    const attempt = attemptMap.get(response.attempt_id) || null
    const question = questionMap.get(response.attempt_question_id) || null
    return {
      ...response,
      attempt,
      question,
      student: attempt ? studentMap.get(attempt.student_id) || null : null,
      exam: attempt ? examMap.get(attempt.exam_id) || null : null,
      grade: gradeMap.get(response.attempt_id) || null,
      evidence: evidenceByResponse.get(response.id) || [],
    }
  })
}

export async function gradeManualResponse({ responseId, score, feedback = '', rubricScores = [] }) {
  ensureSupabase()
  const { data, error } = await supabase.rpc('grade_manual_response', {
    p_response_id: responseId,
    p_manual_score: Number(score),
    p_teacher_feedback: feedback || null,
    p_rubric_scores: rubricScores,
  })
  if (error) throw error
  return data
}

export async function createEvidenceSignedUrl(evidence, expiresIn = 900) {
  ensureSupabase()
  if (!evidence?.object_path) return null
  const bucket = evidence.bucket_name || STORAGE_BUCKETS.STUDENT_EVIDENCE
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(evidence.object_path, expiresIn)
  if (error) throw error
  return data?.signedUrl || null
}

export async function saveRubricTemplate({ questionId, name, instructions = '', criteria = [] }) {
  ensureSupabase()
  if (!questionId) throw new Error('La pregunta de origen no está disponible para guardar la rúbrica.')
  const cleanCriteria = criteria.map((item, index) => ({
    id: item.id,
    name: String(item.name || '').trim(),
    description: String(item.description || '').trim() || null,
    maxPoints: Number(item.maxPoints),
    position: index + 1,
  }))
  if (!cleanCriteria.length || cleanCriteria.some((item) => !item.name || !Number.isFinite(item.maxPoints) || item.maxPoints <= 0)) {
    throw new Error('Todos los criterios deben tener nombre y puntaje máximo mayor que cero.')
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user?.id) throw new Error('No se pudo identificar al docente.')

  const { data: existing, error: existingError } = await supabase
    .from('rubricas')
    .select('id')
    .eq('question_id', questionId)
    .maybeSingle()
  if (existingError) throw existingError

  let rubricId = existing?.id
  if (rubricId) {
    const { error } = await supabase
      .from('rubricas')
      .update({ name: name.trim(), instructions: instructions.trim() || null, is_active: true })
      .eq('id', rubricId)
    if (error) throw error
    const { error: deleteError } = await supabase.from('rubrica_criterios').delete().eq('rubric_id', rubricId)
    if (deleteError) throw deleteError
  } else {
    const { data, error } = await supabase
      .from('rubricas')
      .insert({
        question_id: questionId,
        name: name.trim(),
        instructions: instructions.trim() || null,
        is_active: true,
        created_by_user_id: userData.user.id,
      })
      .select('id')
      .single()
    if (error) throw error
    rubricId = data.id
  }

  const { error: criteriaError } = await supabase.from('rubrica_criterios').insert(
    cleanCriteria.map((item) => ({
      rubric_id: rubricId,
      name: item.name,
      description: item.description,
      max_points: item.maxPoints,
      position: item.position,
    })),
  )
  if (criteriaError) throw criteriaError
  return rubricId
}
