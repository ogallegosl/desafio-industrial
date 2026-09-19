import { useEffect, useMemo, useState } from 'react'
import {
  addFixedQuestion,
  addSelectionRule,
  countRuleCandidates,
  loadExamQuestionPlan,
  removeFixedQuestion,
  removeSelectionRule,
} from '../services/examQuestionPlan'
import { QUESTION_TYPES } from '../utils/constants'

const TYPE_LABELS = {
  single_choice: 'Alternativa única', multiple_choice: 'Selección múltiple', true_false: 'Verdadero / falso',
  short_text: 'Respuesta corta', numeric: 'Numérica', essay: 'Desarrollo', image_single_choice: 'Imagen + alternativas',
  image_essay: 'Imagen + desarrollo', calculation: 'Cálculo + resultado', calculation_evidence: 'Cálculo + evidencia',
  case_group: 'Caso práctico', attachment: 'Respuesta con archivo',
}

const EMPTY_RULE = {
  label: '', bankId: '', unit: '', topic: '', subtopic: '', difficulty: '', questionType: '', quantity: 1, pointsOverride: '',
}

function uniq(values) { return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es')) }

export default function ExamQuestionPlan({ examId, courseId, targetCount, onStatsChange, locked = false, lockedReason = '' }) {
  const [data, setData] = useState({ fixed: [], rules: [], banks: [], questions: [] })
  const [rule, setRule] = useState(EMPTY_RULE)
  const [fixedQuestionId, setFixedQuestionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  async function reload() {
    if (!examId || !courseId) return
    setLoading(true)
    try {
      const next = await loadExamQuestionPlan(examId, courseId)
      setData(next)
      const fixedCount = next.fixed.length
      const randomCount = next.rules.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
      onStatsChange?.({ fixedCount, randomCount, configuredCount: fixedCount + randomCount })
    } catch (error) { setMessage({ type: 'danger', text: error.message }) }
    finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [examId, courseId])

  const fixedIds = useMemo(() => new Set(data.fixed.map((item) => item.question_id)), [data.fixed])
  const availableFixed = useMemo(() => data.questions.filter((q) => !fixedIds.has(q.id)), [data.questions, fixedIds])
  const taxonomy = useMemo(() => ({
    units: uniq(data.questions.map((q) => q.unit)), topics: uniq(data.questions.map((q) => q.topic)), subtopics: uniq(data.questions.map((q) => q.subtopic)),
  }), [data.questions])
  const currentRuleCandidates = countRuleCandidates(rule, data.questions, fixedIds)
  const configured = data.fixed.length + data.rules.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const planOk = configured === Number(targetCount)

  async function addFixed() {
    if (locked) return
    if (!fixedQuestionId) return
    setBusy(true); setMessage(null)
    try { await addFixedQuestion(examId, fixedQuestionId, data.fixed.length + 1); setFixedQuestionId(''); await reload() }
    catch (error) { setMessage({ type: 'danger', text: error.message }) }
    finally { setBusy(false) }
  }

  async function addRule() {
    if (locked) return
    const quantity = Number(rule.quantity)
    if (!Number.isInteger(quantity) || quantity <= 0) { setMessage({ type: 'danger', text: 'La cantidad de la regla debe ser un entero mayor que cero.' }); return }
    if (currentRuleCandidates < quantity) { setMessage({ type: 'danger', text: `La regla solicita ${quantity} preguntas, pero actualmente solo coincide con ${currentRuleCandidates}.` }); return }
    setBusy(true); setMessage(null)
    try {
      await addSelectionRule(examId, { ...rule, ruleOrder: data.rules.length })
      setRule(EMPTY_RULE); await reload()
    } catch (error) { setMessage({ type: 'danger', text: error.message }) }
    finally { setBusy(false) }
  }

  async function removeFixed(id) {
    if (locked) return
    setBusy(true); setMessage(null)
    try { await removeFixedQuestion(id); await reload() } catch (error) { setMessage({ type: 'danger', text: error.message }) } finally { setBusy(false) }
  }
  async function removeRule(id) {
    if (locked) return
    setBusy(true); setMessage(null)
    try { await removeSelectionRule(id); await reload() } catch (error) { setMessage({ type: 'danger', text: error.message }) } finally { setBusy(false) }
  }

  if (!examId) return <div className="plan-empty"><strong>Guarda primero el examen.</strong><span>Después podrás vincular preguntas fijas y crear reglas aleatorias.</span></div>
  if (loading) return <p className="helper-copy">Cargando plan de preguntas…</p>

  return <div className="exam-plan">
    {message && <div className={`inline-alert ${message.type}`}>{message.text}</div>}
    {locked && <div className="inline-alert warning"><strong>Plan bloqueado.</strong> {lockedReason || 'Solo puede modificarse en borrador y antes del primer intento.'}</div>}
    <div className={`plan-integrity ${planOk ? 'ok' : 'warning'}`}>
      <div><strong>{configured} / {targetCount}</strong><span>preguntas configuradas frente al objetivo</span></div>
      <p>{planOk ? 'El total del plan coincide con la cantidad objetivo.' : 'Ajusta preguntas fijas o reglas antes de programar/activar el examen.'}</p>
    </div>

    <div className="plan-block">
      <div className="plan-block-heading"><div><h3>Preguntas fijas</h3><p>Siempre aparecen. Si el examen aleatoriza preguntas, también cambia su posición final.</p></div><strong>{data.fixed.length}</strong></div>
      <div className="plan-add-row">
        <select value={fixedQuestionId} disabled={locked} onChange={(e) => setFixedQuestionId(e.target.value)}>
          <option value="">Seleccionar pregunta…</option>
          {availableFixed.map((q) => <option key={q.id} value={q.id}>{TYPE_LABELS[q.type] || q.type} · {q.prompt.slice(0, 90)}</option>)}
        </select>
        <button className="button secondary button-small" disabled={locked || busy || !fixedQuestionId} type="button" onClick={addFixed}>Añadir fija</button>
      </div>
      <div className="plan-list">
        {data.fixed.length === 0 && <p className="helper-copy">No hay preguntas fijas.</p>}
        {data.fixed.map((item, index) => <div className="plan-item" key={item.id}>
          <span className="plan-number">{index + 1}</span><div><strong>{item.preguntas?.prompt}</strong><small>{TYPE_LABELS[item.preguntas?.type] || item.preguntas?.type} · {item.preguntas?.bancos_preguntas?.name}</small></div>
          <button className="text-button danger-text" disabled={locked || busy} type="button" onClick={() => removeFixed(item.id)}>Quitar</button>
        </div>)}
      </div>
    </div>

    <div className="plan-block">
      <div className="plan-block-heading"><div><h3>Reglas de selección aleatoria</h3><p>El motor toma la cantidad indicada entre las preguntas que coinciden con todos los filtros activos.</p></div><strong>{data.rules.reduce((s,r)=>s+Number(r.quantity||0),0)}</strong></div>
      <fieldset className="rule-builder plan-fieldset" disabled={locked}>
        <label>Etiqueta<input value={rule.label} onChange={(e)=>setRule({...rule,label:e.target.value})} placeholder="Ej. IPERC avanzado" /></label>
        <label>Banco<select value={rule.bankId} onChange={(e)=>setRule({...rule,bankId:e.target.value})}><option value="">Todos los bancos del curso</option>{data.banks.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>Unidad<select value={rule.unit} onChange={(e)=>setRule({...rule,unit:e.target.value})}><option value="">Todas</option>{taxonomy.units.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label>Tema<select value={rule.topic} onChange={(e)=>setRule({...rule,topic:e.target.value})}><option value="">Todos</option>{taxonomy.topics.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label>Subtema<select value={rule.subtopic} onChange={(e)=>setRule({...rule,subtopic:e.target.value})}><option value="">Todos</option>{taxonomy.subtopics.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label>Dificultad<select value={rule.difficulty} onChange={(e)=>setRule({...rule,difficulty:e.target.value})}><option value="">Todas</option><option value="basic">Básica</option><option value="intermediate">Intermedia</option><option value="advanced">Avanzada</option></select></label>
        <label>Tipo<select value={rule.questionType} onChange={(e)=>setRule({...rule,questionType:e.target.value})}><option value="">Todos</option>{QUESTION_TYPES.map((type)=><option key={type} value={type}>{TYPE_LABELS[type] || type}</option>)}</select></label>
        <label>Cantidad<input type="number" min="1" value={rule.quantity} onChange={(e)=>setRule({...rule,quantity:e.target.value})} /></label>
        <label>Puntaje por pregunta (opcional)<input type="number" min="0" step="0.1" value={rule.pointsOverride} onChange={(e)=>setRule({...rule,pointsOverride:e.target.value})} placeholder="Usar puntaje original" /></label>
        <div className="rule-candidates"><span>Coincidencias disponibles</span><strong>{currentRuleCandidates}</strong></div>
      </fieldset>
      <button className="button secondary button-small section-gap" disabled={locked || busy} type="button" onClick={addRule}>+ Añadir regla aleatoria</button>

      <div className="rule-table-wrap section-gap">
        <table className="rule-table"><thead><tr><th>#</th><th>Regla</th><th>Filtros</th><th>Cantidad</th><th>Disponibles*</th><th></th></tr></thead><tbody>
          {data.rules.map((r,index)=>{
            const normalized={bankId:r.bank_id||'',unit:r.unit||'',topic:r.topic||'',subtopic:r.subtopic||'',difficulty:r.difficulty||'',questionType:r.question_type||''}
            const available=countRuleCandidates(normalized,data.questions,fixedIds)
            const filters=[r.bancos_preguntas?.name,r.unit,r.topic,r.subtopic,r.difficulty,r.question_type?TYPE_LABELS[r.question_type]:null].filter(Boolean)
            return <tr key={r.id}><td>{index+1}</td><td>{r.metadata?.label || `Regla ${index+1}`}</td><td>{filters.length?filters.join(' · '):'Todo el curso'}</td><td><strong>{r.quantity}</strong></td><td className={available<r.quantity?'danger-text':''}>{available}</td><td><button className="text-button danger-text" type="button" disabled={locked || busy} onClick={()=>removeRule(r.id)}>Eliminar</button></td></tr>
          })}
          {!data.rules.length && <tr><td colSpan="6" className="empty-cell">No hay reglas aleatorias.</td></tr>}
        </tbody></table>
      </div>
      <p className="helper-copy">* El conteo visual no descuenta solapamientos entre reglas. En el inicio real, el servidor impide repetir preguntas y detiene la generación si una regla ya no tiene suficientes candidatas.</p>
    </div>
  </div>
}
