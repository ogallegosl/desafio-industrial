import { Link } from 'react-router-dom'

const features = [
  ['Evaluaciones seguras', 'Preguntas y alternativas aleatorias, tiempo controlado y registro de incidencias.'],
  ['Aplicación industrial', 'Casos, cálculos, imágenes y evidencias para cursos de Ingeniería Industrial.'],
  ['Resultados trazables', 'Calificación, analítica, reportes y comprobantes individuales por estudiante.'],
  ['Flexible', 'Funciona en computadora, tablet y celular con distintos tipos de preguntas.'],
]

export default function HomePage() {
  return (
    <>
      <section className="hero industrial-home-hero">
        <div className="hero-copy industrial-hero-copy">
          <p className="eyebrow">Ingeniería Industrial UNSA</p>
          <h1 aria-label="Evaluación universitaria flexible">
            <span>Evaluación</span>
            <span>universitaria</span>
            <span className="industrial-title-accent">flexible</span>
          </h1>
          <p className="hero-lead">Una plataforma para evaluar conocimientos, análisis y aplicación práctica en los distintos campos de la Ingeniería Industrial.</p>
          <div className="actions">
            <Link className="button primary" to="/acceso">Ingreso al examen</Link>
            <Link className="button secondary" to="/docente/login">Acceso docente</Link>
          </div>
          <div className="industrial-home-signature">
            <strong>Desafío Industrial</strong>
            <span>Universidad Nacional de San Agustín de Arequipa</span>
          </div>
        </div>

        <div className="industrial-hero-visual">
          <img src="/branding/hero-industrial-v2.webp" alt="Ingeniero industrial en una planta de producción analizando procesos, calidad, logística y mejora continua" decoding="async" fetchPriority="high" />
        </div>
      </section>

      <section className="feature-grid industrial-feature-grid">
        {features.map(([title, description], index) => (
          <article className="feature-card" key={title}>
            <span className="feature-index">0{index + 1}</span>
            <h3>{title}</h3>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </>
  )
}
