export default function ExamTimer({ value = '--:--', warning = false, critical = false }) {
  return (
    <div className={`exam-timer ${warning ? 'timer-warning' : ''} ${critical ? 'timer-critical' : ''}`} role="timer" aria-live={critical ? 'assertive' : 'off'}>
      <span>Tiempo restante</span>
      <strong>{value}</strong>
    </div>
  )
}
