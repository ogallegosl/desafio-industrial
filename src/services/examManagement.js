import { supabase } from './supabaseClient'

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

function fail(error, fallback) {
  const message = error?.message || fallback
  throw new Error(message)
}

export async function listTeacherCourses() {
  const client = requireClient()
  const { data, error } = await client
    .from('cursos')
    .select('id, code, name, description, academic_period, section, is_active, archived_at, created_at, updated_at')
    .order('name', { ascending: true })

  if (error) fail(error, 'No se pudieron cargar los cursos.')
  return data ?? []
}

export async function createTeacherCourse(payload, userId) {
  const client = requireClient()
  const { data: teacher, error: teacherError } = await client
    .from('docentes')
    .select('id')
    .eq('usuario_id', userId)
    .maybeSingle()

  if (teacherError) fail(teacherError, 'No se pudo identificar el perfil docente.')
  if (!teacher) throw new Error('La cuenta no tiene un perfil docente asociado para crear cursos.')

  const { data, error } = await client
    .from('cursos')
    .insert({
      docente_id: teacher.id,
      code: payload.code?.trim() || null,
      name: payload.name.trim(),
      description: payload.description?.trim() || null,
      academic_period: payload.academicPeriod?.trim() || null,
      section: payload.section?.trim() || null,
      is_active: true,
    })
    .select('id, docente_id, code, name, description, academic_period, section, is_active, archived_at, created_at, updated_at')
    .single()

  if (error) fail(error, 'No se pudo crear el curso.')
  return data
}

export async function updateTeacherCourse(courseId, payload) {
  const client = requireClient()
  const { data, error } = await client
    .from('cursos')
    .update({
      code: payload.code?.trim() || null,
      name: payload.name.trim(),
      description: payload.description?.trim() || null,
      academic_period: payload.academicPeriod?.trim() || null,
      section: payload.section?.trim() || null,
      is_active: payload.isActive !== false,
      archived_at: payload.isActive === false ? new Date().toISOString() : null,
    })
    .eq('id', courseId)
    .select('id, docente_id, code, name, description, academic_period, section, is_active, archived_at, created_at, updated_at')
    .single()

  if (error) fail(error, 'No se pudo actualizar el curso.')
  return data
}

export async function listTeacherExams() {
  const client = requireClient()
  const { data, error } = await client
    .from('examenes')
    .select(`
      id,
      course_id,
      title,
      description,
      instructions,
      starts_at,
      ends_at,
      status,
      accept_new_attempts,
      is_deleted,
      access_code_lookup,
      created_at,
      updated_at,
      cursos ( id, code, name, academic_period, section ),
      configuraciones_examen (
        duration_minutes,
        max_attempts,
        target_question_count,
        randomize_questions,
        randomize_options,
        navigation,
        allow_backtrack,
        auto_submit_on_timeout,
        result_visibility,
        show_results_after,
        grade_scale_max,
        passing_grade,
        settings
      )
    `)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })

  if (error) fail(error, 'No se pudieron cargar los exámenes.')
  return data ?? []
}

export async function getTeacherExam(examId) {
  const client = requireClient()
  const { data, error } = await client
    .from('examenes')
    .select(`
      id,
      course_id,
      owner_user_id,
      title,
      description,
      instructions,
      access_code_lookup,
      starts_at,
      ends_at,
      status,
      accept_new_attempts,
      is_deleted,
      created_at,
      updated_at,
      cursos ( id, code, name, academic_period, section ),
      configuraciones_examen ( exam_id, duration_minutes, max_attempts, target_question_count, randomize_questions, randomize_options, navigation, allow_backtrack, auto_submit_on_timeout, result_visibility, show_results_after, grade_scale_max, passing_grade, require_student_code, require_first_name, require_last_name, require_email, require_section, restrict_to_enrolled_students, settings, created_at, updated_at )
    `)
    .eq('id', examId)
    .eq('is_deleted', false)
    .maybeSingle()

  if (error) fail(error, 'No se pudo cargar el examen.')
  if (!data) throw new Error('El examen no existe o no está disponible para esta cuenta.')

  const [{ count: fixedCount, error: fixedError }, { data: rules, error: rulesError }, { count: attemptCount, error: attemptError }] = await Promise.all([
    client.from('preguntas_examen').select('id', { count: 'exact', head: true }).eq('exam_id', examId),
    client.from('reglas_seleccion_examen').select('quantity').eq('exam_id', examId),
    client.from('intentos').select('id', { count: 'exact', head: true }).eq('exam_id', examId),
  ])

  if (fixedError) fail(fixedError, 'No se pudo contar las preguntas fijas.')
  if (rulesError) fail(rulesError, 'No se pudieron cargar las reglas de selección.')
  if (attemptError) fail(attemptError, 'No se pudo verificar el historial de intentos.')

  const randomCount = (rules ?? []).reduce((sum, row) => sum + Number(row.quantity || 0), 0)
  return {
    ...data,
    attemptCount: Number(attemptCount || 0),
    questionStats: {
      fixedCount: Number(fixedCount || 0),
      randomCount,
      configuredCount: Number(fixedCount || 0) + randomCount,
    },
  }
}

export async function createTeacherExam({ exam, config, accessCode }) {
  const client = requireClient()
  const { data, error } = await client.rpc('create_exam_bundle', {
    p_exam: exam,
    p_config: config,
    p_access_code: accessCode?.trim() || null,
  })
  if (error) fail(error, 'No se pudo crear el examen de forma transaccional.')
  if (!data) throw new Error('El examen no devolvió un identificador válido.')
  return data
}

export async function updateTeacherExam({ examId, exam, config, accessCode, clearAccessCode = false }) {
  const client = requireClient()
  const { error } = await client.rpc('update_exam_bundle', {
    p_exam_id: examId,
    p_exam: exam,
    p_config: config,
    p_access_code: accessCode?.trim() || null,
    p_clear_access_code: Boolean(clearAccessCode),
  })
  if (error) fail(error, 'No se pudo actualizar el examen de forma transaccional.')
  return examId
}

export async function changeExamStatus(examId, status) {
  const client = requireClient()
  const { data, error } = await client
    .from('examenes')
    .update({ status })
    .eq('id', examId)
    .eq('is_deleted', false)
    .select('id, status')
    .single()

  if (error) fail(error, 'No se pudo cambiar el estado del examen.')
  return data
}

export async function duplicateTeacherExam(examId) {
  const client = requireClient()
  const { data, error } = await client.rpc('duplicate_exam', { p_exam_id: examId })
  if (error) fail(error, 'No se pudo duplicar el examen.')
  return data
}

export async function softDeleteTeacherExam(examId) {
  const client = requireClient()
  const { error } = await client
    .from('examenes')
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      status: 'archived',
    })
    .eq('id', examId)

  if (error) fail(error, 'No se pudo eliminar el examen.')
}

export async function getTeacherExamDashboard() {
  const client = requireClient()
  const { data, error } = await client.rpc('get_teacher_dashboard')
  if (error) fail(error, 'No se pudo cargar el resumen docente.')
  return {
    active: Number(data?.active || 0),
    upcoming: Number(data?.upcoming || 0),
    participants: Number(data?.participants || 0),
    pendingReviews: Number(data?.pendingReviews || 0),
    recentExams: Array.isArray(data?.recentExams) ? data.recentExams : [],
  }
}
