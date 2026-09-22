import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AiGradingAssistant from '../components/AiGradingAssistant'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'
import { recordAiGradingDecision } from '../services/aiGrading'
import {
  createEvidenceSignedUrl,
  gradeManualResponse,
  listManualReviews,
  saveRubricTemplate,
} from '../services/manualGrading'

function studentName(student) {
  if (!student) return 'Estudiante'
  return `${student.last_name || ''} ${student.first_name || ''}`.trim() || 'Estudiante'
}

function fmtNumber(value, digits = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-PE', { maximumFractionDigits: digits }).format(n)
}

function criterionId() {
  return globalThis.crypto?.randomUUID?.() || `criterion-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function answerSummary(item) {
  const question = item.question || {}
  const type = question.question_type
  if (['single_choice', 'image_single_choice', 'multiple_choice'].includes(type)) {
    const ids = new Set(Array.isArray(item.selected_option_ids) ? item.selected_option_ids : [])
    const selected = (question.options_snapshot || []).filter((option) => ids.has(option.id))
    return selected.length ? selected.map((option) => option.content).join(' · ') : 'Sin alternativa seleccionada'
  }
  if (type === 'true_false') {
    const value = item.answer_payload?.value
    return typeof value === 'boolean' ? (value ? 'Verdadero' : 'Falso') : 'Sin respuesta'
  }
  if (['numeric', 'calculation', 'calculation_evidence'].includes(type)) {
    return item.answer_numeric === null || item.answer_numeric === undefined ? 'Sin resultado numérico' : String(item.answer_numeric)
  }
  if (type === 'attachment') return item.evidence?.length ? 'Respuesta mediante archivo adjunto' : 'Sin archivo adjunto'
  if (type === 'case_group') return 'Caso práctico con respuestas por subpregunta'
  return item.answer_text?.trim() || 'Sin respuesta escrita'
}

function AnswerDetail({ item }) {
  const question = item.question || {}
  const type = question.question_type

  if (type === 'case_group') {
    const children = Array.isArray(question.metadata_snapshot?.caseSubquestions) ? question.metadata_snapshot.caseSubquestions : []
    const answers = item.answer_payload?.caseAnswers || {}
    return (
      <div className="manual-case-list">
        {children.map((child, index) => {
          const answer = answers[child.id] || {}
          const selectedIds = new Set(answer.selectedOptionIds || [])
          const selected = (child.options || []).filter((option) => selectedIds.has(option.id)).map((option) => option.content)
          const value = child.type === 'true_false'
            ? (typeof answer.answerPayload?.value === 'boolean' ? (answer.answerPayload.value ? 'Verdadero' : 'Falso') : '')
            : ['numeric', 'calculation'].includes(child.type)
              ? answer.answerNumeric
              : selected.length ? selected.join(' · ') : answer.answerText
          return (
            <div className="manual-case-item" key={child.id || index}>
              <span>Subpregunta {index + 1} · {fmtNumber(child.points)} pts</span>
              <strong>{child.prompt}</strong>
              <p>{String(value ?? '').trim() || 'Sin respuesta'}</p>
            </div>
          )
        })}
      </div>
    )
  }

  const text = answerSummary(item)
  const isLong = ['essay', 'image_essay', 'short_text'].includes(type)
  return isLong ? <div className="manual-answer-long">{text}</div> : <div className="manual-answer-compact">{text}</div>
}

function EvidenceViewer({ evidence }) {
  const { formatDateTime } = useGlobalSettings()
  const [urls, setUrls] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setUrls([])
    setError('')
    if (!evidence?.length) return undefined
    Promise.all(evidence.map(async (item) => ({ ...item, url: await createEvidenceSignedUrl(item) })))
      .then((rows) => { if (!cancelled) setUrls(rows) })
      .catch((err) => { if (!cancelled) setError(err.message || 'No se pudo abrir la evidencia.') })
    return () => { cancelled = true }
  }, [evidence])

  if (!evidence?.length) return null
  return (
    <section className="manual-evidence-block">
      <div className="manual-section-label">Evidencia adjunta</div>
      {error && <div className="form-alert danger">{error}</div>}
      {!urls.length && !error && <div className="manual-evidence-loading">Generando vista segura…</div>}
      <div className="manual-evidence-grid">
        {urls.map((item) => (
          <article className="manual-evidence-card" key={item.id}>
            {item.mime_type?.startsWith('image/') ? (
              <a href={item.url} target="_blank" rel="noreferrer"><img src={item.url} alt={item.original_filename} loading="lazy" decoding="async" /></a>
            ) : (
              <a className="manual-pdf-link" href={item.url} target="_blank" rel="noreferrer"><strong>PDF</strong><span>{item.original_filename}</span></a>
            )}
            <small>{item.original_filename} · {formatDateTime(item.uploaded_at)}</small>
          </article>
        ))}
      </div>
    </section>
  )
}

function RubricEditor({ maxPoints, criteria, setCriteria }) {
  const totalMax = criteria.reduce((sum, item) => sum + (Number(item.maxPoints) || 0), 0)
  const totalScore = criteria.reduce((sum, item) => sum + (Number(item.score) || 0), 0)

  const update = (index, patch) => setCriteria(criteria.map((item, i) => i === index ? { ...item, ...patch } : item))
  const remove = (index) => setCriteria(criteria.filter((_, i) => i !== index))
  const add = () => setCriteria([...criteria, { id: criterionId(), name: '', description: '', maxPoints: 1, score: 0, comment: '' }])

  return (
    <div className="rubric-editor">
      <div className="rubric-editor-head">
        <div><strong>Rúbrica de evaluación</strong><span>La suma de máximos debe ser {fmtNumber(maxPoints)} puntos.</span></div>
        <button type="button" className="button tertiary compact" onClick={add}>+ Criterio</button>
      </div>
      {criteria.map((criterion, index) => (
        <div className="rubric-row" key={criterion.id || index}>
          <div className="rubric-main-fields">
            <input value={criterion.name || ''} onChange={(e) => update(index, { name: e.target.value })} placeholder={`Criterio ${index + 1}`} />
            <input value={criterion.description || ''} onChange={(e) => update(index, { description: e.target.value })} placeholder="Descripción opcional" />
          </div>
          <label><span>Máx.</span><input type="number" min="0.001" step="0.001" value={criterion.maxPoints} onChange={(e) => update(index, { maxPoints: e.target.value })} /></label>
          <label><span>Puntaje</span><input type="number" min="0" step="0.001" max={criterion.maxPoints || undefined} value={criterion.score} onChange={(e) => update(index, { score: e.target.value })} /></label>
          <button type="button" className="rubric-remove" onClick={() => remove(index)} aria-label="Eliminar criterio">×</button>
        </div>
      ))}
      <div className={`rubric-total ${Math.abs(totalMax - Number(maxPoints)) > 0.001 ? 'invalid' : ''}`}>
        <span>Máximo configurado: <strong>{fmtNumber(totalMax)}</strong> / {fmtNumber(maxPoints)}</span>
        <span>Puntaje otorgado: <strong>{fmtNumber(totalScore)}</strong></span>
      </div>
    </div>
  )
}

export default function TeacherManualGradingPage() {
  const { formatDateTime } = useGlobalSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState(searchParams.get('response') || null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('pending')
  const [useRubric, setUseRubric] = useState(false)
  const [criteria, setCriteria] = useState([])
  const [score, setScore] = useState('0')
  const [feedback, setFeedback] = useState('')
  const [pendingAiSuggestionId, setPendingAiSuggestionId] = useState(null)

  const load = async (preserveId = null) => {
    setLoading(true)
    setMessage('')
    try {
      const data = await listManualReviews()
      setItems(data)
      const wanted = preserveId || selectedId || searchParams.get('response')
      const next = data.find((item) => item.id === wanted)?.id || data.find((item) => item.review_status === 'pending')?.id || data[0]?.id || null
      setSelectedId(next)
    } catch (error) {
      setMessage(error.message || 'No se pudo cargar la cola de revisión.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = items.find((item) => item.id === selectedId) || null

  useEffect(() => {
    if (!selected) return
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('response', selected.id)
      return next
    }, { replace: true })
    setSuccess('')
    setMessage('')
    setPendingAiSuggestionId(null)
    setFeedback(selected.teacher_feedback || '')
    const saved = Array.isArray(selected.manual_grading_details?.rubricScores) ? selected.manual_grading_details.rubricScores : []
    const frozen = Array.isArray(selected.question?.rubric_snapshot?.criteria) ? selected.question.rubric_snapshot.criteria : []
    if (saved.length) {
      setUseRubric(true)
      setCriteria(saved.map((item) => ({ ...item, id: item.id || criterionId(), score: item.score ?? 0 })))
      setScore(String(selected.manual_score ?? 0))
    } else if (frozen.length) {
      setUseRubric(true)
      setCriteria(frozen.map((item) => ({ ...item, id: item.id || criterionId(), score: 0, comment: '' })))
      setScore('0')
    } else {
      setUseRubric(false)
      setCriteria([])
      setScore(String(selected.manual_score ?? 0))
    }
  }, [selected?.id, selected?.manual_graded_at]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return items.filter((item) => {
      if (status !== 'all' && item.review_status !== status) return false
      if (!term) return true
      return [studentName(item.student), item.exam?.title, item.question?.prompt_snapshot]
        .filter(Boolean).join(' ').toLowerCase().includes(term)
    })
  }, [items, query, status])

  const pendingCount = items.filter((item) => item.review_status === 'pending').length
  const reviewedCount = items.filter((item) => item.review_status === 'reviewed').length
  const maxPoints = Number(selected?.question?.points_snapshot || 0)
  const rubricScore = criteria.reduce((sum, item) => sum + (Number(item.score) || 0), 0)
  const rubricMax = criteria.reduce((sum, item) => sum + (Number(item.maxPoints) || 0), 0)
  const effectiveScore = useRubric ? rubricScore : Number(score)
  const rubricValid = !useRubric || (criteria.length > 0 && criteria.every((item) => String(item.name || '').trim() && Number(item.maxPoints) > 0 && Number(item.score) >= 0 && Number(item.score) <= Number(item.maxPoints)) && Math.abs(rubricMax - maxPoints) <= 0.001)
  const scoreValid = Number.isFinite(effectiveScore) && effectiveScore >= 0 && effectiveScore <= maxPoints

  const handleSave = async () => {
    if (!selected || !scoreValid || !rubricValid) return
    setSaving(true)
    setMessage('')
    setSuccess('')
    try {
      const rubricScores = useRubric ? criteria.map((item, index) => ({
        id: item.id || criterionId(),
        name: String(item.name || '').trim(),
        description: String(item.description || '').trim(),
        maxPoints: Number(item.maxPoints),
        score: Number(item.score),
        comment: String(item.comment || '').trim(),
        position: index + 1,
      })) : []
      const result = await gradeManualResponse({ responseId: selected.id, score: effectiveScore, feedback, rubricScores })
      let auditWarning = ''
      if (pendingAiSuggestionId) {
        try {
          await recordAiGradingDecision({ suggestionId: pendingAiSuggestionId, decision: 'applied' })
          setPendingAiSuggestionId(null)
        } catch {
          auditWarning = ' La nota se guardó correctamente, pero quedó pendiente registrar en la auditoría que se utilizó la sugerencia de IA.'
        }
      }
      const baseSuccess = result?.grade?.pendingManualReviews === 0
        ? `Revisión guardada. La nota final del intento quedó en ${fmtNumber(result.grade.finalGrade)}.`
        : `Revisión guardada. Quedan ${result?.grade?.pendingManualReviews ?? 'otras'} respuestas pendientes en este intento.`
      setSuccess(`${baseSuccess}${auditWarning}`)
      await load(selected.id)
    } catch (error) {
      setMessage(error.message || 'No se pudo guardar la calificación manual.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTemplate = async () => {
    if (!selected?.question?.question_id || !useRubric || !rubricValid) return
    setSaving(true)
    setMessage('')
    try {
      await saveRubricTemplate({
        questionId: selected.question.question_id,
        name: selected.question.rubric_snapshot?.name || `Rúbrica · ${selected.exam?.title || 'Pregunta'}`,
        criteria,
      })
      setSuccess('Rúbrica guardada como plantilla para futuros intentos de esta pregunta. El intento actual conserva su snapshot.')
    } catch (error) {
      setMessage(error.message || 'No se pudo guardar la plantilla de rúbrica.')
    } finally {
      setSaving(false)
    }
  }

  const handleApplyAiSuggestion = (suggestion) => {
    const suggestedById = new Map((suggestion?.rubricScores || []).map((item) => [item.id, item]))
    setUseRubric(true)
    setCriteria((current) => current.map((criterion) => {
      const suggested = suggestedById.get(criterion.id)
      return suggested ? { ...criterion, score: suggested.score, comment: suggested.comment || '' } : criterion
    }))
    setScore(String(suggestion?.score ?? 0))
    setFeedback(suggestion?.feedback || '')
    setPendingAiSuggestionId(suggestion?.id || null)
  }

  return (
    <section>
      <PageHeader
        eyebrow="Corrección"
        title="Calificación manual"
        description="Revisa respuestas de desarrollo, casos y evidencias. El puntaje manual sustituye al puntaje automático preliminar de la pregunta revisada."
      />

      <div className="manual-review-stats">
        <button type="button" className={status === 'pending' ? 'active' : ''} onClick={() => setStatus('pending')}><strong>{pendingCount}</strong><span>Pendientes</span></button>
        <button type="button" className={status === 'reviewed' ? 'active' : ''} onClick={() => setStatus('reviewed')}><strong>{reviewedCount}</strong><span>Revisadas</span></button>
        <button type="button" className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}><strong>{items.length}</strong><span>Total</span></button>
      </div>

      {message && <div className="form-alert danger">{message}</div>}
      {success && <div className="form-alert success">{success}</div>}

      <div className="manual-grading-layout">
        <section className="surface manual-queue">
          <div className="surface-heading"><div><h2>{loading ? 'Cargando…' : `${filtered.length} respuesta${filtered.length === 1 ? '' : 's'}`}</h2><p>Selecciona una respuesta para calificar.</p></div></div>
          <div className="manual-search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar alumno, examen o pregunta" /></div>
          {!loading && filtered.length === 0 && <div className="empty-review-copy">No hay respuestas en este filtro.</div>}
          {filtered.map((item) => (
            <button type="button" key={item.id} className={`manual-queue-item ${selectedId === item.id ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
              <div><strong>{studentName(item.student)}</strong><span>{item.exam?.title || 'Examen'} · P{item.question?.display_order || '—'}</span><small>{item.question?.prompt_snapshot || 'Pregunta'}</small></div>
              <StatusBadge tone={item.review_status === 'pending' ? 'warning' : 'success'}>{item.review_status === 'pending' ? 'Pendiente' : 'Revisada'}</StatusBadge>
            </button>
          ))}
        </section>

        <section className="surface manual-review-detail">
          {!selected ? <div className="empty-review-copy large">Selecciona una respuesta pendiente.</div> : (
            <>
              <div className="surface-heading manual-detail-head">
                <div><h2>Pregunta {selected.question?.display_order || '—'}</h2><p>{studentName(selected.student)} · intento {selected.attempt?.attempt_number || 1}</p></div>
                <StatusBadge tone={selected.review_status === 'pending' ? 'warning' : 'success'}>{selected.review_status === 'pending' ? 'Pendiente' : 'Revisada'}</StatusBadge>
              </div>

              <div className="manual-question-box">
                <div><span>Enunciado</span><strong>{selected.question?.prompt_snapshot}</strong></div>
                <div className="manual-points-pill">Máximo <b>{fmtNumber(maxPoints)}</b> pts</div>
              </div>

              <section className="manual-content-section">
                <div className="manual-section-label">Respuesta del estudiante</div>
                <AnswerDetail item={selected} />
              </section>

              <EvidenceViewer evidence={selected.evidence} />

              <section className="manual-score-section">
                <div className="manual-score-head">
                  <div><strong>Evaluación docente</strong><span>Puntaje automático preliminar: {fmtNumber(selected.auto_score || 0)} / {fmtNumber(maxPoints)}</span></div>
                  <label className="toggle-row compact-toggle"><input type="checkbox" checked={useRubric} onChange={(e) => {
                    const checked = e.target.checked
                    setUseRubric(checked)
                    if (checked && !criteria.length) setCriteria([{ id: criterionId(), name: 'Calidad de la respuesta', description: '', maxPoints, score: 0, comment: '' }])
                  }} /><span>Usar rúbrica</span></label>
                </div>

                {useRubric ? <RubricEditor maxPoints={maxPoints} criteria={criteria} setCriteria={setCriteria} /> : (
                  <label className="manual-score-input"><span>Puntaje otorgado</span><div><input type="number" min="0" max={maxPoints} step="0.001" value={score} onChange={(e) => setScore(e.target.value)} /><b>/ {fmtNumber(maxPoints)}</b></div></label>
                )}

                <label className="manual-feedback"><span>Comentario al estudiante</span><textarea rows="5" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Retroalimentación opcional sobre procedimiento, resultado o interpretación." /></label>

                {!scoreValid && <div className="inline-validation danger">El puntaje debe estar entre 0 y {fmtNumber(maxPoints)}.</div>}
                {useRubric && !rubricValid && <div className="inline-validation danger">Completa los criterios y asegúrate de que sus máximos sumen exactamente {fmtNumber(maxPoints)} puntos.</div>}

                <AiGradingAssistant
                  responseId={selected.id}
                  questionType={selected.question?.question_type}
                  maxPoints={maxPoints}
                  useRubric={useRubric}
                  rubricValid={rubricValid}
                  criteria={criteria}
                  saving={saving}
                  onApply={handleApplyAiSuggestion}
                />

                <div className="manual-actions">
                  {useRubric && selected.question?.question_id && <button type="button" className="button secondary" disabled={saving || !rubricValid} onClick={handleSaveTemplate}>Guardar rúbrica para futuros intentos</button>}
                  <button type="button" className="button primary" disabled={saving || !scoreValid || !rubricValid} onClick={handleSave}>{saving ? 'Guardando…' : selected.review_status === 'reviewed' ? 'Actualizar calificación' : 'Guardar calificación'}</button>
                </div>
              </section>

              <div className="manual-attempt-summary">
                <span>Intento entregado: {formatDateTime(selected.attempt?.submitted_at)}</span>
                <span>Pendientes en el intento: <strong>{selected.grade?.pending_manual_reviews ?? '—'}</strong></span>
                <span>Nota final: <strong>{selected.grade?.final_grade == null ? 'Pendiente' : fmtNumber(selected.grade.final_grade)}</strong></span>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  )
}
