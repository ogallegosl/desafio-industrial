import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const migrationsDir = path.join(root, 'supabase', 'migrations')
const outputPath = path.join(root, 'supabase', 'sql', 'bootstrap_all.sql')

const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()

if (!migrationFiles.length) {
  throw new Error('No se encontraron migraciones numeradas en supabase/migrations.')
}

const blocks = migrationFiles.map((name) => {
  const content = fs.readFileSync(path.join(migrationsDir, name), 'utf8').replace(/\r\n/g, '\n').trimEnd()
  return `-- >>> BEGIN MIGRATION: ${name}\n${content}\n-- <<< END MIGRATION: ${name}`
})

fs.writeFileSync(outputPath, `${blocks.join('\n\n')}\n`, 'utf8')
console.log(`Bootstrap reconstruido: ${migrationFiles.length} migraciones -> ${path.relative(root, outputPath)}`)
console.log(`Última migración incluida: ${migrationFiles.at(-1)}`)
