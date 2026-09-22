import { useEffect, useMemo, useState } from 'react'
import { recordAiGradingDecision, requestAiGradingSuggestion } from '../services/aiGrading'

const SUPPORTED_TYPES = new Set(['essay', 'case_group'])

function fmtNumber(value, digits = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-PE', { maximumFractionDigits: digits }).format(n)
}

export default function AiGradingAssistant({
  responseId,
  questionType,
  maxPoints,
  useRubric,
  rubricValid,
  criteria,
  saving = false,
  onApply,
}) {
  const [loading, setLoading] = useState(false)
  const [suggestion, setSuggestion] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setSuggestion(null)
    setError('')
    setNotice('')
  }, [responseId])

  const supported = SUPPORTED_TYPES.has(questionType)
  const canRequest = Boolean(responseId && supported && useRubric && rubricValid && !loading && !saving)

  const requirementMessage = useMemo(() => {
    if (!supported) return 'Esta primera versión de IA corrige desarrollo escrito y casos prácticos con subpreguntas estructuradas. No interpreta imágenes, fotografías ni PDF adjuntos.'
    if (!useRubric) return 'Activa “Usar rúbrica” para que la IA evalúe con criterios docentes explícitos.'
    if (!rubricValid) return `La rúbrica debe estar completa y sumar exactamente ${fmtNumber(maxPoints)} puntos antes de solicitar la sugerencia.`
    return ''
  }, [supported, useRubric, rubricValid, maxPoints])

  const handleRequest = async () => {
    if (!canRequest) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const result = await requestAiGradingSuggestion({
        responseId,
        rubricCriteria: criteria.map((item, index) => ({
          id: item.id,
          name: String(item.name || '').trim(),
          description: String(item.description || '').trim(),
          maxPoints: Number(item.maxPoints),
          position: index + 1,
        })),
      })
      setSuggestion(result)
      setNotice('Sugerencia generada. Revísala antes de incorporarla a la calificación docente.')
    } catch (err) {
      setError(err.message || 'No se pudo generar la sugerencia con IA.')
    } finally {
      setLoading(false)
    }
  }

  const handleApply = () => {
    if (!suggestion) return
    setError('')
    onApply?.(suggestion)
    setSuggestion((current) => current ? { ...current, draftApplied: true } : current)
    setNotice('La sugerencia se copió como borrador. La decisión de uso se registrará únicamente cuando guardes la calificación docente.')
  }

  const handleReject = async () => {
    if (!suggestion) return
    setLoading(true)
    setError('')
    try {
      await recordAiGradingDecision({ suggestionId: suggestion.id, decision: 'rejected' })
      setSuggestion(null)
      setNotice('Sugerencia descartada. La calificación docente no fue modificada.')
    } catch (err) {
      setError(err.message || 'No se pudo descartar la sugerencia de IA.')
    } finally {
      setLoading(false)
    }
  }

  const confidencePct = suggestion?.confidence == null ? null : Math.round(Number(suggestion.confidence) * 100)

  return (
    <section className="manual-content-section">
      <div className="manual-section-label">Asistente de corrección con IA</div>
      <div className="manual-answer-compact">
        <strong>Modo asistido por docente.</strong> La IA propone puntaje y retroalimentación con la rúbrica activa; nunca publica ni guarda una nota por sí sola.
      </div>

      {requirementMessage && <div className="inline-validation">{requirementMessage}</div>}
      {error && <div className="form-alert danger">{error}</div>}
      {notice && <div className="form-alert success">{notice}</div>}

      <div className="manual-actions">
        <button type="button" className="button secondary" disabled={!canRequest} onClick={handleRequest}>
          {loading ? 'Analizando…' : suggestion ? 'Generar nueva sugerencia' : 'Generar sugerencia con IA'}
        </button>
      </div>

      {suggestion && (
        <div className="manual-case-list">
          <div className="manual-case-item">
            <span>Sugerencia IA · confianza {confidencePct == null ? '—' : `${confidencePct}%`}</span>
            <strong>{fmtNumber(suggestion.score)} / {fmtNumber(maxPoints)} pts</strong>
            <p>{suggestion.rationale || 'Sin justificación adicional.'}</p>
          </div>

          {(suggestion.rubricScores || []).map((item, index) => (
            <div className="manual-case-item" key={item.id || index}>
              <span>Criterio {index + 1} · {fmtNumber(item.score)} / {fmtNumber(item.maxPoints)} pts</span>
              <strong>{item.name || `Criterio ${index + 1}`}</strong>
              <p>{item.comment || 'Sin comentario.'}</p>
            </div>
          ))}

          <div className="manual-case-item">
            <span>Borrador de retroalimentación</span>
            <p>{suggestion.feedback || 'Sin retroalimentación propuesta.'}</p>
          </div>

          {suggestion.decision === 'proposed' && !suggestion.draftApplied && (
            <div className="manual-actions">
              <button type="button" className="button secondary" disabled={loading || saving} onClick={handleReject}>Descartar sugerencia</button>
              <button type="button" className="button primary" disabled={loading || saving} onClick={handleApply}>Aplicar como borrador</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
