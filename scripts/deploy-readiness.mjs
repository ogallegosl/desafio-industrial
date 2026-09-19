import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const requireEnv = process.argv.includes('--require-env')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}
function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}
function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}
function parseSimpleEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx < 1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const localEnv = {
  ...parseSimpleEnvFile(path.join(root, '.env')),
  ...parseSimpleEnvFile(path.join(root, '.env.local')),
}
const env = { ...localEnv, ...process.env }
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail })
}

const pkg = JSON.parse(read('package.json'))
const netlify = read('netlify.toml')
const client = read('src/services/supabaseClient.js')
const cors = read('supabase/functions/_shared/cors.ts')
const edge = read('supabase/functions/exam-access/index.ts')
const config = read('supabase/config.toml')
const bootstrap = read('supabase/sql/bootstrap_all.sql')
const envExample = read('.env.example')

check('Existe .env.example', exists('.env.example'))
check('Existe .node-version', exists('.node-version'))
check('Node >= 22.12 declarado', String(pkg.engines?.node || '').includes('22.12'))
check('Netlify usa build:netlify', netlify.includes('command = "npm run build:netlify"'))
check('Netlify publica dist', netlify.includes('publish = "dist"'))
check('Netlify fija Node 22', netlify.includes('NODE_VERSION = "22"'))
check('Rewrite SPA configurado', netlify.includes('from = "/*"') && netlify.includes('to = "/index.html"') && netlify.includes('status = 200'))
check('CSP configurada', netlify.includes('Content-Security-Policy'))
check('Assets con cache inmutable', netlify.includes('max-age=31536000, immutable'))
check('index.html revalida', netlify.includes('max-age=0, must-revalidate'))
check('Frontend usa publishable key', client.includes('VITE_SUPABASE_PUBLISHABLE_KEY'))
check('Frontend no usa anon key heredada', !client.includes('VITE_SUPABASE_ANON_KEY'))
const envExampleKeys = envExample
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => line.slice(0, line.indexOf('=')).trim())
check('.env.example no declara secret/service_role', !envExampleKeys.some((key) => /SUPABASE_(SECRET|SERVICE_ROLE)|service_role/i.test(key)))
check('Edge Function usa allowlist CORS', cors.includes('APP_ALLOWED_ORIGINS') && edge.includes('isAllowedOrigin'))
check('Edge Function exam-access mantiene JWT público controlado', /\[functions\.exam-access\][\s\S]*verify_jwt\s*=\s*false/.test(config))
check('Edge Function tiene credencial servidor moderna', edge.includes('SUPABASE_SECRET_KEYS'))

const migrationsDir = path.join(root, 'supabase/migrations')
const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
check('Hay migraciones versionadas', migrations.length >= 24, `detectadas=${migrations.length}`)
check('bootstrap_all.sql incluye todas las migraciones', migrations.every((f) => bootstrap.includes(f)), 'todas las migraciones deben estar incluidas')

const frontendFiles = walk(path.join(root, 'src')).filter((f) => /\.(js|jsx|ts|tsx)$/.test(f))
const frontendText = frontendFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
check('No hay secretos de servidor en frontend', !/SUPABASE_SECRET|SERVICE_ROLE|service_role/i.test(frontendText))
check('DEPLOY_NETLIFY.md existe', exists('docs/DEPLOY_NETLIFY.md'))

if (requireEnv) {
  const url = String(env.VITE_SUPABASE_URL || '').trim()
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim()
  check('VITE_SUPABASE_URL presente', Boolean(url))
  check('VITE_SUPABASE_URL es HTTPS', /^https:\/\//i.test(url) && !/YOUR_PROJECT|TU-PROYECTO/i.test(url))
  check('VITE_SUPABASE_PUBLISHABLE_KEY presente', Boolean(key))
  check('Publishable key moderna', /^sb_publishable_/i.test(key) && !/REPLACE_ME/i.test(key))
}

const failed = checks.filter((x) => !x.ok)
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} | ${item.name}${item.detail ? ` | ${item.detail}` : ''}`)
}
console.log(`\nDeploy readiness: ${checks.length - failed.length}/${checks.length} PASS`)
if (failed.length) process.exit(1)
