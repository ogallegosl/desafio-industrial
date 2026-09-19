import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatDateWithSettings,
  formatDateTimeWithSettings,
  toZonedInputParts,
  zonedLocalToIso,
} from '../src/utils/dateFormatting.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail })

const migration = read('supabase/migrations/0023_global_settings.sql')
const service = read('src/services/globalSettingsManagement.js')
const context = read('src/contexts/GlobalSettingsContext.jsx')
const main = read('src/main.jsx')
const brand = read('src/components/Brand.jsx')
const settingsPage = read('src/pages/TeacherSettingsPage.jsx')
const uploader = read('src/components/StudentEvidenceUploader.jsx')
const edge = read('supabase/functions/exam-access/index.ts')
const examEditor = read('src/pages/TeacherExamEditorPage.jsx')
const bootstrap = read('supabase/sql/bootstrap_all.sql')
const pkg = JSON.parse(read('package.json'))

check('Migration 0023 exists', fs.existsSync(path.join(root, 'supabase/migrations/0023_global_settings.sql')))
check('Singleton settings table', /create table if not exists public\.configuracion_global/.test(migration) && /configuracion_global_singleton/.test(migration))
check('Global table uses RLS', /alter table public\.configuracion_global enable row level security/.test(migration))
check('Public safe read policy', /global_settings_public_select/.test(migration) && /to anon, authenticated/.test(migration))
check('Public select uses column grants', /grant select \(/.test(migration) && !/grant select on public\.configuracion_global/.test(migration))
check('Teacher update policy', /global_settings_teacher_update/.test(migration) && /current_app_role/.test(migration))
check('Branding public bucket', /'branding'/.test(migration) && /true,\s*5242880/.test(migration))
check('Branding writes protected', /branding_teacher_insert/.test(migration) && /current_app_role/.test(migration))
check('Evidence bucket sync trigger', /trg_configuracion_global_storage_sync/.test(migration) && /sync_global_evidence_bucket_config/.test(migration))
check('Timezone validated in DB', /pg_catalog\.pg_timezone_names/.test(migration))
check('Supported evidence types constrained in DB', /configuracion_global_evidence_types_supported/.test(migration))
check('Evidence size constrained 1–50 MB', /evidence_max_bytes between 1048576 and 52428800/.test(migration))
check('Global settings service persists', /updateGlobalSettings/.test(service) && /configuracion_global/.test(service))
check('Logo upload implemented', /uploadGlobalLogo/.test(service) && /BRANDING_BUCKET/.test(service))
check('Context loads settings globally', /getGlobalSettings/.test(context) && /GlobalSettingsContext\.Provider/.test(context))
check('Provider wraps whole app', /<GlobalSettingsProvider>/.test(main))
check('Brand uses persisted platform name', /settings\.platformName/.test(brand) && /settings\.logoUrl/.test(brand))
check('Settings page is functional', /Guardar configuración/.test(settingsPage) && /uploadLogo/.test(settingsPage) && /evidenceAllowedMimeTypes/.test(settingsPage))
check('Student uploader enforces global config client-side', /useGlobalSettings/.test(uploader) && /evidenceMaxBytes/.test(uploader))
check('Edge enforces global config server-side', /async function evidenceLimits/.test(edge) && /evidence_max_bytes,evidence_allowed_mime_types/.test(edge))
check('New exams inherit global grade defaults', /globalSettings\.gradeScaleMax/.test(examEditor) && /globalSettings\.passingGrade/.test(examEditor))
check('Exam schedule uses configured timezone', /zonedLocalToIso/.test(examEditor) && /globalSettings\.timezone/.test(examEditor))
check('Bootstrap contains 0023', /0023_global_settings\.sql/.test(bootstrap))
check('Prompt 20 npm test exists', Boolean(pkg.scripts?.['test:settings20']))

const limaIso = zonedLocalToIso('2026-09-17', '10:00', 'America/Lima')
check('America/Lima wall time converts to UTC', limaIso === '2026-09-17T15:00:00.000Z', String(limaIso))
const limaParts = toZonedInputParts('2026-09-17T15:00:00.000Z', 'America/Lima')
check('UTC converts back to Lima wall time', limaParts.date === '2026-09-17' && limaParts.time === '10:00', JSON.stringify(limaParts))
check('DD/MM/YYYY formatting', formatDateWithSettings('2026-09-17T15:00:00Z', { timezone: 'America/Lima', dateFormat: 'DD/MM/YYYY' }) === '17/09/2026')
check('MM/DD/YYYY formatting', formatDateWithSettings('2026-09-17T15:00:00Z', { timezone: 'America/Lima', dateFormat: 'MM/DD/YYYY' }) === '09/17/2026')
check('YYYY-MM-DD formatting', formatDateWithSettings('2026-09-17T15:00:00Z', { timezone: 'America/Lima', dateFormat: 'YYYY-MM-DD' }) === '2026-09-17')
check('Date/time formatting includes configured wall time', formatDateTimeWithSettings('2026-09-17T15:00:00Z', { timezone: 'America/Lima', dateFormat: 'DD/MM/YYYY' }) === '17/09/2026 10:00')

const failed = checks.filter((item) => !item.ok)
const result = { prompt: 20, passed: checks.length - failed.length, total: checks.length, failed: failed.length, checks }
fs.writeFileSync(path.join(root, 'docs/GLOBAL_SETTINGS_PROMPT20_RESULT.json'), `${JSON.stringify(result, null, 2)}\n`)
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} | ${item.name}${item.detail ? ` | ${item.detail}` : ''}`)
console.log(`\nPrompt 20: ${result.passed}/${result.total} PASS`)
if (failed.length) process.exit(1)
