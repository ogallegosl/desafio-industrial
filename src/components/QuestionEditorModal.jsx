import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import {
  QUESTION_DIFFICULTIES,
  QUESTION_DIFFICULTY_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
} from '../utils/constants'
import { getQuestion, IMAGE_TYPES, MAX_IMAGE_BYTES, saveQuestion } from '../services/questionBankManagement'

const OPTION_TYPES = new Set(['single_choice', 'multiple_choice', 'image_single_choice'])
const NUMERIC_TYPES = new Set(['numeric', 'calculation', 'calculation_evidence'])
const MANUAL_TYPES = new Set(['essay', 'image_essay', 'attachment'])
const CHILD_TYPES = QUESTION_TYPES.filter((type) => !['case_group', 'calculation_evidence', 'attachment'].includes(type))

function defaultOptions() {
  return ['A', 'B', 'C', 'D'].map((key, index) => ({ key, content: '', isCorrect: index === 0 }))
}

function emptyQuestion(bankId = '') {
  return {
    id: null,
    bankId,
    type: 'single_choice',
    prompt: '',
    unit: '',
    topic: '',
    subtopic: '',
    difficulty: 'intermediate',
    points: 1,
    options: defaultOptions(),
    trueFalseValue: true,
    acceptedAnswers: [''],
    shortTextMode: 'case_insensitive',
    trimWhitespace: true,
    collapseWhitespace: false,
    numericMode: 'exact',
    numericAnswer: '',
    numericTolerance: '',
    numericMin: '',
    numericMax: '',
    explanation: '',
    mediaFile: null,
    mediaPreview: null,
    existingMediaUrl: null,
    removeMedia: false,
    isActive: true,
    metadata: {},
    children: [],
  }
}

function rowToEditor(row) {
  return {
    id: row.id,
    bankId: row.bank_id,
    type: row.type,
    prompt: row.prompt || '',
    unit: row.unit || '',
    topic: row.topic || '',
    subtopic: row.subtopic || '',
    difficulty: row.difficulty || 'intermediate',
    points: Number(row.points ?? 1),
    options: row.alternativas?.length
      ? row.alternativas.map((option) => ({ key: option.option_key, content: option.content, isCorrect: option.is_correct }))
      : defaultOptions(),
    trueFalseValue: Boolean(row.answer_key?.value),
    acceptedAnswers: row.answer_key?.answers?.length ? row.answer_key.answers : [''],
    shortTextMode: row.grading_config?.mode || 'case_insensitive',
    trimWhitespace: row.grading_config?.trimWhitespace !== false,
    collapseWhitespace: row.grading_config?.collapseWhitespace === true,
    numericMode: row.grading_config?.numericMode || (row.answer_key?.min != null || row.answer_key?.max != null ? 'range' : row.numeric_tolerance != null ? 'tolerance' : 'exact'),
    numericAnswer: row.answer_key?.value ?? '',
    numericTolerance: row.numeric_tolerance ?? '',
    numericMin: row.answer_key?.min ?? row.grading_config?.min ?? '',
    numericMax: row.answer_key?.max ?? row.grading_config?.max ?? '',
    explanation: row.explanation || '',
    mediaFile: null,
    mediaPreview: null,
    existingMediaUrl: row.mediaUrl || null,
    removeMedia: false,
    isActive: row.is_active !== false,
    metadata: row.metadata || {},
    children: (row.children || []).map((child) => ({
      id: child.id,
      bankId: row.bank_id,
      type: child.type,
      prompt: child.prompt || '',
      unit: child.unit || row.unit || '',
      topic: child.topic || row.topic || '',
      subtopic: child.subtopic || row.subtopic || '',
      difficulty: child.difficulty || 'intermediate',
      points: Number(child.points ?? 1),
      options: child.alternativas?.length
        ? child.alternativas.map((option) => ({ key: option.option_key, content: option.content, isCorrect: option.is_correct }))
        : defaultOptions(),
      trueFalseValue: Boolean(child.answer_key?.value),
      acceptedAnswers: child.answer_key?.answers?.length ? child.answer_key.answers : [''],
      shortTextMode: child.grading_config?.mode || 'case_insensitive',
      trimWhitespace: child.grading_config?.trimWhitespace !== false,
      collapseWhitespace: child.grading_config?.collapseWhitespace === true,
      numericMode: child.grading_config?.numericMode || (child.answer_key?.min != null || child.answer_key?.max != null ? 'range' : child.numeric_tolerance != null ? 'tolerance' : 'exact'),
      numericAnswer: child.answer_key?.value ?? '',
      numericTolerance: child.numeric_tolerance ?? '',
      numericMin: child.answer_key?.min ?? child.grading_config?.min ?? '',
      numericMax: child.answer_key?.max ?? child.grading_config?.max ?? '',
      explanation: child.explanation || '',
      isActive: child.is_active !== false,
      metadata: child.metadata || {},
      mediaFile: null,
      mediaPreview: null,
      existingMediaUrl: null,
      removeMedia: false,
    })),
  }
}

function renumberOptions(options) {
  return options.map((option, index) => ({ ...option, key: String.fromCharCode(65 + index) }))
}

function OptionEditor({ question, onChange }) {
  const multiple = question.type === 'multiple_choice'

  const updateOption = (index, patch) => {
    let options = question.options.map((option, position) => position === index ? { ...option, ...patch } : option)
    if (!multiple && patch.isCorrect) options = options.map((option, position) => ({ ...option, isCorrect: position === index }))
    onChange({ options })
  }

  const addOption = () => {
    if (question.options.length >= 8) return
    onChange({ options: renumberOptions([...question.options, { key: '', content: '', isCorrect: false }]) })
  }

  const removeOption = (index) => {
    if (question.options.length <= 2) return
    const next = renumberOptions(question.options.filter((_, position) => position !== index))
    if (!multiple && !next.some((option) => option.isCorrect)) next[0].isCorrect = true
    onChange({ options: next })
  }

  return (
    <div className="answer-config-block">
      <div className="section-label-row">
        <div><strong>Alternativas</strong><span>{multiple ? 'Marca una o más respuestas correctas.' : 'Marca una sola respuesta correcta.'}</span></div>
        <button type="button" className="text-button" onClick={addOption} disabled={question.options.length >= 8}>+ Alternativa</button>
      </div>
      <div className="option-editor-list">
        {question.options.map((option, index) => (
          <div className="option-editor-row" key={`${option.key}-${index}`}>
            <button type="button" className={`correct-toggle${option.isCorrect ? ' active' : ''}`} aria-pressed={option.isCorrect} aria-label={`${option.isCorrect ? 'Alternativa correcta' : 'Marcar como correcta'}: ${option.key}`} onClick={() => updateOption(index, { isCorrect: multiple ? !option.isCorrect : true })}>{option.isCorrect ? '✓' : option.key}</button>
            <input value={option.content} onChange={(event) => updateOption(index, { content: event.target.value })} placeholder={`Alternativa ${option.key}`} />
            <button type="button" className="icon-text-button danger-text" onClick={() => removeOption(index)} disabled={question.options.length <= 2}>Eliminar</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnswerConfiguration({ question, onChange, compact = false }) {
  if (OPTION_TYPES.has(question.type)) return <OptionEditor question={question} onChange={onChange} />

  if (question.type === 'true_false') {
    return <div className="answer-config-block"><strong>Respuesta correcta</strong><div className="segmented-control"><button type="button" aria-pressed={question.trueFalseValue === true} className={question.trueFalseValue ? 'active' : ''} onClick={() => onChange({ trueFalseValue: true })}>Verdadero</button><button type="button" aria-pressed={question.trueFalseValue === false} className={!question.trueFalseValue ? 'active' : ''} onClick={() => onChange({ trueFalseValue: false })}>Falso</button></div></div>
  }

  if (question.type === 'short_text') {
    return <div className="answer-config-block">
      <div className="section-label-row"><div><strong>Respuestas aceptables</strong><span>El alumno podrá escribir cualquiera de estas variantes.</span></div></div>
      <div className="accepted-answer-list">{question.acceptedAnswers.map((answer, index) => <div className="accepted-answer-row" key={index}><input aria-label={`Respuesta aceptable ${index + 1}`} value={answer} onChange={(event) => { const next = [...question.acceptedAnswers]; next[index] = event.target.value; onChange({ acceptedAnswers: next }) }} placeholder="Respuesta aceptable" /><button type="button" className="icon-text-button danger-text" onClick={() => question.acceptedAnswers.length > 1 && onChange({ acceptedAnswers: question.acceptedAnswers.filter((_, pos) => pos !== index) })}>Eliminar</button></div>)}</div>
      <button type="button" className="text-button" onClick={() => onChange({ acceptedAnswers: [...question.acceptedAnswers, ''] })}>+ Añadir variante</button>
      {!compact && <div className="form-grid two-cols top-gap-small"><label>Comparación<select value={question.shortTextMode} onChange={(event) => onChange({ shortTextMode: event.target.value })}><option value="case_insensitive">Ignorar mayúsculas/minúsculas</option><option value="exact">Coincidencia exacta</option></select></label><label className="checkbox-label"><input type="checkbox" checked={question.trimWhitespace} onChange={(event) => onChange({ trimWhitespace: event.target.checked })} /> Ignorar espacios al inicio y final</label><label className="checkbox-label span-2"><input type="checkbox" checked={question.collapseWhitespace} onChange={(event) => onChange({ collapseWhitespace: event.target.checked })} /> Ignorar diferencias por espacios repetidos dentro de la respuesta</label></div>}
    </div>
  }

  if (NUMERIC_TYPES.has(question.type)) {
    const mode = question.numericMode || 'exact'
    return <div className="answer-config-block">
      <div className="form-grid two-cols">
        <label>Regla de corrección<select value={mode} onChange={(event) => onChange({ numericMode: event.target.value })}><option value="exact">Valor exacto</option><option value="tolerance">Valor con tolerancia ±</option><option value="range">Intervalo aceptado</option></select></label>
        {mode !== 'range' && <label>Respuesta numérica<input type="number" step="any" value={question.numericAnswer} onChange={(event) => onChange({ numericAnswer: event.target.value })} placeholder="Ej. 25.5" /></label>}
        {mode === 'tolerance' && <label>Tolerancia ±<input type="number" min="0" step="any" value={question.numericTolerance} onChange={(event) => onChange({ numericTolerance: event.target.value })} placeholder="Ej. 0.5" /></label>}
        {mode === 'range' && <><label>Mínimo aceptado<input type="number" step="any" value={question.numericMin} onChange={(event) => onChange({ numericMin: event.target.value })} placeholder="Ej. 24.5" /></label><label>Máximo aceptado<input type="number" step="any" value={question.numericMax} onChange={(event) => onChange({ numericMax: event.target.value })} placeholder="Ej. 25.5" /></label></>}
      </div>
      {question.type === 'calculation_evidence' && <p className="field-hint">El resultado numérico se corrige automáticamente; la evidencia queda pendiente de revisión docente.</p>}
    </div>
  }

  if (MANUAL_TYPES.has(question.type)) return <div className="answer-config-block manual-note">Esta respuesta quedará marcada para revisión manual del docente.{question.type === 'attachment' ? ' El estudiante deberá adjuntar un archivo.' : ''}</div>
  return null
}

function CaseChildrenEditor({ question, onChange }) {
  const children = question.children || []
  const updateChild = (index, patch) => onChange({ children: children.map((child, pos) => pos === index ? { ...child, ...patch } : child) })
  const removeChild = (index) => onChange({ children: children.filter((_, pos) => pos !== index) })
  const addChild = () => onChange({ children: [...children, { ...emptyQuestion(question.bankId), type: 'single_choice', unit: question.unit, topic: question.topic, subtopic: question.subtopic, points: 1 }] })

  return <div className="case-editor-block">
    <div className="section-label-row"><div><strong>Subpreguntas del caso</strong><span>Cada una conserva su propia clave de corrección.</span></div><button type="button" className="button secondary button-small" onClick={addChild}>+ Subpregunta</button></div>
    {children.length === 0 && <div className="inline-empty">Añade al menos una subpregunta para completar el caso.</div>}
    <div className="case-child-list">{children.map((child, index) => <article className="case-child-card" key={child.id || index}>
      <div className="case-child-header"><strong>Subpregunta {index + 1}</strong><button type="button" className="icon-text-button danger-text" onClick={() => removeChild(index)}>Eliminar</button></div>
      <div className="form-grid two-cols"><label>Tipo<select value={child.type} onChange={(event) => { const type = event.target.value; updateChild(index, { type, options: OPTION_TYPES.has(type) ? (child.options?.length ? child.options : defaultOptions()) : child.options }) }}>{CHILD_TYPES.map((type) => <option key={type} value={type}>{QUESTION_TYPE_LABELS[type]}</option>)}</select></label><label>Puntaje<input type="number" min="0" step="0.25" value={child.points} onChange={(event) => updateChild(index, { points: event.target.value })} /></label><label className="span-2">Enunciado<textarea value={child.prompt} onChange={(event) => updateChild(index, { prompt: event.target.value })} placeholder="Escribe la subpregunta…" /></label></div>
      <AnswerConfiguration question={child} onChange={(patch) => updateChild(index, patch)} compact />
      <label className="top-gap-small">Retroalimentación opcional<textarea value={child.explanation || ''} onChange={(event) => updateChild(index, { explanation: event.target.value })} placeholder="Explicación o criterio de corrección." /></label>
    </article>)}</div>
  </div>
}

export default function QuestionEditorModal({ open, questionId, defaultBankId, banks, userId, onClose, onSaved }) {
  const [question, setQuestion] = useState(() => emptyQuestion(defaultBankId))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const activeBanks = useMemo(() => banks.filter((bank) => !bank.is_archived), [banks])

  useEffect(() => {
    if (!open) return
    let active = true
    setError(''); setLoading(Boolean(questionId))
    if (!questionId) {
      setQuestion(emptyQuestion(defaultBankId || activeBanks[0]?.id || ''))
      setLoading(false)
      return () => { active = false }
    }
    getQuestion(questionId).then((data) => active && setQuestion(rowToEditor(data))).catch((err) => active && setError(err.message)).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [open, questionId, defaultBankId, activeBanks])

  const patchQuestion = (patch) => setQuestion((current) => ({ ...current, ...patch }))

  const handleImage = (file) => {
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) return setError('Formato no permitido. Usa JPG, JPEG, PNG o WEBP.')
    if (file.size > MAX_IMAGE_BYTES) return setError('La imagen supera el límite de 10 MB.')
    if (question.mediaPreview) URL.revokeObjectURL(question.mediaPreview)
    patchQuestion({ mediaFile: file, mediaPreview: URL.createObjectURL(file), removeMedia: false })
    setError('')
  }

  const removeImage = () => {
    if (question.mediaPreview) URL.revokeObjectURL(question.mediaPreview)
    patchQuestion({ mediaFile: null, mediaPreview: null, existingMediaUrl: null, removeMedia: true })
  }

  const submit = async () => {
    if (!userId || saving) return
    setSaving(true); setError('')
    try {
      const id = await saveQuestion(question, userId)
      await onSaved?.(id)
      onClose?.()
    } catch (err) {
      setError(err.message || 'No se pudo guardar la pregunta.')
    } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={() => !saving && onClose?.()} title={questionId ? 'Editar pregunta' : 'Nueva pregunta'} description="Configura contenido, clasificación, corrección y material visual." wide footer={<><button className="button secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className="button primary" type="button" onClick={submit} disabled={saving || loading}>{saving ? 'Guardando…' : 'Guardar pregunta'}</button></>}>
    {loading ? <div className="loading-block">Cargando editor…</div> : <div className="question-editor-form">
      {error && <div className="form-alert danger-alert">{error}</div>}
      <div className="form-grid two-cols">
        <label>Banco de preguntas<select value={question.bankId} onChange={(event) => patchQuestion({ bankId: event.target.value })}><option value="">Selecciona un banco</option>{activeBanks.map((bank) => <option value={bank.id} key={bank.id}>{bank.cursos?.name} · {bank.name}</option>)}</select></label>
        <label>Tipo de pregunta<select value={question.type} onChange={(event) => patchQuestion({ type: event.target.value, children: event.target.value === 'case_group' ? question.children : [] })}>{QUESTION_TYPES.map((type) => <option value={type} key={type}>{QUESTION_TYPE_LABELS[type]}</option>)}</select></label>
        <label className="span-2">Enunciado<textarea value={question.prompt} onChange={(event) => patchQuestion({ prompt: event.target.value })} placeholder={question.type === 'case_group' ? 'Describe el caso o escenario que analizará el estudiante…' : 'Escribe la pregunta…'} /></label>
        <label>Unidad<input value={question.unit} onChange={(event) => patchQuestion({ unit: event.target.value })} placeholder="Ej. Unidad 2" /></label>
        <label>Tema<input value={question.topic} onChange={(event) => patchQuestion({ topic: event.target.value })} placeholder="Ej. IPERC" /></label>
        <label>Subtema<input value={question.subtopic} onChange={(event) => patchQuestion({ subtopic: event.target.value })} placeholder="Ej. Valoración del riesgo" /></label>
        <label>Dificultad<select value={question.difficulty} onChange={(event) => patchQuestion({ difficulty: event.target.value })}>{QUESTION_DIFFICULTIES.map((difficulty) => <option value={difficulty} key={difficulty}>{QUESTION_DIFFICULTY_LABELS[difficulty]}</option>)}</select></label>
        {question.type === 'case_group'
          ? <div className="field-status"><span>Puntaje total del caso</span><strong>{(question.children || []).reduce((sum, child) => sum + Number(child.points || 0), 0)}</strong></div>
          : <label>Puntaje<input type="number" min="0" step="0.25" value={question.points} onChange={(event) => patchQuestion({ points: event.target.value })} /></label>}
        <label className="checkbox-label question-active-toggle"><input type="checkbox" checked={question.isActive} onChange={(event) => patchQuestion({ isActive: event.target.checked })} /> Pregunta activa</label>
      </div>

      <section className="editor-subsection">
        <div className="section-label-row"><div><strong>Material visual</strong><span>JPG, JPEG, PNG o WEBP. Máximo 10 MB.</span></div>{(question.mediaPreview || question.existingMediaUrl) && <button type="button" className="icon-text-button danger-text" onClick={removeImage}>Quitar imagen</button>}</div>
        {(question.mediaPreview || question.existingMediaUrl) ? <div className="media-editor-preview"><img src={question.mediaPreview || question.existingMediaUrl} alt="Previsualización de la imagen de la pregunta" loading="lazy" decoding="async" /><label className="button secondary button-small file-button">Reemplazar<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => handleImage(event.target.files?.[0])} /></label></div> : <label className="media-drop-field">Seleccionar imagen<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => handleImage(event.target.files?.[0])} /><span>Úsala para fotografías de riesgos, planos, gráficos, productos, diagramas o casos.</span></label>}
      </section>

      {question.type !== 'case_group' && <AnswerConfiguration question={question} onChange={patchQuestion} />}
      {question.type === 'case_group' && <CaseChildrenEditor question={question} onChange={patchQuestion} />}

      {question.type !== 'case_group' && (
        <section className="editor-subsection">
          <div className="section-label-row">
            <div><strong>Evidencia del estudiante</strong><span>La evidencia puede conservarse para auditoría sin convertir una pregunta automática en corrección manual.</span></div>
          </div>
          {['calculation_evidence', 'attachment'].includes(question.type) ? (
            <div className="field-hint">Este tipo exige evidencia y mantiene revisión docente antes de consolidar su puntaje.</div>
          ) : (
            <label>Modo de evidencia
              <select
                value={question.metadata?.evidenceMode || 'none'}
                onChange={(event) => patchQuestion({ metadata: { ...(question.metadata || {}), evidenceMode: event.target.value } })}
              >
                <option value="none">Sin evidencia</option>
                <option value="informational">Evidencia informativa / auditable</option>
              </select>
              <span className="field-hint">En modo informativo la respuesta conserva su calificación automática y el archivo queda disponible en Evidencias para revisión docente.</span>
            </label>
          )}
        </section>
      )}

      <section className="editor-subsection"><label>Retroalimentación / explicación opcional<textarea value={question.explanation} onChange={(event) => patchQuestion({ explanation: event.target.value })} placeholder="Explica la solución o el criterio que podrá mostrarse cuando el examen lo permita." /></label></section>
    </div>}
  </Modal>
}
