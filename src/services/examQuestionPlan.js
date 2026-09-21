import { supabase } from './supabaseClient'

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

function fail(error, fallback) {
  throw new Error(error?.message || fallback)
}

export async function loadExamQuestionPlan(examId, courseId) {
  const client = requireClient()
  const [fixedResult, rulesResult, banksResult, questionsResult] = await Promise.all([
    client.from('preguntas_examen').select(`
      id, exam_id, question_id, fixed_position, points_override, is_required,
      preguntas!inner(id, prompt, type, unit, topic, subtopic, difficulty, points, bank_id, parent_question_id,
        bancos_preguntas!inner(id, name, course_id))
    `).eq('exam_id', examId).order('fixed_position', { ascending: true, nullsFirst: false }),
    client.from('reglas_seleccion_examen').select(`
      id, exam_id, bank_id, unit, topic, subtopic, difficulty, question_type,
      quantity, rule_order, points_override, metadata,
      bancos_preguntas(id, name, course_id)
    `).eq('exam_id', examId).order('rule_order', { ascending: true }),
    client.from('bancos_preguntas').select('id, name, course_id, is_archived').eq('course_id', courseId).eq('is_archived', false).order('name'),
    client.from('preguntas').select(`
      id, bank_id, type, prompt, unit, topic, subtopic, difficulty, points, is_active, parent_question_id,
      bancos_preguntas!inner(id, name, course_id, is_archived)
    `).eq('bancos_preguntas.course_id', courseId).eq('bancos_preguntas.is_archived', false).eq('is_active', true).is('parent_question_id', null).order('updated_at', { ascending: false }),
  ])

  if (fixedResult.error) fail(fixedResult.error, 'No se pudieron cargar las preguntas fijas.')
  if (rulesResult.error) fail(rulesResult.error, 'No se pudieron cargar las reglas aleatorias.')
  if (banksResult.error) fail(banksResult.error, 'No se pudieron cargar los bancos del curso.')
  if (questionsResult.error) fail(questionsResult.error, 'No se pudo cargar el catálogo de preguntas.')

  return {
    fixed: fixedResult.data || [],
    rules: rulesResult.data || [],
    banks: banksResult.data || [],
    questions: questionsResult.data || [],
  }
}

export function countRuleCandidates(rule, questions, excludedIds = new Set()) {
  return questions.filter((q) => {
    if (excludedIds.has(q.id)) return false
    if (rule.bankId && q.bank_id !== rule.bankId) return false
    if (rule.unit && q.unit !== rule.unit) return false
    if (rule.topic && q.topic !== rule.topic) return false
    if (rule.subtopic && q.subtopic !== rule.subtopic) return false
    if (rule.difficulty && q.difficulty !== rule.difficulty) return false
    if (rule.questionType && q.type !== rule.questionType) return false
    return true
  }).length
}

export async function addFixedQuestion(examId, questionId, position = null, pointsOverride = null) {
  const client = requireClient()
  const { data, error } = await client.from('preguntas_examen').insert({
    exam_id: examId,
    question_id: questionId,
    fixed_position: position,
    points_override: pointsOverride === '' || pointsOverride == null ? null : Number(pointsOverride),
    is_required: true,
  }).select('*').single()
  if (error) fail(error, 'No se pudo añadir la pregunta fija.')
  return data
}

export async function updateFixedQuestion(linkId, patch = {}) {
  const client = requireClient()
  const payload = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'pointsOverride')) {
    const value = patch.pointsOverride
    payload.points_override = value === '' || value == null ? null : Number(value)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'fixedPosition')) {
    const value = patch.fixedPosition
    payload.fixed_position = value === '' || value == null ? null : Number(value)
  }
  if (!Object.keys(payload).length) return null
  const { data, error } = await client.from('preguntas_examen').update(payload).eq('id', linkId).select('*').single()
  if (error) fail(error, 'No se pudo actualizar la ponderación de la pregunta fija.')
  return data
}

export async function removeFixedQuestion(linkId) {
  const client = requireClient()
  const { error } = await client.from('preguntas_examen').delete().eq('id', linkId)
  if (error) fail(error, 'No se pudo retirar la pregunta fija.')
}

export async function addSelectionRule(examId, rule) {
  const client = requireClient()
  const { data, error } = await client.from('reglas_seleccion_examen').insert({
    exam_id: examId,
    bank_id: rule.bankId || null,
    unit: rule.unit || null,
    topic: rule.topic || null,
    subtopic: rule.subtopic || null,
    difficulty: rule.difficulty || null,
    question_type: rule.questionType || null,
    quantity: Number(rule.quantity),
    rule_order: Number(rule.ruleOrder || 0),
    points_override: rule.pointsOverride === '' || rule.pointsOverride == null ? null : Number(rule.pointsOverride),
    metadata: { label: rule.label?.trim() || null },
  }).select('*').single()
  if (error) fail(error, 'No se pudo crear la regla de selección.')
  return data
}

export async function removeSelectionRule(ruleId) {
  const client = requireClient()
  const { error } = await client.from('reglas_seleccion_examen').delete().eq('id', ruleId)
  if (error) fail(error, 'No se pudo eliminar la regla de selección.')
}

export async function updateSelectionRule(ruleId, patch) {
  const client = requireClient()
  const { data, error } = await client.from('reglas_seleccion_examen').update(patch).eq('id', ruleId).select('*').single()
  if (error) fail(error, 'No se pudo actualizar la regla.')
  return data
}
