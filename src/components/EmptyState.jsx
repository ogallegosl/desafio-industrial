export default function EmptyState({ title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-symbol" aria-hidden="true">+</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}
