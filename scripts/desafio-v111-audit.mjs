import fs from 'node:fs'
import path from 'node:path'
const root=process.cwd(); const read=(p)=>fs.readFileSync(path.join(root,p),'utf8'); const exists=(p)=>fs.existsSync(path.join(root,p));
const checks=[]; const check=(name,ok)=>{checks.push({name,ok:Boolean(ok)}); console.log(`${ok?'PASS':'FAIL'}  ${name}`)}
const pkg=JSON.parse(read('package.json'))
const home=read('src/pages/HomePage.jsx')
const css=read('src/styles/global.css')
const guard=read('src/components/ExamSecurityGuard.jsx')
const demo=read('src/services/localDemoExam.js')
const edge=read('supabase/functions/exam-access/index.ts')
const instructions=read('src/pages/StudentInstructionsPage.jsx')
const publicLayout=read('src/layouts/PublicLayout.jsx')
const studentLayout=read('src/layouts/StudentLayout.jsx')
const vparts=String(pkg.version).split('.').map(Number); const compatible=(vparts[0]>1)||(vparts[0]===1 && (vparts[1]>1 || (vparts[1]===1 && (vparts[2]||0)>=1))); check('Version compatible >= 1.1.1', compatible)
check('Hero v2 from second industrial concept exists', exists('public/branding/hero-industrial-v2.webp') && /hero-industrial-v2\.webp/.test(home))
check('Hero title split prevents overlap', /<span>Evaluación<\/span>/.test(home) && /industrial-title-accent/.test(home) && /industrial-hero-copy h1 > span/.test(css))
check('Desktop hero columns keep separation', /grid-template-columns: minmax\(0, 1fr\) minmax\(320px, \.9fr\)/.test(css))
check('Access page gets dedicated visual background', /public-shell-access/.test(publicLayout) && /public-shell-access/.test(css))
check('Instructions page gets dedicated visual background', /student-shell-instructions/.test(studentLayout) && /student-shell-instructions/.test(css))
check('Instructions include mobile screen guidance', /mantener la pantalla encendida/.test(instructions) && /bloqueo automático/.test(instructions))
check('Wake Lock requested during secured exam', /navigator\.wakeLock\?\.request/.test(guard) && /requestWakeLock/.test(guard))
check('Mobile blur false positives reduced', /isMobileLike/.test(guard) && /!security\.detectBlur \|\| isMobileLike/.test(guard))
check('Visibility interruption recorded as one incident', /SECURITY_VISIBILITY_INTERRUPTION/.test(guard) && !/SECURITY_TAB_RETURNED/.test(guard))
check('Fullscreen exit not double counted while page hidden', /!document\.hidden && !hiddenAtRef\.current/.test(guard))
check('Guard initializes from persisted incident count', /security\.incidentCount/.test(guard) && /Math\.max\(current, authoritative\)/.test(guard))
check('Guard synchronizes authoritative incident count from server', /result\?\.incidentCount/.test(guard) && /setIncidentCount\(authoritative\)/.test(guard))
check('Local demo engine exposes persisted incident count', /incidentCount: Array\.isArray\(state\.incidents\)/.test(demo))
check('Real engine exposes persisted incident count', /securityIncidentCount/.test(edge) && /incidentCount: Number\(securityIncidentCount \|\| 0\)/.test(edge))
check('Mobile audit result file exists', exists('docs/MOBILE_AUDIT_V111_RESULT.json'))
if (exists('docs/MOBILE_AUDIT_V111_RESULT.json')) {
  const mobile=JSON.parse(read('docs/MOBILE_AUDIT_V111_RESULT.json'))
  check('Mobile audit is fully green', mobile.failed === 0 && mobile.passed === mobile.total)
}
const failed=checks.filter(x=>!x.ok); console.log(`\nDesafío Industrial v1.1.1 audit: ${checks.length-failed.length}/${checks.length} PASS`); if(failed.length) process.exit(1)
