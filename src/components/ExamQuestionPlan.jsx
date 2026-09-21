import { useEffect, useMemo, useState } from 'react'
import {
  addFixedQuestion,
  addSelectionRule,
  countRuleCandidates,
  loadExamQuestionPlan,
  removeFixedQuestion,
  removeSelectionRule,
  updateFixedQuestion,
  updateSelectionRule,
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
function rounded(value) { return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000 }
function fmt(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(2).replace(/\.00$/, '') : '—' }
function numericOrNull(value) {
  if (value === '' || value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function ruleCandidates(rule, questions, excludedIds = new Set()) {
  return questions.filter((q) => {
    if (excludedIds.has(q.id)) return false
    if ((rule.bankId || rule.bank_id) && q.bank_id !== (rule.bankId || rule.bank_id)) return false
    if ((rule.unit || '') && q.unit !== rule.unit) return false
    if ((rule.topic || '') && q.topic !== rule.topic) return false
    if ((rule.subtopic || '') && q.subtopic !== rule.subtopic) return false
    if ((rule.difficulty || '') && q.difficulty !== rule.difficulty) return false
    if ((rule.questionType || rule.question_type) && q.type !== (rule.questionType || rule.question_type)) return false
    return true
  })
}

function effectiveFixedPoints(item) {
  const override = numericOrNull(item?.points_override)
  return override == null ? Number(item?.preguntas?.points || 0) : override
}

function effectiveRulePoints(item, questions, excludedIds) {
  const override = numericOrNull(item?.points_override)
  if (override != null) return { deterministic: true, perQuestion: override, source: 'override' }
  const candidates = ruleCandidates(item, questions, excludedIds)
  const values = [...new Set(candidates.map((question) => rounded(Number(question.points || 0))))]
  if (values.length === 1) return { deterministic: true, perQuestion: Number(values[0]), source: 'bank' }
  return { deterministic: false, perQuestion: null, source: 'mixed' }
}

function planStats(data, targetCount, maxExamPoints) {
  const fixedIds = new Set(data.fixed.map((item) => item.question_id))
  const fixedCount = data.fixed.length
  const randomCount = data.rules.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const fixedPoints = data.fixed.reduce((sum, item) => sum + effectiveFixedPoints(item), 0)
  let deterministic = true
  let randomPoints = 0
  for (const item of data.rules) {
    const info = effectiveRulePoints(item, data.questions, fixedIds)
    if (!info.deterministic) deterministic = false
    else randomPoints += Number(item.quantity || 0) * Number(info.perQuestion || 0)
  }
  const totalPoints = deterministic ? rounded(fixedPoints + randomPoints) : null
  const max = Number(maxExamPoints)
  const pointsMatch = deterministic && Number.isFinite(max) && Math.abs(Number(totalPoints) - max) <= 0.001
  return {
    fixedCount,
    randomCount,
    configuredCount: fixedCount + randomCount,
    pointsTotal: totalPoints,
    pointsDeterministic: deterministic,
    pointsMatch,
  }
}

export default function ExamQuestionPlan({ examId, courseId, targetCount, maxExamPoints = 20, onStatsChange, locked = false, lockedReason = '' }) {
  const [data, setData] = useState({ fixed: [], rules: [], banks: [], questions: [] })
  const [rule, setRule] = useState(EMPTY_RULE)
  const [fixedQuestionId, setFixedQuestionId] = useState('')
  const [fixedPoints, setFixedPoints] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  async function reload() {
    if (!examId || !courseId) return
    setLoading(true)
    try {
      const next = await loadExamQuestionPlan(examId, courseId)
      setData(next)
    } catch (error) { setMessage({ type: 'danger', text: error.message }) }
    finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [examId, courseId])

  const fixedIds = useMemo(() => new Set(data.fixed.map((item) => item.question_id)), [data.fixed])
  const availableFixed = useMemo(() => data.questions.filter((q) => !fixedIds.has(q.id)), [data.questions, fixedIds])
  const selectedFixed = useMemo(() => availableFixed.find((q) => q.id === fixedQuestionId) || null, [availableFixed, fixedQuestionId])
  const taxonomy = useMemo(() => ({
    units: uniq(data.questions.map((q) => q.unit)), topics: uniq(data.questions.map((q) => q.topic)), subtopics: uniq(data.questions.map((q) => q.subtopic)),
  }), [data.questions])
  const currentRuleCandidates = countRuleCandidates(rule, data.questions, fixedIds)
  const stats = useMemo(() => planStats(data, targetCount, maxExamPoints), [data, targetCount, maxExamPoints])
  const planOk = stats.configuredCount === Number(targetCount)

  useEffect(() => { onStatsChange?.({ ...stats, planBusy: busy }) }, [stats, busy, onStatsChange])

  async function addFixed() {
    if (locked || !fixedQuestionId) return
    const points = fixedPoints === '' ? null : Number(fixedPoints)
    if (points != null && (!Number.isFinite(points) || points < 0)) {
      setMessage({ type: 'danger', text: 'El puntaje de la pregunta debe ser un número mayor o igual a cero.' })
      return
    }
    setBusy(true); setMessage(null)
    try {
      await addFixedQuestion(examId, fixedQuestionId, data.fixed.length + 1, points)
      setFixedQuestionId(''); setFixedPoints(''); await reload()
    } catch (error) { setMessage({ type: 'danger', text: error.message }) }
    finally { setBusy(false) }
  }

  async function saveFixedPoints(item, rawValue) {
    if (locked) return
    const value = String(rawValue ?? '').trim()
    const number = value === '' ? null : Number(value)
    if (number != null && (!Number.isFinite(number) || number < 0)) {
      setMessage({ type: 'danger', text: 'El puntaje debe ser un número mayor o igual a cero.' })
      return
    }
    setBusy(true); setMessage(null)
    try {
      await updateFixedQuestion(item.id, { pointsOverride: number })
      await reload()
    } catch (error) { setMessage({ type: 'danger', text: error.message }) }
    finally { setBusy(false) }
  }

  async function addRule() {
    if (locked) return
    const quantity = Number(rule.quantity)
    if (!Number.isInteger(quantity) || quantity <= 0) { setMessage({ type: 'danger', text: 'La cantidad de la regla debe ser un entero mayor que cero.' }); return }
    if (currentRuleCandidates < quantity) { setMessage({ type: 'danger', text: `La regla solicita ${quantity} preguntas, pero actualmente solo coincide con ${currentRuleCandidates}.` }); return }
    if (rule.pointsOverride !== '' && (!Number.isFinite(Number(rule.pointsOverride)) || Number(rule.pointsOverride) < 0)) {
      setMessage({ type: 'danger', text: 'El puntaje por pregunta debe ser un número mayor o igual a cero.' }); return
    }
    setBusy(true); setMessage(null)
    try {
      await addSelectionRule(examId, { ...rule, ruleOrder: data.rules.length })
      setRule(EMPTY_RULE); await reload()
    } catch (error) { setMessage({ type: 'danger', text: error.message }) }
    finally { setBusy(false) }
  }

  async function saveRulePoints(item, rawValue) {
    if (locked) return
    const value = String(rawValue ?? '').trim()
    const number = value === '' ? null : Number(value)
    if (number != null && (!Number.isFinite(number) || number < 0)) {
      setMessage({ type: 'danger', text: 'El puntaje por pregunta debe ser un número mayor o igual a cero.' })
      return
    }
    setBusy(true); setMessage(null)
    try {
      await updateSelectionRule(item.id, { points_override: number })
      await reload()
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
    <div className={`plan-integrity ${planOk && stats.pointsMatch ? 'ok' : 'warning'}`}>
      <div><strong>{stats.configuredCount} / {targetCount}</strong><span>preguntas configuradas frente al objetivo</span></div>
      <div><strong>{stats.pointsDeterministic ? `${fmt(stats.pointsTotal)} / ${fmt(maxExamPoints)}` : 'Variable'}</strong><span>puntos asignados frente a la nota máxima</span></div>
      <p>{!planOk
        ? 'Ajusta preguntas fijas o reglas antes de programar/activar el examen.'
        : !stats.pointsDeterministic
          ? 'Hay una regla aleatoria con candidatas de distinto puntaje. Define un puntaje por pregunta en esa regla para garantizar una nota máxima exacta.'
          : stats.pointsMatch
            ? 'La cantidad de preguntas y la suma de puntajes coinciden con la configuración del examen.'
            : `La suma de puntajes debe ser exactamente ${fmt(maxExamPoints)}. Actualmente suma ${fmt(stats.pointsTotal)}.`}</p>
    </div>

    <div className="plan-block">
      <div className="plan-block-heading"><div><h3>Preguntas fijas</h3><p>Siempre aparecen. El puntaje de cada pregunta puede modificarse solo para este examen sin alterar el banco.</p></div><strong>{data.fixed.length}</strong></div>
      <div className="plan-add-row">
        <select value={fixedQuestionId} disabled={locked} onChange={(e) => { setFixedQuestionId(e.target.value); setFixedPoints('') }}>
          <option value="">Seleccionar pregunta…</option>
          {availableFixed.map((q) => <option key={q.id} value={q.id}>{TYPE_LABELS[q.type] || q.type} · {fmt(q.points)} pts · {q.prompt.slice(0, 80)}</option>)}
        </select>
        <input aria-label="Puntaje de la pregunta fija" type="number" min="0" step="0.01" disabled={locked || !fixedQuestionId} value={fixedPoints} onChange={(e) => setFixedPoints(e.target.value)} placeholder={selectedFixed ? `Base ${fmt(selectedFixed.points)}` : 'Puntaje'} />
        <button className="button secondary button-small" disabled={locked || busy || !fixedQuestionId} type="button" onClick={addFixed}>Añadir fija</button>
      </div>
      <div className="plan-list">
        {data.fixed.length === 0 && <p className="helper-copy">No hay preguntas fijas.</p>}
        {data.fixed.map((item, index) => <div className="plan-item" key={item.id}>
          <span className="plan-number">{index + 1}</span>
          <div><strong>{item.preguntas?.prompt}</strong><small>{TYPE_LABELS[item.preguntas?.type] || item.preguntas?.type} · {item.preguntas?.bancos_preguntas?.name} · Base {fmt(item.preguntas?.points)} pts</small></div>
          <label className="plan-points-control">Puntaje<input key={`${item.id}-${item.points_override ?? 'base'}`} type="number" min="0" step="0.01" disabled={locked || busy} defaultValue={item.points_override ?? ''} placeholder={fmt(item.preguntas?.points)} onBlur={(e) => saveFixedPoints(item, e.target.value)} /><small>Efectivo: {fmt(effectiveFixedPoints(item))}</small></label>
          <button className="text-button danger-text" disabled={locked || busy} type="button" onClick={() => removeFixed(item.id)}>Quitar</button>
        </div>)}
      </div>
    </div>

    <div className="plan-block">
      <div className="plan-block-heading"><div><h3>Reglas de selección aleatoria</h3><p>El motor toma la cantidad indicada entre las preguntas coincidentes. Puedes fijar un puntaje común para todas las preguntas seleccionadas por la regla.</p></div><strong>{data.rules.reduce((s,r)=>s+Number(r.quantity||0),0)}</strong></div>
      <fieldset className="rule-builder plan-fieldset" disabled={locked}>
        <label>Etiqueta<input value={rule.label} onChange={(e)=>setRule({...rule,label:e.target.value})} placeholder="Ej. IPERC avanzado" /></label>
        <label>Banco<select value={rule.bankId} onChange={(e)=>setRule({...rule,bankId:e.target.value})}><option value="">Todos los bancos del curso</option>{data.banks.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>Unidad<select value={rule.unit} onChange={(e)=>setRule({...rule,unit:e.target.value})}><option value="">Todas</option>{taxonomy.units.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label>Tema<select value={rule.topic} onChange={(e)=>setRule({...rule,topic:e.target.value})}><option value="">Todos</option>{taxonomy.topics.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label>Subtema<select value={rule.subtopic} onChange={(e)=>setRule({...rule,subtopic:e.target.value})}><option value="">Todos</option>{taxonomy.subtopics.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label>Dificultad<select value={rule.difficulty} onChange={(e)=>setRule({...rule,difficulty:e.target.value})}><option value="">Todas</option><option value="basic">Básica</option><option value="intermediate">Intermedia</option><option value="advanced">Avanzada</option></select></label>
        <label>Tipo<select value={rule.questionType} onChange={(e)=>setRule({...rule,questionType:e.target.value})}><option value="">Todos</option>{QUESTION_TYPES.map((type)=><option key={type} value={type}>{TYPE_LABELS[type] || type}</option>)}</select></label>
        <label>Cantidad<input type="number" min="1" value={rule.quantity} onChange={(e)=>setRule({...rule,quantity:e.target.value})} /></label>
        <label>Puntaje por pregunta<input type="number" min="0" step="0.01" value={rule.pointsOverride} onChange={(e)=>setRule({...rule,pointsOverride:e.target.value})} placeholder="Usar puntaje del banco si es uniforme" /><small>Si las candidatas tienen valores distintos, define aquí un puntaje común.</small></label>
        <div className="rule-candidates"><span>Coincidencias disponibles</span><strong>{currentRuleCandidates}</strong></div>
      </fieldset>
      <button className="button secondary button-small section-gap" disabled={locked || busy} type="button" onClick={addRule}>+ Añadir regla aleatoria</button>

      <div className="rule-table-wrap section-gap">
        <table className="rule-table"><thead><tr><th>#</th><th>Regla</th><th>Filtros</th><th>Cantidad</th><th>Puntaje c/u</th><th>Subtotal</th><th>Disponibles*</th><th></th></tr></thead><tbody>
          {data.rules.map((r,index)=>{
            const normalized={bankId:r.bank_id||'',unit:r.unit||'',topic:r.topic||'',subtopic:r.subtopic||'',difficulty:r.difficulty||'',questionType:r.question_type||''}
            const available=countRuleCandidates(normalized,data.questions,fixedIds)
            const filters=[r.bancos_preguntas?.name,r.unit,r.topic,r.subtopic,r.difficulty,r.question_type?TYPE_LABELS[r.question_type]:null].filter(Boolean)
            const pointInfo=effectiveRulePoints(r,data.questions,fixedIds)
            const subtotal=pointInfo.deterministic ? Number(r.quantity||0)*Number(pointInfo.perQuestion||0) : null
            return <tr key={r.id}><td>{index+1}</td><td>{r.metadata?.label || `Regla ${index+1}`}</td><td>{filters.length?filters.join(' · '):'Todo el curso'}</td><td><strong>{r.quantity}</strong></td><td><input key={`${r.id}-${r.points_override ?? 'base'}`} className="rule-points-input" type="number" min="0" step="0.01" disabled={locked || busy} defaultValue={r.points_override ?? ''} placeholder={pointInfo.deterministic ? fmt(pointInfo.perQuestion) : 'Definir'} onBlur={(e)=>saveRulePoints(r,e.target.value)} />{!pointInfo.deterministic && <small className="danger-text">Puntaje variable</small>}</td><td>{subtotal == null ? '—' : fmt(subtotal)}</td><td className={available<r.quantity?'danger-text':''}>{available}</td><td><button className="text-button danger-text" type="button" disabled={locked || busy} onClick={()=>removeRule(r.id)}>Eliminar</button></td></tr>
          })}
          {!data.rules.length && <tr><td colSpan="8" className="empty-cell">No hay reglas aleatorias.</td></tr>}
        </tbody></table>
      </div>
      <p className="helper-copy">* El conteo visual no descuenta solapamientos entre reglas. El servidor impide preguntas repetidas. Para que la nota máxima sea exacta, toda regla con candidatas de puntajes distintos debe tener un puntaje por pregunta definido.</p>
    </div>
  </div>
}
