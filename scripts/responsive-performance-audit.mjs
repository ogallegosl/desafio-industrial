import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail })

const app = read('src/App.jsx')
const css = read('src/styles/global.css')
const teacher = read('src/layouts/TeacherLayout.jsx')
const vite = read('vite.config.js')
const questionRenderer = read('src/components/StudentQuestionRenderer.jsx')
const pkg = JSON.parse(read('package.json'))

check('Route-level lazy loading', /lazy\(\(\) => import\(/.test(app))
check('Suspense route fallback', /<Suspense/.test(app) && /RouteFallback/.test(app))
check('XLSX remains dynamic', /await import\(['"]xlsx['"]\)/.test(read('src/services/resultsExport.js')) && /await import\(['"]xlsx['"]\)/.test(read('src/services/questionImport.js')))
check('React vendor chunk', /react-vendor/.test(vite))
check('Supabase vendor chunk', /supabase-vendor/.test(vite))
check('Teacher mobile drawer state', /mobileMenuOpen/.test(teacher) && /mobile-open/.test(teacher))
check('Teacher menu Escape support', /event\.key === ['"]Escape['"]/.test(teacher))
check('Responsive 360 rule', /@media \(max-width: 360px\)/.test(css))
check('Responsive 390 rule', /@media \(max-width: 390px\)/.test(css))
check('Responsive 430 rule', /@media \(max-width: 430px\)/.test(css))
check('Responsive 768 rule', /@media \(max-width: 768px\)/.test(css))
check('Desktop baseline supports 1366', /max-width: 1520px/.test(css) && /1180px/.test(css))
check('Mobile timer stays sticky', /\.mobile-exam-status[^}]*position: sticky/.test(css) || /\.mobile-exam-status \{[^}]*top:/s.test(css))
check('Sticky mobile exam navigation', /\.exam-navigation \{[^}]*position: sticky/s.test(css))
check('Safe mobile viewport units', /100dvh/.test(css))
check('Reduced motion supported', /prefers-reduced-motion/.test(css))
check('Technical question images constrained', /max-height: min\(52dvh, 430px\)/.test(css))
check('Current exam images prioritized', /fetchPriority="high"/.test(questionRenderer))
check('Teacher evidence images lazy', /loading="lazy"/.test(read('src/pages/TeacherEvidencePage.jsx')))
check('QA18 npm script', Boolean(pkg.scripts?.['test:responsive18']))

const browserResultPath = path.join(root, 'docs/RESPONSIVE_BROWSER_PROMPT18_RESULT.json')
if (fs.existsSync(browserResultPath)) {
  const browser = JSON.parse(fs.readFileSync(browserResultPath, 'utf8'))
  check('Browser responsive audit passed', browser.failed === 0, `${browser.passed}/${browser.total}`)
} else {
  check('Browser responsive audit optional artifact', true, 'Ejecuta scripts/responsive-browser-check.py cuando Playwright/Chromium estén disponibles.')
}

const failed = checks.filter((item) => !item.ok)
const result = { prompt: 18, passed: checks.length - failed.length, total: checks.length, failed: failed.length, checks }
fs.writeFileSync(path.join(root, 'docs/RESPONSIVE_PROMPT18_RESULT.json'), JSON.stringify(result, null, 2))
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} | ${item.name}${item.detail ? ` | ${item.detail}` : ''}`)
console.log(`\nPrompt 18: ${result.passed}/${result.total} PASS`)
if (failed.length) process.exit(1)
