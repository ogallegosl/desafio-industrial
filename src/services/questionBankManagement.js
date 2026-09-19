import { supabase } from './supabaseClient'

const QUESTION_MEDIA_BUCKET = 'question-media'
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const OPTION_TYPES = new Set(['single_choice', 'multiple_choice', 'image_single_choice'])

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

function fail(error, fallback) {
  throw new Error(error?.message || fallback)
}

function clean(value) {
  const next = typeof value === 'string' ? value.trim() : value
  return next === '' ? null : next
}

function sanitizeFilename(filename) {
  const extension = filename.includes('.') ? `.${filename.split('.').pop().toLowerCase()}` : ''
  const base = filename.replace(/\.[^.]+$/, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'imagen'
  return `${base}${extension}`
}

function buildAnswerKey(question) {
  switch (question.type) {
    case 'single_choice':
    case 'image_single_choice': {
      const correct = (question.options || []).find((option) => option.isCorrect)
      return correct ? { optionKey: correct.key } : {}
    }
    case 'multiple_choice':
      return { optionKeys: (question.options || []).filter((option) => option.isCorrect).map((option) => option.key) }
    case 'true_false':
      return { value: Boolean(question.trueFalseValue) }
    case 'short_text':
      return { answers: (question.acceptedAnswers || []).map((item) => item.trim()).filter(Boolean) }
    case 'numeric':
    case 'calculation':
    case 'calculation_evidence':
      if (question.numericMode === 'range') {
        return { min: Number(question.numericMin), max: Number(question.numericMax) }
      }
      return question.numericAnswer === '' || question.numericAnswer == null ? {} : { value: Number(question.numericAnswer) }
    default:
      return {}
  }
}

function buildGradingConfig(question) {
  if (question.type === 'short_text') {
    return {
      mode: question.shortTextMode || 'case_insensitive',
      trimWhitespace: question.trimWhitespace !== false,
      collapseWhitespace: question.collapseWhitespace === true,
    }
  }
  if (['numeric', 'calculation', 'calculation_evidence'].includes(question.type)) {
    const config = { numericMode: question.numericMode || (question.numericTolerance !== '' ? 'tolerance' : 'exact') }
    if (config.numericMode === 'range') {
      config.min = Number(question.numericMin)
      config.max = Number(question.numericMax)
    }
    if (question.type === 'calculation_evidence') config.requireEvidence = true
    return config
  }
  if (question.type === 'attachment') return { manualReview: true, requireAttachment: true }
  if (['essay', 'image_essay', 'case_group'].includes(question.type)) return { manualReview: true }
  return {}
}

function validateOptions(question) {
  if (!OPTION_TYPES.has(question.type)) return
  const options = question.options || []
  if (options.length < 2) throw new Error('La pregunta debe tener al menos dos alternativas.')
  if (options.some((option) => !option.content?.trim())) throw new Error('Todas las alternativas deben contener texto.')
  const correctCount = options.filter((option) => option.isCorrect).length
  if (question.type === 'multiple_choice' && correctCount < 1) throw new Error('Selecciona al menos una alternativa correcta.')
  if (question.type !== 'multiple_choice' && correctCount !== 1) throw new Error('Selecciona exactamente una alternativa correcta.')
}

function validateQuestion(question, isChild = false) {
  if (!question.bankId) throw new Error('Selecciona un banco de preguntas.')
  if (!question.prompt?.trim()) throw new Error('Escribe el enunciado de la pregunta.')
  if (!question.type) throw new Error('Selecciona un tipo de pregunta.')
  if (isChild && question.type === 'case_group') throw new Error('Un caso no puede contener otro caso.')
  if (isChild && ['calculation_evidence', 'attachment'].includes(question.type)) throw new Error('Las subpreguntas de un caso no pueden requerir archivos. Crea esa pregunta de forma independiente.')
  if (Number(question.points) < 0) throw new Error('El puntaje no puede ser negativo.')
  if (!isChild && ['image_single_choice', 'image_essay'].includes(question.type)
      && !question.mediaFile && !question.existingMediaUrl) {
    throw new Error('Este tipo de pregunta requiere una imagen.')
  }
  validateOptions(question)

  if (question.type === 'short_text' && !(question.acceptedAnswers || []).some((item) => item.trim())) {
    throw new Error('Añade al menos una respuesta aceptable para la pregunta corta.')
  }
  if (['numeric', 'calculation', 'calculation_evidence'].includes(question.type)) {
    const mode = question.numericMode || (question.numericTolerance !== '' ? 'tolerance' : 'exact')
    if (mode === 'range') {
      if (question.numericMin === '' || question.numericMax === '' || Number.isNaN(Number(question.numericMin)) || Number.isNaN(Number(question.numericMax))) {
        throw new Error('Define los valores mínimo y máximo del intervalo aceptado.')
      }
      if (Number(question.numericMin) > Number(question.numericMax)) throw new Error('El mínimo del intervalo no puede superar al máximo.')
    } else {
      if (question.numericAnswer === '' || question.numericAnswer == null || Number.isNaN(Number(question.numericAnswer))) {
        throw new Error('Define una respuesta numérica válida.')
      }
      if (mode === 'tolerance' && (question.numericTolerance === '' || question.numericTolerance == null || Number(question.numericTolerance) < 0)) {
        throw new Error('Define una tolerancia mayor o igual que cero.')
      }
    }
  }
  if (question.type === 'case_group') {
    if (!question.children?.length) throw new Error('El caso debe contener al menos una subpregunta.')
    question.children.forEach((child) => validateQuestion({ ...child, bankId: question.bankId }, true))
  }
}

function dbQuestionPayload(question, userId, parentQuestionId = null, casePosition = null) {
  const metadata = { ...(question.metadata || {}), editorVersion: 1 }
  if (question.removeMedia || question.mediaFile || !['image_single_choice', 'image_essay'].includes(question.type)) {
    delete metadata.demoMediaUrl
  }
  return {
    bank_id: question.bankId,
    type: question.type,
    prompt: question.prompt.trim(),
    unit: clean(question.unit),
    topic: clean(question.topic),
    subtopic: clean(question.subtopic),
    difficulty: question.difficulty || 'intermediate',
    points: question.type === 'case_group'
      ? (question.children || []).reduce((sum, child) => sum + Number(child.points || 0), 0)
      : Number(question.points ?? 1),
    answer_key: buildAnswerKey(question),
    numeric_tolerance: ['numeric', 'calculation', 'calculation_evidence'].includes(question.type)
      && (question.numericMode || (question.numericTolerance !== '' ? 'tolerance' : 'exact')) === 'tolerance'
      && question.numericTolerance !== '' && question.numericTolerance != null ? Number(question.numericTolerance) : null,
    explanation: clean(question.explanation),
    grading_config: buildGradingConfig(question),
    metadata,
    is_active: question.isActive !== false,
    archived_at: question.isActive === false ? new Date().toISOString() : null,
    created_by_user_id: userId,
    parent_question_id: parentQuestionId,
    case_position: casePosition,
  }
}

async function getQuestionRow(questionId) {
  const client = requireClient()
  const { data, error } = await client.from('preguntas').select('*').eq('id', questionId).maybeSingle()
  if (error) fail(error, 'No se pudo cargar la pregunta.')
  return data
}

async function syncOptions(questionId, question) {
  const client = requireClient()
  const { error: deleteError } = await client.from('alternativas').delete().eq('question_id', questionId)
  if (deleteError) fail(deleteError, 'No se pudieron actualizar las alternativas.')
  if (!OPTION_TYPES.has(question.type)) return

  const rows = (question.options || []).map((option, index) => ({
    question_id: questionId,
    option_key: option.key || String.fromCharCode(65 + index),
    content: option.content.trim(),
    is_correct: Boolean(option.isCorrect),
    position: index,
  }))
  const { error } = await client.from('alternativas').insert(rows)
  if (error) fail(error, 'No se pudieron guardar las alternativas.')
}

async function uploadQuestionMedia(questionId, userId, file) {
  if (!file) return null
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Formato no permitido. Usa JPG, JPEG, PNG o WEBP.')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('La imagen supera el límite de 10 MB.')
  const client = requireClient()
  const path = `${userId}/${questionId}/${Date.now()}-${sanitizeFilename(file.name)}`
  const { error } = await client.storage.from(QUESTION_MEDIA_BUCKET).upload(path, file, {
    cacheControl: '3600', contentType: file.type, upsert: false,
  })
  if (error) fail(error, 'No se pudo subir la imagen de la pregunta.')
  return path
}

async function replaceMediaIfNeeded(questionId, userId, question, existing) {
  const client = requireClient()
  let nextPath = existing?.media_path || null
  let nextBucket = existing?.media_bucket || null

  if (question.mediaFile) {
    nextPath = await uploadQuestionMedia(questionId, userId, question.mediaFile)
    nextBucket = QUESTION_MEDIA_BUCKET
  } else if (question.removeMedia) {
    nextPath = null
    nextBucket = null
  }

  const changed = nextPath !== (existing?.media_path || null) || nextBucket !== (existing?.media_bucket || null)
  if (changed) {
    const { error } = await client.from('preguntas').update({ media_bucket: nextBucket, media_path: nextPath }).eq('id', questionId)
    if (error) {
      if (question.mediaFile && nextPath) await client.storage.from(QUESTION_MEDIA_BUCKET).remove([nextPath])
      fail(error, 'No se pudo asociar la imagen a la pregunta.')
    }
  }

  const oldPath = existing?.media_path
  if (oldPath && oldPath !== nextPath && oldPath.startsWith(`${userId}/${questionId}/`)) {
    await client.storage.from(existing.media_bucket || QUESTION_MEDIA_BUCKET).remove([oldPath])
  }
}

async function saveSingleQuestion(question, userId, parentQuestionId = null, casePosition = null) {
  const client = requireClient()
  const id = question.id || crypto.randomUUID()
  const existing = question.id ? await getQuestionRow(question.id) : null
  const payload = { id, ...dbQuestionPayload(question, userId, parentQuestionId, casePosition) }
  const options = OPTION_TYPES.has(question.type)
    ? (question.options || []).map((option, index) => ({
        option_key: option.key || String.fromCharCode(65 + index),
        content: option.content.trim(),
        is_correct: Boolean(option.isCorrect),
        position: index,
      }))
    : []
  const { data: savedId, error: coreError } = await client.rpc('save_question_core', {
    p_question: payload,
    p_options: options,
  })
  if (coreError) fail(coreError, question.id ? 'No se pudo actualizar la pregunta.' : 'No se pudo crear la pregunta.')

  try {
    await replaceMediaIfNeeded(savedId || id, userId, question, existing)
    return savedId || id
  } catch (error) {
    if (!question.id) await client.from('preguntas').delete().eq('id', id)
    throw error
  }
}

export async function listQuestionBanks() {
  const client = requireClient()
  const { data, error } = await client.from('bancos_preguntas').select(`
    id, course_id, owner_user_id, name, description, is_archived, created_at, updated_at,
    cursos ( id, code, name, academic_period, section )
  `).order('is_archived', { ascending: true }).order('name', { ascending: true })
  if (error) fail(error, 'No se pudieron cargar los bancos de preguntas.')

  const { data: rows, error: countError } = await client.from('preguntas').select('bank_id, id').is('parent_question_id', null)
  if (countError) fail(countError, 'No se pudo calcular el contenido de los bancos.')
  const counts = (rows || []).reduce((acc, row) => {
    acc[row.bank_id] = (acc[row.bank_id] || 0) + 1
    return acc
  }, {})
  return (data || []).map((bank) => ({ ...bank, questionCount: counts[bank.id] || 0 }))
}

export async function createQuestionBank(payload, userId) {
  const client = requireClient()
  if (!payload.courseId) throw new Error('Selecciona un curso.')
  if (!payload.name?.trim()) throw new Error('Escribe el nombre del banco.')
  const { data, error } = await client.from('bancos_preguntas').insert({
    course_id: payload.courseId, owner_user_id: userId, name: payload.name.trim(),
    description: clean(payload.description), is_archived: false,
  }).select('*').single()
  if (error) fail(error, 'No se pudo crear el banco de preguntas.')
  return data
}

export async function updateQuestionBank(bankId, payload) {
  const client = requireClient()
  if (!payload.courseId) throw new Error('Selecciona un curso.')
  if (!payload.name?.trim()) throw new Error('Escribe el nombre del banco.')
  const { data, error } = await client.from('bancos_preguntas').update({
    course_id: payload.courseId, name: payload.name.trim(), description: clean(payload.description),
  }).eq('id', bankId).select('*').single()
  if (error) fail(error, 'No se pudo actualizar el banco.')
  return data
}

export async function setQuestionBankArchived(bankId, archived) {
  const client = requireClient()
  const { error } = await client.from('bancos_preguntas').update({ is_archived: archived }).eq('id', bankId)
  if (error) fail(error, archived ? 'No se pudo archivar el banco.' : 'No se pudo restaurar el banco.')
}

export async function listQuestions(filters = {}) {
  const client = requireClient()
  let query = client.from('preguntas').select(`
    id, bank_id, type, prompt, unit, topic, subtopic, difficulty, points,
    media_bucket, media_path, numeric_tolerance, explanation, grading_config, answer_key,
    metadata, is_active, archived_at, parent_question_id, case_position, created_at, updated_at,
    bancos_preguntas!inner ( id, name, course_id, is_archived, cursos!inner ( id, code, name, academic_period, section ) ),
    alternativas ( id, option_key, content, is_correct, position )
  `).is('parent_question_id', null).order('updated_at', { ascending: false })

  if (!filters.includeArchivedBanks) query = query.eq('bancos_preguntas.is_archived', false)
  const { data, error } = await query
  if (error) fail(error, 'No se pudieron cargar las preguntas.')
  return data || []
}

export async function getQuestion(questionId) {
  const client = requireClient()
  const { data: question, error } = await client.from('preguntas').select(`
    *, bancos_preguntas ( id, name, course_id, cursos ( id, code, name ) ),
    alternativas ( id, option_key, content, is_correct, position )
  `).eq('id', questionId).maybeSingle()
  if (error) fail(error, 'No se pudo cargar la pregunta.')
  if (!question) throw new Error('La pregunta ya no existe.')

  const { data: children, error: childError } = await client.from('preguntas')
    .select('*, alternativas ( id, option_key, content, is_correct, position )')
    .eq('parent_question_id', questionId).order('case_position', { ascending: true })
  if (childError) fail(childError, 'No se pudieron cargar las subpreguntas del caso.')

  let mediaUrl = null
  if (question.media_path) {
    const { data: signed } = await client.storage.from(question.media_bucket || QUESTION_MEDIA_BUCKET).createSignedUrl(question.media_path, 3600)
    mediaUrl = signed?.signedUrl || null
  } else if (question.metadata?.demo === true && typeof question.metadata?.demoMediaUrl === 'string') {
    mediaUrl = question.metadata.demoMediaUrl
  }
  return {
    ...question, mediaUrl,
    alternativas: (question.alternativas || []).sort((a, b) => a.position - b.position),
    children: (children || []).map((child) => ({ ...child, alternativas: (child.alternativas || []).sort((a, b) => a.position - b.position) })),
  }
}

export async function saveQuestion(question, userId) {
  validateQuestion(question)
  const client = requireClient()
  const parentId = await saveSingleQuestion(question, userId)

  const { data: oldChildren, error: oldError } = await client.from('preguntas').select('id, media_bucket, media_path').eq('parent_question_id', parentId)
  if (oldError) fail(oldError, 'No se pudo sincronizar el caso.')

  if (question.type === 'case_group') {
    const keepIds = new Set((question.children || []).filter((child) => child.id).map((child) => child.id))
    for (const [index, child] of question.children.entries()) {
      await saveSingleQuestion({ ...child, bankId: question.bankId }, userId, parentId, index + 1)
    }
    for (const child of (oldChildren || []).filter((item) => !keepIds.has(item.id))) {
      if (child.media_path) await client.storage.from(child.media_bucket || QUESTION_MEDIA_BUCKET).remove([child.media_path])
      const { error } = await client.from('preguntas').delete().eq('id', child.id)
      if (error) fail(error, 'No se pudo retirar una subpregunta eliminada.')
    }
  } else {
    for (const child of (oldChildren || [])) {
      if (child.media_path) await client.storage.from(child.media_bucket || QUESTION_MEDIA_BUCKET).remove([child.media_path])
      const { error } = await client.from('preguntas').delete().eq('id', child.id)
      if (error) fail(error, 'No se pudo retirar una subpregunta anterior.')
    }
  }
  return parentId
}

export async function setQuestionArchived(questionId, archived) {
  const client = requireClient()
  const payload = { is_active: !archived, archived_at: archived ? new Date().toISOString() : null }
  const { error } = await client.from('preguntas').update(payload).eq('id', questionId)
  if (error) fail(error, archived ? 'No se pudo archivar la pregunta.' : 'No se pudo restaurar la pregunta.')
  const { error: childError } = await client.from('preguntas').update(payload).eq('parent_question_id', questionId)
  if (childError) fail(childError, 'No se pudo actualizar el estado de las subpreguntas.')
}

function rowToClone(row, bankId) {
  return {
    bankId, type: row.type, prompt: row.prompt, unit: row.unit || '', topic: row.topic || '', subtopic: row.subtopic || '',
    difficulty: row.difficulty, points: Number(row.points || 1),
    options: (row.alternativas || []).map((option) => ({ key: option.option_key, content: option.content, isCorrect: option.is_correct })),
    trueFalseValue: Boolean(row.answer_key?.value), acceptedAnswers: row.answer_key?.answers || [],
    shortTextMode: row.grading_config?.mode || 'case_insensitive', trimWhitespace: row.grading_config?.trimWhitespace !== false,
    collapseWhitespace: row.grading_config?.collapseWhitespace === true,
    numericMode: row.grading_config?.numericMode || (row.answer_key?.min != null || row.answer_key?.max != null ? 'range' : row.numeric_tolerance != null ? 'tolerance' : 'exact'),
    numericAnswer: row.answer_key?.value ?? '', numericTolerance: row.numeric_tolerance ?? '',
    numericMin: row.answer_key?.min ?? row.grading_config?.min ?? '', numericMax: row.answer_key?.max ?? row.grading_config?.max ?? '',
    explanation: row.explanation || '', isActive: true, metadata: row.metadata || {},
  }
}

export async function duplicateQuestion(questionId, userId) {
  const original = await getQuestion(questionId)
  const clone = {
    ...rowToClone(original, original.bank_id),
    prompt: `${original.prompt} (copia)`,
    existingMediaUrl: original.media_path ? 'copy-pending' : (original.metadata?.demoMediaUrl || null),
    children: (original.children || []).map((child) => rowToClone(child, original.bank_id)),
  }
  validateQuestion(clone)
  const newId = await saveSingleQuestion(clone, userId)
  const client = requireClient()
  try {
    if (original.media_path) {
      const target = `${userId}/${newId}/${Date.now()}-${sanitizeFilename(original.media_path.split('/').pop() || 'imagen')}`
      const { error: copyError } = await client.storage.from(original.media_bucket || QUESTION_MEDIA_BUCKET).copy(original.media_path, target)
      if (copyError) fail(copyError, 'No se pudo copiar la imagen original.')
      const { error: mediaError } = await client.from('preguntas').update({ media_bucket: original.media_bucket || QUESTION_MEDIA_BUCKET, media_path: target }).eq('id', newId)
      if (mediaError) fail(mediaError, 'No se pudo asociar la imagen a la copia.')
    }
    for (const [index, child] of clone.children.entries()) await saveSingleQuestion(child, userId, newId, index + 1)
    return newId
  } catch (error) {
    await client.from('preguntas').delete().eq('id', newId)
    throw error
  }
}

export { IMAGE_TYPES, MAX_IMAGE_BYTES }
