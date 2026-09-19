import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGeneralRows, buildDetailRows } from '../src/utils/resultsExportFormatting.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(full) : [full]
})

const edge = read('supabase/functions/exam-access/index.ts')
const cors = read('supabase/functions/_shared/cors.ts')
const netlify = read('netlify.toml')
const frontendFiles = walk(path.join(root, 'src')).filter((file) => /\.(js|jsx|ts|tsx)$/.test(file))
const frontendText = frontendFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
const migrationText = walk(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(f, 'utf8')).join('\n')

const checks = {
  noDangerousHtmlInjection: !frontendText.includes('dangerouslySetInnerHTML'),
  serviceSecretsNotInFrontend: !frontendText.includes('SERVICE_ROLE') && !frontendText.includes('SUPABASE_SECRET'),
  studentSessionUsesSessionStorage: read('src/contexts/StudentAttemptContext.jsx').includes('window.sessionStorage'),
  noWildcardCors: !cors.includes("Access-Control-Allow-Origin': '*") && !cors.includes('Access-Control-Allow-Origin = "*"'),
  explicitOriginAllowlist: cors.includes('APP_ALLOWED_ORIGINS') && edge.includes('isAllowedOrigin'),
  edgeRateLimiting: edge.includes('consume_edge_rate_limit') && edge.includes('RATE_LIMITED'),
  fileMagicValidation: edge.includes('verifyEvidenceMagic') && edge.includes('EVIDENCE_SIGNATURE_INVALID'),
  cspEnabled: netlify.includes('Content-Security-Policy') && netlify.includes("object-src 'none'") && netlify.includes("frame-ancestors 'none'"),
  noSniffEnabled: netlify.includes('X-Content-Type-Options = "nosniff"'),
  importFileSizeLimit: read('src/services/questionImport.js').includes('MAX_IMPORT_FILE_BYTES'),
  edgeResponsesNoStore: edge.includes("'Cache-Control': 'no-store'"),
  gradingSnapshotNotInStudentEngineSelect: edge.includes(".select('id, display_order, question_type, prompt_snapshot, media_bucket_snapshot, media_path_snapshot, points_snapshot, options_snapshot, metadata_snapshot')"),
  rateLimitTableRls: migrationText.includes('alter table public.edge_rate_limits enable row level security'),
  anonRateLimitTableRevoked: migrationText.includes('revoke all on public.edge_rate_limits from public, anon, authenticated'),
  studentEvidenceAuthenticatedWritePoliciesRemoved: migrationText.includes('drop policy if exists evidence_teacher_insert on storage.objects') && migrationText.includes('drop policy if exists evidence_teacher_update on storage.objects') && migrationText.includes('drop policy if exists evidence_teacher_delete on storage.objects'),
}

const general = buildGeneralRows({
  exam: { title: '=CMD()', cursos: { name: '+CURSO' } },
  students: [{ studentCode: '=2+2', lastName: '@apellido', firstName: '-nombre', email: '+correo@example.com' }],
})[0]
const detail = buildDetailRows({
  details: [{ lastName: '=L', firstName: '@F', prompt: '=HYPERLINK("x")', answerText: '=SUM(1,1)', isAnswered: true, type: 'essay', teacherFeedback: '+payload' }],
})[0]
checks.spreadsheetFormulaInjectionBlocked = Object.values({ ...general, ...detail }).every((value) => typeof value !== 'string' || !/^[=+\-@\t\r]/.test(value))

const tableNames = [...migrationText.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-zA-Z0-9_]+)/gi)].map((match) => match[1])
const enabledRls = new Set([...migrationText.matchAll(/alter\s+table\s+public\.([a-zA-Z0-9_]+)\s+enable\s+row\s+level\s+security/gi)].map((match) => match[1]))
checks.allPublicTablesUseRls = [...new Set(tableNames)].every((name) => enabledRls.has(name))

for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
const failed = Object.entries(checks).filter(([, ok]) => !ok)
console.log(`\n${Object.keys(checks).length - failed.length}/${Object.keys(checks).length} security checks passed.`)
if (failed.length) process.exit(1)
