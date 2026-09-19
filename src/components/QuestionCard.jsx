export default function QuestionCard({ number, points, title, children, media }) {
  return (
    <article className="question-card">
      <div className="question-meta">
        <span>Pregunta {number}</span>
        <span>{points} {points === 1 ? 'punto' : 'puntos'}</span>
      </div>
      <h2>{title}</h2>
      {media && <div className="question-media">{media}</div>}
      <div className="question-body">{children}</div>
    </article>
  )
}
