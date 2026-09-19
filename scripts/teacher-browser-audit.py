from __future__ import annotations
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
WIDTHS=[320,360,390,430,768,1024,1366]
MODES=['dashboard','banks','editor','live','results']
css=(ROOT/'src/styles/global.css').read_text(encoding='utf-8')

sidebar='''<aside class="sidebar"><div class="sidebar-brand"><strong>Desafío Industrial</strong></div><nav class="sidebar-nav"><a class="active">Inicio</a><a>Cursos</a><a>Banco de preguntas</a><a>Exámenes</a><a>Resultados</a><a>Evidencias</a><a>Calificación</a><a>Configuración</a></nav><div class="sidebar-profile"><div class="avatar">OG</div><div class="sidebar-profile-copy"><strong>Docente de prueba</strong><span>Docente</span></div></div></aside>'''

def shell(body:str)->str:
    return f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>{css}</style></head><body><div class="dashboard-layout">{sidebar}<div class="dashboard-main"><header class="teacher-topbar"><div><button class="mobile-menu-button">☰</button><strong>Panel docente</strong></div><div class="topbar-actions"><span class="environment-pill">Sesión protegida</span><button class="avatar-button">OG</button></div></header><main class="dashboard-content">{body}</main></div></div></body></html>'''

def dashboard():
    cards=''.join(f'<article class="metric-card"><span>{x}</span><strong>{n}</strong><small>Actualizado ahora</small></article>' for x,n in [('Exámenes activos',3),('Participantes',48),('Entregados',31),('Pendientes',7)])
    rows=''.join(f'<tr><td><strong>Examen {i}</strong><span>Ingeniería Industrial</span></td><td>Activo</td><td>{10+i}</td><td><div class="table-actions"><button class="button secondary button-small">En vivo</button></div></td></tr>' for i in range(1,5))
    return f'<div class="page-heading-row"><div class="page-heading"><h1>Dashboard docente</h1><p>Resumen de actividad y accesos rápidos.</p></div><div class="page-heading-action"><button class="button primary">Crear examen</button></div></div><div class="card-grid">{cards}</div><section class="surface section-gap"><div class="surface-heading"><h2>Exámenes recientes</h2></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Examen</th><th>Estado</th><th>Participantes</th><th>Acciones</th></tr></thead><tbody>{rows}</tbody></table></div></section>'

def banks():
    rows=''.join(f'<tr><td><strong>Banco {i}</strong><span>Calidad · Unidad {i}</span></td><td>{25+i}</td><td><div class="table-actions wrap-actions"><button class="button secondary button-small">Editar</button><button class="text-button">Archivar</button></div></td></tr>' for i in range(1,5))
    qrows=''.join(f'<tr><td class="question-cell"><strong>Pregunta de control estadístico número {i} con un enunciado suficientemente largo para probar responsividad.</strong><span>Alternativa única</span></td><td>Intermedia</td><td>1.0</td><td><div class="table-actions wrap-actions"><button class="text-button">Ver</button><button class="text-button">Editar</button></div></td></tr>' for i in range(1,6))
    return f'<div class="page-heading-row"><div class="page-heading"><h1>Banco de preguntas</h1><p>Administra bancos y preguntas por curso.</p></div><button class="button primary">Nuevo banco</button></div><div class="question-bank-stats"><div><strong>4</strong><span>Bancos</span></div><div><strong>118</strong><span>Preguntas</span></div><div><strong>84</strong><span>Activas</span></div><div><strong>9</strong><span>Avanzadas</span></div></div><section class="surface section-gap"><div class="surface compact-surface question-filter-panel"><div class="question-filter-grid"><input class="search-input" placeholder="Buscar"><select><option>Todos los cursos</option></select><select><option>Todos los temas</option></select><select><option>Todos los tipos</option></select></div></div><div class="table-wrap"><table class="data-table question-bank-table"><thead><tr><th>Banco</th><th>Preguntas</th><th>Acciones</th></tr></thead><tbody>{rows}</tbody></table></div></section><section class="surface section-gap"><div class="surface-heading"><h2>Preguntas</h2></div><div class="table-wrap"><table class="data-table question-table"><thead><tr><th>Pregunta</th><th>Dificultad</th><th>Puntaje</th><th>Acciones</th></tr></thead><tbody>{qrows}</tbody></table></div></section>'

def editor():
    toggles=''.join(f'<label class="toggle-row"><input type="checkbox" checked><span>{t}</span></label>' for t in ['Aleatorizar preguntas','Aleatorizar alternativas','Pantalla completa','Bloquear copiar y pegar','Detectar cambio de pestaña','Marca de agua'])
    return f'<div class="page-heading-row"><div class="page-heading"><h1>Editar examen</h1><p>Configura acceso, tiempo, seguridad y preguntas.</p></div><div class="header-actions"><button class="button secondary">Guardar borrador</button><button class="button primary">Programar</button></div></div><div class="editor-layout"><aside class="editor-steps surface"><strong>1. Información</strong><span>2. Acceso</span><span>3. Seguridad</span><span>4. Preguntas</span></aside><div class="editor-content"><section class="surface form-section"><div class="surface-heading"><h2>Información general</h2></div><div class="form-grid two-cols"><label>Título<input value="Parcial de Control de Calidad"></label><label>Curso<select><option>Control Estadístico de la Calidad</option></select></label><label class="span-2">Instrucciones<textarea>Lea cuidadosamente cada pregunta.</textarea></label></div></section><section class="surface form-section section-gap"><div class="surface-heading"><h2>Tiempo y acceso</h2></div><div class="form-grid two-cols"><label>Duración<input value="45"></label><label>Intentos<input value="1"></label><label>Inicio<input value="18/09/2026 10:00"></label><label>Fin<input value="18/09/2026 10:50"></label></div><div class="toggle-grid section-gap">{toggles}</div></section><section class="surface form-section section-gap"><div class="surface-heading"><h2>Plan de preguntas</h2></div><div class="exam-plan"><div class="plan-integrity ok"><div><strong>20 / 20</strong><span>Plan completo</span></div></div><div class="plan-block"><div class="plan-block-heading"><div><h3>Preguntas fijas</h3><p>Selección explícita</p></div><strong>5</strong></div><div class="plan-list"><div class="plan-item"><span class="plan-number">1</span><div><strong>Pregunta de ejemplo con texto largo</strong><small>Calidad · 1 punto</small></div><button class="text-button">Quitar</button></div></div></div></div></section></div></div>'

def live():
    rows=''.join(f'<tr><td><strong>Alumno {i} Apellido Largo</strong><span>Intento 1</span></td><td>Rindiendo</td><td>{i+4}/20<div class="mini-progress"><span style="width:{(i+4)*5}%"></span></div></td><td>{18+i}:22</td><td>{i%3}</td><td>Ahora</td><td><div class="row-actions live-row-actions"><button class="text-button">+5 min</button><button class="text-button danger-text">Finalizar</button></div></td></tr>' for i in range(1,7))
    qs=''.join(f'<th>P{i}</th>' for i in range(1,13)); matrix=''.join(f'<td><span class="matrix-dot {"answered" if j<i+5 else "current" if j==i+5 else "pending"}"></span></td>' for j in range(1,13) for i in [])
    mrows=''
    for i in range(1,6):
        cells=''.join(f'<td><span class="matrix-dot {"answered" if j < i+5 else "current" if j==i+5 else "pending"}"></span></td>' for j in range(1,13))
        mrows += f'<tr><th>Alumno {i}</th>{cells}</tr>'
    return f'<div class="page-heading-row"><div class="page-heading"><h1>Monitoreo en vivo</h1><p>Supervisa avance, tiempo e integridad.</p></div><button class="button secondary">Volver a exámenes</button></div><div class="live-monitor-page"><section class="live-monitor-statusbar surface compact-surface"><div class="live-connection connected"><span></span>Realtime</div><div><span>Rindiendo</span><strong>28</strong></div><div><span>Entregados</span><strong>12</strong></div><div><span>Sin actividad</span><strong>2</strong></div></section><section class="surface live-control-panel"><div class="live-control-copy"><h2>Controles del examen</h2><p>Gestiona acceso y tiempo.</p></div><div class="live-control-actions"><button class="button secondary">Cerrar ingresos</button><button class="button secondary">+5 min a todos</button><button class="button secondary">+10 min a todos</button><button class="button danger-button">Finalizar para todos</button></div></section><div class="toolbar surface compact-surface live-toolbar"><input class="search-input" placeholder="Buscar alumno"><select><option>Todos los estados</option></select><select><option>Mayor avance</option></select></div><section class="surface live-table-surface"><div class="table-wrap live-table-wrap"><table class="data-table live-monitor-table"><thead><tr><th>Alumno</th><th>Estado</th><th>Avance</th><th>Tiempo</th><th>Integridad</th><th>Actividad</th><th>Acciones</th></tr></thead><tbody>{rows}</tbody></table></div></section><section class="surface live-matrix-section"><div class="section-heading-row"><div><h2>Matriz de avance</h2><p>No muestra respuestas ni corrección.</p></div><div class="matrix-legend"><span><i class="matrix-dot answered"></i>Respondida</span><span><i class="matrix-dot current"></i>Actual</span></div></div><div class="live-matrix-wrap"><table class="live-matrix-table"><thead><tr><th>Alumno</th>{qs}</tr></thead><tbody>{mrows}</tbody></table></div></section></div>'

def results():
    cards=''.join(f'<article class="metric-card"><span>{t}</span><strong>{v}</strong></article>' for t,v in [('Promedio','15.7'),('Mediana','16'),('Aprobados','86%'),('Participantes','42')])
    rows=''.join(f'<tr><td class="analytics-student-cell"><strong>Apellido {i}, Nombre</strong><span>Intento 1</span></td><td>{14+i%5}</td><td>{i%3}</td><td>00:{35+i:02d}:10</td><td><div class="table-actions"><button class="button tertiary compact">PDF</button></div></td></tr>' for i in range(1,7))
    return f'<div class="page-heading-row"><div class="page-heading"><h1>Resultados y analítica</h1><p>Resumen por examen, pregunta y estudiante.</p></div><div class="results-header-actions header-actions"><button class="button secondary">CSV</button><button class="button primary">Excel</button></div></div><section class="surface analytics-selector"><div class="surface-heading analytics-toolbar-heading"><select><option>Parcial de Calidad</option></select></div></section><div class="card-grid analytics-card-grid section-gap">{cards}</div><div class="results-tabs"><button class="active">Resumen</button><button>Por pregunta</button><button>Por estudiante</button></div><section class="surface"><div class="table-wrap"><table class="data-table analytics-table"><thead><tr><th>Estudiante</th><th>Nota</th><th>Incidencias</th><th>Tiempo</th><th>Reporte</th></tr></thead><tbody>{rows}</tbody></table></div></section>'

builders={'dashboard':dashboard,'banks':banks,'editor':editor,'live':live,'results':results}
checks=[]; rows=[]
def add(name,ok,detail=''): checks.append({'name':name,'ok':bool(ok),'detail':detail})

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    try:
        for w in WIDTHS:
            for mode in MODES:
                page=browser.new_page(viewport={'width':w,'height':1000}, device_scale_factor=1)
                page.set_content(shell(builders[mode]()), wait_until='load')
                page.wait_for_timeout(25)
                metrics=page.evaluate('''() => ({
                  vw: document.documentElement.clientWidth,
                  sw: document.documentElement.scrollWidth,
                  bodyw: document.body.scrollWidth,
                  menu: (()=>{const e=document.querySelector('.mobile-menu-button');const r=e?.getBoundingClientRect();const cs=e?getComputedStyle(e):null;return e?{display:cs.display,left:r.left,right:r.right,width:r.width,height:r.height}:null})(),
                  main: (()=>{const e=document.querySelector('.dashboard-content');const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})(),
                  buttons: [...document.querySelectorAll('button')].filter(e=>getComputedStyle(e).display!=='none').map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,text:e.textContent.trim().slice(0,24)}}),
                  tables: [...document.querySelectorAll('.table-wrap,.live-matrix-wrap')].map(e=>({cw:e.clientWidth,sw:e.scrollWidth,overflow:getComputedStyle(e).overflowX}))
                })''')
                rows.append({'width':w,'mode':mode,**metrics})
                add(f'{mode} {w}px sin overflow global', metrics['sw'] <= metrics['vw']+1 and metrics['bodyw']<=metrics['vw']+1, f"sw={metrics['sw']} vw={metrics['vw']}")
                add(f'{mode} {w}px contenido principal dentro de viewport', metrics['main']['left']>=-1 and metrics['main']['right']<=metrics['vw']+1, json.dumps(metrics['main']))
                if w<=900:
                    m=metrics['menu']; add(f'{mode} {w}px menú móvil visible y táctil', bool(m) and m['display']!='none' and m['width']>=40 and m['height']>=40, json.dumps(m or {}))
                    small=[b for b in metrics['buttons'] if b['w']<34 or b['h']<34]
                    add(f'{mode} {w}px controles visibles sin objetivos minúsculos', len(small)==0, json.dumps(small[:4]))
                # wide admin tables may scroll internally, but not the page
                badtables=[t for t in metrics['tables'] if t['sw']>t['cw']+1 and t['overflow'] not in ('auto','scroll')]
                add(f'{mode} {w}px tablas anchas confinadas a scroll interno', len(badtables)==0, json.dumps(badtables))
                page.close()
    finally:
        browser.close()

failed=[c for c in checks if not c['ok']]
result={'version':'1.2.1','pages':MODES,'widths':WIDTHS,'passed':len(checks)-len(failed),'total':len(checks),'failed':len(failed),'checks':checks,'rows':rows}
(ROOT/'docs/TEACHER_RESPONSIVE_AUDIT_V121.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
for c in checks: print(('PASS' if c['ok'] else 'FAIL'), '|', c['name'], ('| '+c['detail'] if c['detail'] else ''))
print(f"\nTeacher browser audit: {result['passed']}/{result['total']} PASS")
raise SystemExit(1 if failed else 0)
