// Stable table names used by the application.
// Centralizing them avoids scattered string literals and eases future refactors.

export const TABLES = Object.freeze({
  USERS: 'usuarios',
  TEACHERS: 'docentes',
  STUDENTS: 'estudiantes',
  COURSES: 'cursos',
  ENROLLMENTS: 'matriculas',
  QUESTION_BANKS: 'bancos_preguntas',
  QUESTIONS: 'preguntas',
  OPTIONS: 'alternativas',
  EXAMS: 'examenes',
  EXAM_CONFIG: 'configuraciones_examen',
  EXAM_QUESTIONS: 'preguntas_examen',
  EXAM_SELECTION_RULES: 'reglas_seleccion_examen',
  ATTEMPTS: 'intentos',
  STUDENT_ATTEMPT_SESSIONS: 'student_attempt_sessions',
  ATTEMPT_QUESTIONS: 'intento_preguntas',
  ANSWERS: 'respuestas',
  EVIDENCE: 'evidencias',
  EVIDENCE_UPLOADS: 'cargas_evidencia_temporales',
  GRADES: 'calificaciones',
  RUBRICS: 'rubricas',
  RUBRIC_CRITERIA: 'rubrica_criterios',
  LOGS: 'logs',
  GLOBAL_SETTINGS: 'configuracion_global',
})

export const STORAGE_BUCKETS = Object.freeze({
  QUESTION_MEDIA: 'question-media',
  STUDENT_EVIDENCE: 'student-evidence',
  BRANDING: 'branding',
})
