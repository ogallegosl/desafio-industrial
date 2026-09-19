export const USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  TEACHER: 'teacher',
})

export const QUESTION_TYPES = Object.freeze([
  'single_choice',
  'multiple_choice',
  'true_false',
  'short_text',
  'numeric',
  'essay',
  'image_single_choice',
  'image_essay',
  'calculation',
  'calculation_evidence',
  'case_group',
  'attachment',
])

export const QUESTION_DIFFICULTIES = Object.freeze([
  'basic',
  'intermediate',
  'advanced',
])

export const EXAM_STATUSES = Object.freeze([
  'draft',
  'scheduled',
  'active',
  'closed',
  'archived',
])

export const ATTEMPT_STATUSES = Object.freeze([
  'created',
  'in_progress',
  'submitted',
  'time_expired',
  'cancelled',
])

export const REVIEW_STATUSES = Object.freeze([
  'not_required',
  'pending',
  'reviewed',
])


export const QUESTION_TYPE_LABELS = Object.freeze({
  single_choice: 'Alternativa única',
  multiple_choice: 'Selección múltiple',
  true_false: 'Verdadero / Falso',
  short_text: 'Respuesta corta',
  numeric: 'Respuesta numérica',
  essay: 'Desarrollo',
  image_single_choice: 'Imagen + alternativas',
  image_essay: 'Imagen + desarrollo',
  calculation: 'Cálculo + resultado',
  calculation_evidence: 'Cálculo + evidencia',
  case_group: 'Caso práctico',
  attachment: 'Respuesta con archivo',
})

export const QUESTION_DIFFICULTY_LABELS = Object.freeze({
  basic: 'Básica',
  intermediate: 'Intermedia',
  advanced: 'Avanzada',
})
