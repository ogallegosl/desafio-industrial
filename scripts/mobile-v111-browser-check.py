from __future__ import annotations
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WIDTHS = [320, 360, 390, 430, 768, 1366]
MODES = ['home', 'access', 'instructions', 'exam', 'review']
css = (ROOT / 'src' / 'styles' / 'global.css').read_text(encoding='utf-8')
hero_uri = (ROOT / 'public' / 'branding' / 'hero-industrial-v2.webp').resolve().as_uri()

html = f'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>{css}</style></head><body>
<div id="home" class="page-container"><section class="hero industrial-home-hero"><div class="hero-copy industrial-hero-copy"><p class="eyebrow">Ingeniería Industrial UNSA</p><h1><span>Evaluación</span><span>universitaria</span><span class="industrial-title-accent">flexible</span></h1><p class="hero-lead">Una plataforma para evaluar conocimientos, análisis y aplicación práctica en los distintos campos de la Ingeniería Industrial.</p><div class="actions"><button class="button primary">Ingreso al examen</button><button class="button secondary">Acceso docente</button></div></div><div class="industrial-hero-visual"><img src="{hero_uri}" alt=""></div></section></div>
<div id="access" class="app-shell public-shell public-shell-access"><main class="page-container"><section class="split-auth simplified-student-access"><div class="auth-context"><p class="eyebrow">Desafío Industrial</p><h1>Ingreso al examen</h1><p class="access-short-copy">Ingeniería Industrial UNSA</p></div><form class="auth-card"><div><span class="form-step">1 de 2</span><h2>Código de acceso</h2><p>Escribe el código entregado por el docente.</p></div><label>Código del examen<input value="DEMO2026" readonly></label><div class="form-actions-row"><button class="button primary full">Ingresar</button><button class="button secondary full">Consultar resultados</button></div></form></section></main></div>
<div id="instructions" class="student-shell student-shell-instructions"><main class="student-content"><section class="student-panel instructions-panel"><p class="eyebrow">Antes de comenzar</p><h1>Examen demostrativo de Ingeniería Industrial</h1><p class="lead">Lee las condiciones antes de iniciar.</p><div class="exam-facts"><div><span>Duración</span><strong>30 min</strong></div><div><span>Intento</span><strong>1 de 3</strong></div><div><span>Estado</span><strong>Preparado</strong></div><div><span>Curso</span><strong>IND</strong></div></div><div class="instructions-box"><h2>Indicaciones</h2><ol><li>Responde todas las preguntas.</li><li>El orden puede variar.</li></ol></div><div class="mobile-exam-guidance"><strong>Si rendirás desde celular</strong><span>La plataforma intentará mantener la pantalla encendida mientras el examen esté visible.</span></div><label class="checkbox-row"><input type="checkbox"><span>He leído las instrucciones.</span></label><button class="button primary">Iniciar examen</button></section></main></div>
<div id="exam" class="student-shell"><main class="student-content"><section class="exam-runtime"><div class="security-incident-counter">Integridad: 4 incidencias</div><div class="mobile-exam-status"><div class="exam-timer"><span>Tiempo restante</span><strong>00:22:18</strong></div><div class="exam-progress"><div class="progress-copy"><span>Pregunta 7 de 15</span><strong>47%</strong></div></div></div><div class="exam-layout"><aside class="exam-status-panel"><div class="exam-timer"><span>Tiempo restante</span><strong>00:22:18</strong></div><div class="question-map">''' + ''.join(f'<button class="{"answered" if i<7 else ""}">{i}</button>' for i in range(1,16)) + '''</div></aside><div class="exam-workspace"><div class="question-card"><div class="question-meta"><span>Pregunta 7</span><span>1 punto</span></div><h2>En una línea de producción, selecciona la alternativa que corresponde al análisis del proceso.</h2><div class="options-list"><label class="option-card"><input type="radio"><span><b>A</b>Primera alternativa</span></label><label class="option-card"><input type="radio"><span><b>B</b>Segunda alternativa con un texto más largo para validar la lectura en un celular.</span></label></div></div><div class="exam-navigation"><button class="button secondary">Anterior</button><span>7 de 15</span><button class="button primary">Siguiente</button></div></div></div></section></main></div>
<div id="review" class="student-shell"><main class="student-content"><section class="student-panel runtime-review"><div class="security-incident-counter">Integridad: 4 incidencias</div><div class="review-title-row"><div><p class="eyebrow">Antes de enviar</p><h1>Revisa el estado de tus respuestas.</h1></div><div class="exam-timer"><span>Tiempo restante</span><strong>00:05:20</strong></div></div><div class="review-summary"><div><strong>15</strong><span>preguntas</span></div><div><strong>14</strong><span>respondidas</span></div><div><strong>1</strong><span>sin responder</span></div></div><div class="review-actions"><button class="button secondary">Volver al examen</button><button class="button primary">Enviar examen definitivamente</button></div></section></main></div>
</body></html>'''

checks=[]; rows=[]
def check(name, ok, detail=''):
    checks.append({'name':name,'ok':bool(ok),'detail':detail})

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    try:
        for width in WIDTHS:
            for mode in MODES:
                page=browser.new_page(viewport={'width':width,'height':900}, device_scale_factor=1)
                page.set_content(html, wait_until='load')
                page.evaluate("""([mode,modes])=>{ for(const m of modes){ document.getElementById(m).style.display=m===mode?'':'none'; } }""", [mode,MODES])
                page.wait_for_timeout(50)
                data=page.evaluate("""(mode)=>{
                  const root=document.getElementById(mode); const vr=document.documentElement.clientWidth; const dw=document.documentElement.scrollWidth;
                  const rr=root.getBoundingClientRect();
                  const buttons=[...root.querySelectorAll('button,.button')].filter(e=>getComputedStyle(e).display!=='none' && e.getClientRects().length && e.getBoundingClientRect().height>0).map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,rt:r.right}});
                  return {viewport:vr,docWidth:dw,root:{left:rr.left,right:rr.right,width:rr.width},buttons};
                }""", mode)
                rows.append({'width':width,'mode':mode,**data})
                check(f'{mode} {width}px sin overflow horizontal', data['docWidth'] <= data['viewport']+1, f"doc={data['docWidth']} viewport={data['viewport']}")
                if width <= 430:
                    check(f'{mode} {width}px botones táctiles >=44px', all(b['h'] >= 43 for b in data['buttons']), json.dumps(data['buttons'][:6]))
                if mode=='home' and width>=901:
                    overlap=page.evaluate("""()=>{const a=document.querySelector('#home .industrial-hero-copy').getBoundingClientRect(); const b=document.querySelector('#home .industrial-hero-visual').getBoundingClientRect(); return {copyRight:a.right,visualLeft:b.left,overlap:a.right>b.left+1};}""")
                    check(f'home {width}px texto no se superpone con imagen', not overlap['overlap'], json.dumps(overlap))
                if mode in ('exam','review'):
                    c=page.locator(f'#{mode} .security-incident-counter')
                    check(f'{mode} {width}px contador integridad visible', c.is_visible())
                page.close()
    finally:
        browser.close()

failed=[c for c in checks if not c['ok']]
result={'version':'1.1.1','passed':len(checks)-len(failed),'total':len(checks),'failed':len(failed),'checks':checks,'rows':rows}
(ROOT/'docs'/'MOBILE_AUDIT_V111_RESULT.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
for c in checks: print(('PASS' if c['ok'] else 'FAIL'),'|',c['name'],('| '+c['detail'] if c['detail'] else ''))
print(f"\nMobile v1.1.1: {result['passed']}/{result['total']} PASS")
raise SystemExit(1 if failed else 0)
