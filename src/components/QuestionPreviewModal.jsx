import Modal from './Modal'
import { QUESTION_DIFFICULTY_LABELS, QUESTION_TYPE_LABELS } from '../utils/constants'

function AnswerPreview({ question }) {
  const options = question?.alternativas || []
  if (['single_choice', 'multiple_choice', 'image_single_choice'].includes(question.type)) return <div className="preview-options-list">{options.map((option) => <div className={`preview-answer${option.is_correct ? ' correct' : ''}`} key={option.id || option.option_key}><b>{option.option_key || '•'}</b><span>{option.content}</span>{option.is_correct && <small>Correcta</small>}</div>)}</div>
  if (question.type === 'true_false') return <div className="answer-key-box">Respuesta correcta: <strong>{question.answer_key?.value ? 'Verdadero' : 'Falso'}</strong></div>
  if (question.type === 'short_text') return <div className="answer-key-box">Aceptadas: <strong>{(question.answer_key?.answers || []).join(' · ') || 'Sin definir'}</strong></div>
  if (['numeric', 'calculation', 'calculation_evidence'].includes(question.type)) {
    const mode = question.grading_config?.numericMode || (question.answer_key?.min != null || question.answer_key?.max != null ? 'range' : question.numeric_tolerance != null ? 'tolerance' : 'exact')
    if (mode === 'range') return <div className="answer-key-box">Intervalo aceptado: <strong>{question.answer_key?.min ?? question.grading_config?.min ?? '—'} a {question.answer_key?.max ?? question.grading_config?.max ?? '—'}</strong></div>
    return <div className="answer-key-box">Resultado: <strong>{question.answer_key?.value ?? 'Sin definir'}</strong>{mode === 'tolerance' ? ` · tolerancia ±${question.numeric_tolerance ?? 0}` : ''}</div>
  }
  return <div className="answer-key-box">Corrección manual{question.type === 'attachment' ? ' · requiere archivo del estudiante' : ''}</div>
}

export default function QuestionPreviewModal({ open, question, loading, onClose }) {
  return <Modal open={open} onClose={onClose} title="Previsualización de pregunta" description="Vista docente con la clave de corrección." wide>
    {loading && <div className="loading-block">Cargando pregunta…</div>}
    {!loading && question && <div className="question-preview-full">
      <div className="question-preview-meta"><span>{QUESTION_TYPE_LABELS[question.type] || question.type}</span><span>{QUESTION_DIFFICULTY_LABELS[question.difficulty] || question.difficulty}</span><span>{Number(question.points || 0)} pt{Number(question.points || 0) === 1 ? '' : 's'}</span></div>
      <h3>{question.prompt}</h3>
      {(question.unit || question.topic || question.subtopic) && <p className="taxonomy-line">{[question.unit, question.topic, question.subtopic].filter(Boolean).join(' › ')}</p>}
      {question.mediaUrl && <img className="question-media-preview" src={question.mediaUrl} alt="Material visual de la pregunta" loading="lazy" decoding="async" />}
      <AnswerPreview question={question} />
      {question.explanation && <div className="feedback-box"><strong>Retroalimentación</strong><p>{question.explanation}</p></div>}
      {question.type === 'case_group' && <div className="case-preview-list"><h4>Subpreguntas</h4>{(question.children || []).map((child, index) => <article className="case-preview-item" key={child.id || index}><span>Pregunta {index + 1} · {QUESTION_TYPE_LABELS[child.type] || child.type}</span><strong>{child.prompt}</strong><AnswerPreview question={child} /></article>)}</div>}
    </div>}
  </Modal>
}
