export default function ExamProgress({ current, total }) {
  const safeTotal = Math.max(1, Number(total) || 1)
  const safeCurrent = Math.min(safeTotal, Math.max(0, Number(current) || 0))
  const percent = Math.round((safeCurrent / safeTotal) * 100)
  return (
    <div className="exam-progress" aria-label={`Pregunta ${safeCurrent} de ${safeTotal}`}>
      <div className="progress-copy">
        <strong>Pregunta {safeCurrent} de {safeTotal}</strong>
        <span>{percent}%</span>
      </div>
      <div className="progress-track" role="progressbar" aria-label="Progreso del examen" aria-valuemin="0" aria-valuemax={safeTotal} aria-valuenow={safeCurrent} aria-valuetext={`${percent}% completado en navegación`}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
