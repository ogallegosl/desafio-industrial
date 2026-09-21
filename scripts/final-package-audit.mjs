import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const required = [
  'README.md','CHANGELOG.md','.env.example','package.json','vite.config.js','netlify.toml',
  'docs/ARQUITECTURA.md','docs/BASE_DE_DATOS.md','docs/DEPLOY_NETLIFY.md',
  'docs/GUIA_DOCENTE.md','docs/GUIA_ESTUDIANTE.md','docs/QA_REPORT.md',
  'supabase/sql/bootstrap_all.sql'
]

const errors = []
for (const rel of required) {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) errors.push(`Falta ${rel}`)
  else if (fs.statSync(p).isFile() && fs.statSync(p).size === 0) errors.push(`Archivo vacío: ${rel}`)
}

const migrationsDir = path.join(root, 'supabase', 'migrations')
const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
if (migrations.length !== 34) errors.push(`Se esperaban 34 migraciones y se encontraron ${migrations.length}`)

const bootstrap = fs.readFileSync(path.join(root, 'supabase', 'sql', 'bootstrap_all.sql'), 'utf8')
for (const migration of migrations) {
  if (!bootstrap.includes(migration)) errors.push(`bootstrap_all.sql no referencia ${migration}`)
}

const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
if (!env.includes('VITE_SUPABASE_URL=')) errors.push('Falta VITE_SUPABASE_URL en .env.example')
if (!env.includes('VITE_SUPABASE_PUBLISHABLE_KEY=')) errors.push('Falta VITE_SUPABASE_PUBLISHABLE_KEY en .env.example')

const forbidden = ['SUPABASE_SERVICE_ROLE_KEY=', 'SUPABASE_SECRET_KEY=', 'service_role=']
for (const token of forbidden) {
  if (env.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith('#') && line.includes(token))) {
    errors.push(`.env.example contiene una asignación prohibida: ${token}`)
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) return []
    const p = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(p) : [p]
  })
}

const allFiles = walk(root)
for (const p of allFiles) {
  const st = fs.statSync(p)
  if (st.size === 0) errors.push(`Archivo vacío: ${path.relative(root, p)}`)
}

const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
if (!['1.0.0', '1.0.1', '1.1.0', '1.1.1', '1.2.0', '1.2.1', '1.3.0'].includes(pkg.version)) errors.push(`Versión inesperada: ${pkg.version}`)

const result = {
  ok: errors.length === 0,
  version: pkg.version,
  migrations: migrations.length,
  files: allFiles.length,
  errors,
}

console.log(JSON.stringify(result, null, 2))
if (errors.length) process.exit(1)
