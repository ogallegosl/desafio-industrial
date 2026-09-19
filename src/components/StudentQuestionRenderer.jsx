import StudentEvidenceUploader from './StudentEvidenceUploader'

function baseAnswer(value = {}) {
  return {
    answerText: value?.answerText ?? '',
    answerNumeric: value?.answerNumeric ?? '',
    selectedOptionIds: Array.isArray(value?.selectedOptionIds) ? value.selectedOptionIds : [],
    answerPayload: value?.answerPayload && typeof value.answerPayload === 'object' ? value.answerPayload : {},
  }
}

function OptionList({ question, answer, onChange, multiple = false }) {
  const selected = new Set(answer.selectedOptionIds || [])
  const toggle = (id) => {
    if (multiple) {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onChange({ ...answer, selectedOptionIds: [...next] })
    } else {
      onChange({ ...answer, selectedOptionIds: [id] })
    }
  }

  return (
    <div className="student-options" role={multiple ? 'group' : 'radiogroup'} aria-label="Alternativas">
      {(question.options || []).map((option, index) => {
        const checked = selected.has(option.id)
        return (
          <label className={`student-option ${checked ? 'selected' : ''}`} key={option.id}>
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={multiple ? undefined : `question-${question.id}`}
              checked={checked}
              onChange={() => toggle(option.id)}
            />
            <b>{String.fromCharCode(65 + index)}</b>
            <span>{option.content}</span>
          </label>
        )
      })}
    </div>
  )
}

function AnswerFields({ question, answer: rawAnswer, onChange, nested = false, evidence = null, sessionToken = '', onEvidenceChange, disabled = false }) {
  const answer = baseAnswer(rawAnswer)
  const type = question.type

  if (['single_choice', 'image_single_choice'].includes(type)) {
    return <OptionList question={question} answer={answer} onChange={onChange} />
  }
  if (type === 'multiple_choice') {
    return (
      <>
        <p className="question-help">Puedes seleccionar más de una alternativa.</p>
        <OptionList question={question} answer={answer} onChange={onChange} multiple />
      </>
    )
  }
  if (type === 'true_false') {
    const value = answer.answerPayload?.value
    return (
      <div className="student-options true-false-options" role="radiogroup" aria-label="Verdadero o falso">
        {[{ label: 'Verdadero', value: true }, { label: 'Falso', value: false }].map((option) => (
          <label className={`student-option ${value === option.value ? 'selected' : ''}`} key={option.label}>
            <input
              type="radio"
              name={`question-${question.id}`}
              checked={value === option.value}
              onChange={() => onChange({ ...answer, answerPayload: { ...answer.answerPayload, value: option.value } })}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    )
  }
  if (type === 'short_text') {
    return (
      <label className="student-answer-field">
        <span>Respuesta</span>
        <input value={answer.answerText} onChange={(event) => onChange({ ...answer, answerText: event.target.value })} placeholder="Escribe tu respuesta" />
      </label>
    )
  }
  if (['numeric', 'calculation', 'calculation_evidence'].includes(type)) {
    return (
      <div className="student-answer-stack">
        <label className="student-answer-field">
          <span>{type === 'numeric' ? 'Respuesta numérica' : 'Resultado del cálculo'}</span>
          <input
            type="text"
            inputMode="decimal"
            value={answer.answerNumeric}
            onChange={(event) => onChange({ ...answer, answerNumeric: event.target.value })}
            placeholder="Ej. 25.5"
          />
        </label>
        {type === 'calculation_evidence' && !nested && (
          <StudentEvidenceUploader
            questionId={question.id}
            sessionToken={sessionToken}
            evidence={evidence}
            disabled={disabled}
            onEvidenceChange={onEvidenceChange}
          />
        )}
      </div>
    )
  }
  if (['essay', 'image_essay'].includes(type)) {
    return (
      <label className="student-answer-field">
        <span>Desarrolla tu respuesta</span>
        <textarea rows="7" value={answer.answerText} onChange={(event) => onChange({ ...answer, answerText: event.target.value })} placeholder="Escribe tu análisis aquí…" />
      </label>
    )
  }
  if (type === 'attachment') {
    return (
      <StudentEvidenceUploader
        questionId={question.id}
        sessionToken={sessionToken}
        evidence={evidence}
        disabled={disabled}
        onEvidenceChange={onEvidenceChange}
      />
    )
  }

  return (
    <label className="student-answer-field">
      <span>Respuesta</span>
      <textarea rows="5" value={answer.answerText} onChange={(event) => onChange({ ...answer, answerText: event.target.value })} />
    </label>
  )
}

function CaseGroup({ question, answer, onChange }) {
  const children = Array.isArray(question.metadata?.caseSubquestions) ? question.metadata.caseSubquestions : []
  const caseAnswers = answer.answerPayload?.caseAnswers || {}

  const updateChild = (childId, value) => {
    onChange({
      ...answer,
      answerPayload: {
        ...answer.answerPayload,
        caseAnswers: { ...caseAnswers, [childId]: value },
      },
    })
  }

  return (
    <div className="case-student-list">
      {children.map((child, index) => (
        <section className="case-student-item" key={child.id}>
          <div className="case-student-heading">
            <span>Subpregunta {index + 1}</span>
            <strong>{Number(child.points || 0)} pt{Number(child.points || 0) === 1 ? '' : 's'}</strong>
          </div>
          <h3>{child.prompt}</h3>
          {child.mediaUrl && <img className="question-media-image" src={child.mediaUrl} alt={`Imagen de la subpregunta ${index + 1}`} decoding="async" fetchPriority="high" />}
          <AnswerFields question={child} answer={caseAnswers[child.id]} onChange={(value) => updateChild(child.id, value)} nested />
        </section>
      ))}
    </div>
  )
}

export default function StudentQuestionRenderer({ question, answer: rawAnswer, onChange, evidence = null, sessionToken = '', onEvidenceChange, disabled = false }) {
  const answer = baseAnswer(rawAnswer)
  return (
    <article className="question-card">
      <div className="question-meta">
        <span>{question.metadata?.topic || question.metadata?.unit || 'Pregunta'}</span>
        <strong>{question.points} pt{Number(question.points) === 1 ? '' : 's'}</strong>
      </div>
      <h2>{question.prompt}</h2>
      {question.mediaUrl && (
        <div className="question-media">
          <img className="question-media-image" src={question.mediaUrl} alt="Imagen asociada a la pregunta" decoding="async" fetchPriority="high" />
        </div>
      )}
      {question.type === 'case_group'
        ? <CaseGroup question={question} answer={answer} onChange={onChange} />
        : <AnswerFields
            question={question}
            answer={answer}
            onChange={onChange}
            evidence={evidence}
            sessionToken={sessionToken}
            onEvidenceChange={onEvidenceChange}
            disabled={disabled}
          />}
    </article>
  )
}
