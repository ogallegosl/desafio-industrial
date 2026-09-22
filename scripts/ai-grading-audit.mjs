import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n')

const migration = normalizeNewlines(read('supabase/migrations/0035_ai_grading_assist.sql'))
const edge = normalizeNewlines(read('supabase/functions/ai-grading/index.ts'))
const config = normalizeNewlines(read('supabase/config.toml'))
const service = normalizeNewlines(read('src/services/aiGrading.js'))
const component = normalizeNewlines(read('src/components/AiGradingAssistant.jsx'))
const page = normalizeNewlines(read('src/pages/TeacherManualGradingPage.jsx'))

const checks = [
  ['tabla de auditoría IA', migration.includes('create table if not exists public.ai_grading_suggestions')],
  ['sugerencias no eliminables por cliente', migration.includes('revoke insert, update, delete on public.ai_grading_suggestions from authenticated')],
  ['docente solo puede leer intentos propios', migration.includes('private.owns_attempt(attempt_id)')],
  ['función IA exige JWT', config.includes('[functions.ai-grading]') && config.includes('verify_jwt = true')],
  ['clave OpenAI solo en Edge Function', edge.includes("Deno.env.get('OPENAI_API_KEY')")],
  ['modelo configurable por secreto', edge.includes("Deno.env.get('OPENAI_MODEL')")],
  ['Responses API', edge.includes("https://api.openai.com/v1/responses")],
  ['provider storage desactivado', edge.includes('store: false')],
  ['salida estructurada JSON schema', edge.includes("type: 'json_schema'") && edge.includes("name: 'grading_suggestion'")],
  ['identidad del estudiante no se envía', edge.includes('studentIdentitySent: false')],
  ['evidencia adjunta no se envía en v1', edge.includes('evidenceSent: false')],
  ['rúbrica obligatoria', edge.includes('AI_RUBRIC_REQUIRED')],
  ['intento debe estar cerrado', edge.includes('AI_ATTEMPT_NOT_CLOSED')],
  ['tipos v1 restringidos a desarrollo y caso', edge.includes("new Set(['essay', 'case_group'])") && component.includes("new Set(['essay', 'case_group'])")],
  ['imagen y respuesta corta quedan fuera del alcance IA', !edge.includes("new Set(['essay', 'image_essay'") && !component.includes("new Set(['essay', 'image_essay'")],
  ['caso práctico envía subpreguntas estructuradas', edge.includes('caseSubquestions') && edge.includes('studentResponse') && edge.includes('caseContextSent')],
  ['lectura con contexto del docente', edge.includes('const actor = createClient')],
  ['escritura de auditoría solo servidor', edge.includes('const admin = createClient') && /\badmin\s*\.from\('ai_grading_suggestions'\)/.test(edge)],
  ['caché para evitar llamadas duplicadas', edge.includes('CACHE_WINDOW_MS') && edge.includes('request_fingerprint')],
  ['límite de uso IA antes del proveedor', edge.includes('AI_RATE_LIMIT') && edge.includes("admin.rpc('consume_edge_rate_limit'") && edge.indexOf("admin.rpc('consume_edge_rate_limit'") < edge.indexOf("fetch('https://api.openai.com/v1/responses'")],
  ['IA no invoca grade_manual_response', !edge.includes('grade_manual_response')],
  ['IA no actualiza calificaciones', !edge.includes(".from('calificaciones')")],
  ['servicio frontend invoca ai-grading', service.includes("supabase.functions.invoke('ai-grading'")],
  ['UI declara modo asistido', component.includes('Modo asistido por docente')],
  ['aplicar borrador no marca decisión final', component.includes('draftApplied') && !component.includes("decision: 'applied'")],
  ['uso IA se registra después de guardar nota', page.includes('pendingAiSuggestionId') && page.includes('gradeManualResponse') && page.includes("decision: 'applied'")],
  ['UI permite descartar sugerencia', component.includes('Descartar sugerencia')],
  ['integración en calificación manual', page.includes("import AiGradingAssistant") && page.includes('<AiGradingAssistant')],
]

let failed = 0
for (const [label, ok] of checks) {
  if (ok) console.log(`PASS  ${label}`)
  else {
    failed += 1
    console.error(`FAIL  ${label}`)
  }
}

console.log(`\nAI grading audit: ${checks.length - failed}/${checks.length} PASS`)
if (failed) process.exit(1)
