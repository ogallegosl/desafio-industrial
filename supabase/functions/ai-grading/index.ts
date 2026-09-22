import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFor, isAllowedOrigin } from '../_shared/cors.ts'

type Json = Record<string, unknown>

type RubricCriterion = {
  id: string
  name: string
  description?: string | null
  maxPoints: number
  position?: number
}

class AppError extends Error {
  code: string
  status: number
  details?: Json

  constructor(code: string, message: string, status = 400, details?: Json) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

function json(payload: Json, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function parseFiniteNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function roundScore(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function responseOutputText(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim()
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part?.text === 'string' && part.text.trim()) return part.text.trim()
    }
  }
  return ''
}

function answerForModel(response: any, questionType: string) {
  if (['essay', 'image_essay', 'short_text'].includes(questionType)) {
    return normalizeText(response?.answer_text)
  }
  if (questionType === 'case_group') {
    const payload = response?.answer_payload && typeof response.answer_payload === 'object' ? response.answer_payload : {}
    return JSON.stringify(payload)
  }
  return ''
}

function normalizeRubric(raw: unknown, maxPoints: number): RubricCriterion[] {
  if (!Array.isArray(raw)) return []
  const criteria = raw.map((item: any, index) => ({
    id: normalizeText(item?.id) || `criterion-${index + 1}`,
    name: normalizeText(item?.name),
    description: normalizeText(item?.description) || null,
    maxPoints: Number(item?.maxPoints),
    position: Number(item?.position || index + 1),
  }))
  if (!criteria.length) return []
  if (criteria.some((item) => !item.name || !Number.isFinite(item.maxPoints) || item.maxPoints <= 0)) {
    throw new AppError('AI_RUBRIC_INVALID', 'La rúbrica contiene criterios incompletos o puntajes máximos inválidos.', 422)
  }
  const total = criteria.reduce((sum, item) => sum + item.maxPoints, 0)
  if (Math.abs(total - maxPoints) > 0.001) {
    throw new AppError('AI_RUBRIC_TOTAL_MISMATCH', `La rúbrica debe sumar exactamente ${maxPoints} puntos.`, 422)
  }
  return criteria
}

function gradingSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['suggestedScore', 'confidence', 'feedback', 'rationale', 'rubricScores'],
    properties: {
      suggestedScore: { type: 'number' },
      confidence: { type: 'number' },
      feedback: { type: 'string' },
      rationale: { type: 'string' },
      rubricScores: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterionId', 'score', 'comment'],
          properties: {
            criterionId: { type: 'string' },
            score: { type: 'number' },
            comment: { type: 'string' },
          },
        },
      },
    },
  }
}

const SUPPORTED_TYPES = new Set(['essay', 'image_essay', 'short_text', 'case_group'])
const PROMPT_VERSION = 'desafio-ai-grading-v1'

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const corsHeaders = corsHeadersFor(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: isAllowedOrigin(origin) ? 204 : 403, headers: corsHeaders })
  }

  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, corsHeaders)
  if (!isAllowedOrigin(origin)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, corsHeaders)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    const openAiModel = normalizeText(Deno.env.get('OPENAI_MODEL')) || 'gpt-5.6-luna'
    const authorization = req.headers.get('Authorization') || ''

    if (!supabaseUrl || !anonKey) throw new AppError('SERVER_CONFIG_MISSING', 'Supabase no está configurado en la función.', 503)
    if (!openAiKey) throw new AppError('AI_NOT_CONFIGURED', 'El servicio de corrección con IA todavía no tiene una clave configurada.', 503)
    if (!authorization.toLowerCase().startsWith('bearer ')) throw new AppError('AUTH_REQUIRED', 'Debes iniciar sesión como docente.', 401)

    const actor = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userError } = await actor.auth.getUser()
    if (userError || !userData?.user?.id) throw new AppError('AUTH_INVALID', 'La sesión docente no es válida.', 401)

    const body = await req.json().catch(() => ({}))
    const action = normalizeText(body?.action || 'suggest')

    if (action === 'decision') {
      const suggestionId = normalizeText(body?.suggestionId)
      const decision = normalizeText(body?.decision)
      if (!suggestionId || !['applied', 'rejected'].includes(decision)) {
        throw new AppError('AI_DECISION_INVALID', 'La decisión de la sugerencia no es válida.', 400)
      }
      const { data, error } = await actor
        .from('ai_grading_suggestions')
        .update({
          decision,
          decided_by_user_id: userData.user.id,
          decided_at: new Date().toISOString(),
        })
        .eq('id', suggestionId)
        .eq('decision', 'proposed')
        .select('id,decision,decided_at')
        .maybeSingle()
      if (error) throw new AppError('AI_DECISION_FAILED', error.message, 400)
      if (!data) throw new AppError('AI_SUGGESTION_NOT_FOUND', 'La sugerencia ya fue procesada o no está disponible.', 404)
      return json({ ok: true, suggestion: data }, 200, corsHeaders)
    }

    if (action !== 'suggest') throw new AppError('AI_ACTION_INVALID', 'Acción de IA no reconocida.', 400)

    const responseId = normalizeText(body?.responseId)
    if (!responseId) throw new AppError('AI_RESPONSE_REQUIRED', 'Selecciona una respuesta para solicitar la sugerencia.', 400)

    const { data: response, error: responseError } = await actor
      .from('respuestas')
      .select('id,attempt_id,attempt_question_id,answer_text,answer_numeric,answer_payload,is_answered,review_status')
      .eq('id', responseId)
      .maybeSingle()
    if (responseError) throw new AppError('AI_RESPONSE_UNAVAILABLE', responseError.message, 400)
    if (!response) throw new AppError('AI_RESPONSE_FORBIDDEN', 'No se encontró una respuesta accesible para este docente.', 404)
    if (!['pending', 'reviewed'].includes(response.review_status)) {
      throw new AppError('AI_REVIEW_NOT_AVAILABLE', 'Esta respuesta no pertenece a la cola de corrección manual.', 422)
    }

    const [{ data: question, error: questionError }, { data: attempt, error: attemptError }] = await Promise.all([
      actor
        .from('intento_preguntas')
        .select('id,attempt_id,question_id,question_type,prompt_snapshot,points_snapshot,grading_snapshot,rubric_snapshot,metadata_snapshot')
        .eq('id', response.attempt_question_id)
        .maybeSingle(),
      actor
        .from('intentos')
        .select('id,status,exam_id,submitted_at')
        .eq('id', response.attempt_id)
        .maybeSingle(),
    ])
    if (questionError) throw new AppError('AI_QUESTION_UNAVAILABLE', questionError.message, 400)
    if (attemptError) throw new AppError('AI_ATTEMPT_UNAVAILABLE', attemptError.message, 400)
    if (!question || !attempt) throw new AppError('AI_CONTEXT_FORBIDDEN', 'No se pudo validar el contexto de evaluación.', 404)
    if (!['submitted', 'time_expired'].includes(attempt.status)) {
      throw new AppError('AI_ATTEMPT_NOT_CLOSED', 'La IA solo puede asistir en intentos ya entregados.', 422)
    }

    const questionType = normalizeText(question.question_type)
    if (!SUPPORTED_TYPES.has(questionType)) {
      throw new AppError('AI_TYPE_NOT_SUPPORTED', 'La primera versión de corrección con IA admite respuestas textuales y casos prácticos, no evidencias adjuntas.', 422)
    }

    const maxPoints = Number(question.points_snapshot || 0)
    if (!Number.isFinite(maxPoints) || maxPoints <= 0) throw new AppError('AI_POINTS_INVALID', 'La pregunta no tiene un puntaje máximo válido.', 422)

    const requestedRubric = Array.isArray(body?.rubricCriteria) ? body.rubricCriteria : null
    const frozenRubric = Array.isArray(question.rubric_snapshot?.criteria) ? question.rubric_snapshot.criteria : []
    const rubric = normalizeRubric(requestedRubric ?? frozenRubric, maxPoints)
    if (!rubric.length) {
      throw new AppError('AI_RUBRIC_REQUIRED', 'Configura una rúbrica antes de solicitar una corrección con IA.', 422)
    }

    const studentAnswer = answerForModel(response, questionType)
    if (!studentAnswer) throw new AppError('AI_EMPTY_ANSWER', 'La respuesta no contiene texto evaluable por esta versión de IA.', 422)
    if (studentAnswer.length > 30000) throw new AppError('AI_ANSWER_TOO_LONG', 'La respuesta supera el límite de análisis de esta versión.', 422)

    const gradingReference = question.grading_snapshot && typeof question.grading_snapshot === 'object'
      ? question.grading_snapshot
      : {}

    const rubricPrompt = rubric.map((item, index) => ({
      criterionId: item.id,
      order: index + 1,
      name: item.name,
      description: item.description,
      maxPoints: item.maxPoints,
    }))

    const systemInstruction = [
      'Eres un asistente de corrección académica para un docente universitario.',
      'Tu salida es únicamente una sugerencia y nunca una calificación final.',
      'Evalúa exclusivamente con el enunciado, la respuesta, la referencia de corrección y la rúbrica recibida.',
      'No inventes requisitos que no estén en esos materiales.',
      'Asigna un puntaje a cada criterio dentro de su máximo y usa comentarios breves, concretos y verificables.',
      'El puntaje total debe ser exactamente la suma de los criterios.',
      'La confianza debe estar entre 0 y 1 y reflejar cuán clara es la evidencia disponible para aplicar la rúbrica.',
      'La retroalimentación debe poder ser revisada y editada por el docente antes de entregarse al estudiante.',
    ].join(' ')

    const modelInput = {
      question: question.prompt_snapshot,
      questionType,
      maxPoints,
      gradingReference,
      rubric: rubricPrompt,
      studentAnswer,
    }

    const fingerprint = await sha256Hex(JSON.stringify({ responseId, promptVersion: PROMPT_VERSION, modelInput }))

    const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openAiModel,
        store: false,
        max_output_tokens: 2000,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemInstruction }] },
          { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(modelInput) }] },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'grading_suggestion',
            strict: true,
            schema: gradingSchema(),
          },
        },
      }),
    })

    const providerPayload = await openAiResponse.json().catch(() => ({}))
    if (!openAiResponse.ok) {
      const providerMessage = normalizeText(providerPayload?.error?.message) || 'El proveedor de IA rechazó la solicitud.'
      throw new AppError('AI_PROVIDER_ERROR', providerMessage, 502)
    }

    const rawText = responseOutputText(providerPayload)
    if (!rawText) throw new AppError('AI_PROVIDER_EMPTY', 'La IA no devolvió una sugerencia utilizable.', 502)

    let suggestion: any
    try {
      suggestion = JSON.parse(rawText)
    } catch {
      throw new AppError('AI_PROVIDER_INVALID_JSON', 'La IA devolvió una respuesta con formato inválido.', 502)
    }

    const modelScores = Array.isArray(suggestion?.rubricScores) ? suggestion.rubricScores : []
    const scoreById = new Map(modelScores.map((item: any) => [normalizeText(item?.criterionId), item]))
    const rubricScores = rubric.map((criterion) => {
      const modelItem: any = scoreById.get(criterion.id)
      const candidate = parseFiniteNumber(modelItem?.score)
      const score = Math.min(criterion.maxPoints, Math.max(0, candidate ?? 0))
      return {
        id: criterion.id,
        name: criterion.name,
        description: criterion.description || '',
        maxPoints: criterion.maxPoints,
        score: roundScore(score),
        comment: normalizeText(modelItem?.comment).slice(0, 1000),
        position: criterion.position,
      }
    })

    const suggestedScore = roundScore(rubricScores.reduce((sum, item) => sum + item.score, 0))
    const confidenceRaw = parseFiniteNumber(suggestion?.confidence)
    const confidence = confidenceRaw == null ? null : Math.min(1, Math.max(0, confidenceRaw))
    const feedback = normalizeText(suggestion?.feedback).slice(0, 5000)
    const rationale = normalizeText(suggestion?.rationale).slice(0, 5000)

    const { data: saved, error: saveError } = await actor
      .from('ai_grading_suggestions')
      .insert({
        response_id: response.id,
        attempt_id: response.attempt_id,
        attempt_question_id: response.attempt_question_id,
        requested_by_user_id: userData.user.id,
        provider: 'openai',
        model: openAiModel,
        prompt_version: PROMPT_VERSION,
        suggested_score: suggestedScore,
        confidence,
        rubric_scores: rubricScores,
        feedback: feedback || null,
        rationale: rationale || null,
        provider_request_id: normalizeText(providerPayload?.id) || null,
        request_fingerprint: fingerprint,
        metadata: {
          usage: providerPayload?.usage || null,
          questionType,
          maxPoints,
          studentIdentitySent: false,
          evidenceSent: false,
        },
      })
      .select('id,suggested_score,confidence,rubric_scores,feedback,rationale,decision,model,prompt_version,created_at')
      .single()

    if (saveError) throw new AppError('AI_AUDIT_SAVE_FAILED', saveError.message, 500)

    return json({
      ok: true,
      suggestion: {
        id: saved.id,
        score: Number(saved.suggested_score),
        confidence: saved.confidence == null ? null : Number(saved.confidence),
        rubricScores: saved.rubric_scores,
        feedback: saved.feedback || '',
        rationale: saved.rationale || '',
        decision: saved.decision,
        model: saved.model,
        promptVersion: saved.prompt_version,
        createdAt: saved.created_at,
      },
    }, 200, corsHeaders)
  } catch (error) {
    if (error instanceof AppError) {
      return json({ error: error.code, message: error.message, details: error.details || null }, error.status, corsHeaders)
    }
    console.error('ai-grading unexpected error', error)
    return json({ error: 'AI_INTERNAL_ERROR', message: 'No se pudo completar la sugerencia de corrección.' }, 500, corsHeaders)
  }
})
