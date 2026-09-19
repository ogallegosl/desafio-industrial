from __future__ import annotations
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WIDTHS = [360, 390, 430, 768, 1366]
checks = []
rows = []
css = (ROOT / 'src' / 'styles' / 'global.css').read_text(encoding='utf-8')
harness = (ROOT / 'docs' / 'responsive-harness.html').read_text(encoding='utf-8')
harness = harness.replace('<link rel="stylesheet" href="../src/styles/global.css">', f'<style>{css}</style>')
# The embedded harness script depends on location.search; browser audit controls the mode directly.
harness = harness.split('<script>')[0] + '</body></html>'

def check(name, ok, detail=''):
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail})

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox', '--disable-dev-shm-usage'])
    try:
        for width in WIDTHS:
            for mode in ('student', 'teacher'):
                page = browser.new_page(viewport={'width': width, 'height': 900}, device_scale_factor=1)
                page.set_content(harness, wait_until='load')
                page.evaluate("""(mode) => {
                  const student=document.getElementById('student'); const teacher=document.getElementById('teacher');
                  student.hidden = mode === 'teacher'; teacher.hidden = mode !== 'teacher';
                }""", mode)
                page.wait_for_timeout(60)
                payload = page.evaluate("""(mode) => {
                  const viewport = document.documentElement.clientWidth;
                  const docWidth = document.documentElement.scrollWidth;
                  const selectors = mode === 'teacher'
                    ? ['.teacher-topbar','.mobile-menu-button','.sidebar','.dashboard-content','.table-wrap']
                    : ['.student-topbar','.mobile-exam-status','.exam-timer','.question-card','.exam-navigation'];
                  const rects = {};
                  for (const s of selectors) {
                    const e = document.querySelector(`${mode === 'teacher' ? '#teacher ' : '#student '}${s}`) || document.querySelector(s); if (!e) continue;
                    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
                    rects[s] = {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,display:cs.display,visibility:cs.visibility,position:cs.position};
                  }
                  return {viewport,docWidth,noHorizontalOverflow:docWidth <= viewport + 1,rects};
                }""", mode)
                rows.append({'width': width, 'mode': mode, **payload})
                check(f'{mode} {width}px sin overflow horizontal global', payload['noHorizontalOverflow'], f"doc={payload['docWidth']} viewport={payload['viewport']}")
                if mode == 'student':
                    timer = payload['rects'].get('.mobile-exam-status') if width <= 900 else page.evaluate("""() => { const e=document.querySelector('#student .exam-status-panel .exam-timer'); if(!e) return null; const r=e.getBoundingClientRect(); const cs=getComputedStyle(e); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,display:cs.display,visibility:cs.visibility,position:cs.position}; }""")
                    visible = bool(timer) and timer['display'] != 'none' and timer['visibility'] != 'hidden' and timer['left'] >= -1 and timer['right'] <= payload['viewport'] + 1
                    check(f'estudiante {width}px cronómetro visible', visible, json.dumps(timer or {}))
                    nav = payload['rects'].get('.exam-navigation')
                    check(f'estudiante {width}px navegación dentro del viewport', bool(nav) and nav['left'] >= -1 and nav['right'] <= payload['viewport'] + 1, json.dumps(nav or {}))
                else:
                    if width <= 900:
                        menu = payload['rects'].get('.mobile-menu-button')
                        check(f'docente {width}px botón de menú visible', bool(menu) and menu['display'] != 'none' and menu['left'] >= -1 and menu['right'] <= payload['viewport'] + 1, json.dumps(menu or {}))
                        sidebar = payload['rects'].get('.sidebar')
                        check(f'docente {width}px drawer dentro del viewport', bool(sidebar) and sidebar['left'] >= -1 and sidebar['right'] <= payload['viewport'] + 1, json.dumps(sidebar or {}))
                page.close()
    finally:
        browser.close()

failed = [c for c in checks if not c['ok']]
result = {'prompt': 18, 'passed': len(checks)-len(failed), 'total': len(checks), 'failed': len(failed), 'checks': checks, 'rows': rows}
(ROOT / 'docs' / 'RESPONSIVE_BROWSER_PROMPT18_RESULT.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
for c in checks:
    print(('PASS' if c['ok'] else 'FAIL'), '|', c['name'], ('| '+c['detail'] if c['detail'] else ''))
print(f"\nBrowser responsive Prompt 18: {result['passed']}/{result['total']} PASS")
raise SystemExit(1 if failed else 0)
