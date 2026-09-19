import fs from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8')
const edge = read('supabase/functions/exam-access/index.ts')
const migration = read('supabase/migrations/0014_evidence_uploads.sql')
const globalMigration = read('supabase/migrations/0023_global_settings.sql')
const uploader = read('src/components/StudentEvidenceUploader.jsx')
const teacher = read('src/pages/TeacherEvidencePage.jsx')

const checks = [
  ['prepare action', edge.includes("action === 'prepare_evidence'")],
  ['finalize action', edge.includes("action === 'finalize_evidence'")],
  ['delete action', edge.includes("action === 'delete_evidence'")],
  ['dynamic evidence limits backend', edge.includes('evidenceLimits()') && edge.includes('configuracion_global')],
  ['allowed MIME backend', edge.includes("'application/pdf'") && edge.includes("'image/webp'")],
  ['storage bucket syncs global evidence config', globalMigration.includes('sync_global_evidence_bucket_config')],
  ['student uploader reads global settings', uploader.includes('useGlobalSettings') && uploader.includes('evidenceAllowedMimeTypes')],
  ['temporary upload table', migration.includes('cargas_evidencia_temporales')],
  ['one active evidence index', migration.includes('uq_evidencia_activa_por_pregunta')],
  ['private teacher lookup policy', migration.includes('evidence_teacher_select_by_attempt')],
  ['camera input', uploader.includes('capture="environment"')],
  ['preview before upload', uploader.includes('URL.createObjectURL')],
  ['replace evidence UI', uploader.includes('Reemplazar evidencia')],
  ['teacher signed preview', teacher.includes('createEvidencePreviewUrl')],
  ['teacher page no demo array', !teacher.includes('const reviews = [')],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed += 1
}
console.log(`\nChecks: ${checks.length}; failed: ${failed}`)
process.exit(failed ? 1 : 0)
