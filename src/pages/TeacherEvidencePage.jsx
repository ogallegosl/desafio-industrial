import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { createEvidencePreviewUrl, listSubmittedEvidence } from '../services/evidenceManagement'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'

function studentName(student) {
  if (!student) return 'Estudiante'
  return `${student.last_name || ''} ${student.first_name || ''}`.trim() || 'Estudiante'
}

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export default function TeacherEvidencePage() {
  const { formatDateTime } = useGlobalSettings()
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setMessage('')
      try {
        const data = await listSubmittedEvidence()
        if (cancelled) return
        setItems(data)
        setSelectedId(data[0]?.id || null)
      } catch (error) {
        if (!cancelled) setMessage(error.message || 'No se pudieron cargar las evidencias.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return items
    return items.filter((item) => {
      const haystack = [
        studentName(item.student), item.exam?.title,
        item.question?.prompt_snapshot, item.original_filename,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [items, query])

  const selected = items.find((item) => item.id === selectedId) || null

  useEffect(() => {
    let cancelled = false
    setPreviewUrl(null)
    if (!selected) return undefined
    setPreviewLoading(true)
    createEvidencePreviewUrl(selected)
      .then((url) => { if (!cancelled) setPreviewUrl(url) })
      .catch((error) => { if (!cancelled) setMessage(error.message || 'No se pudo abrir la evidencia.') })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [selected])

  return (
    <section>
      <PageHeader
        eyebrow="Corrección manual"
        title="Evidencias"
        description="Archivos adjuntados en intentos ya enviados. Los archivos permanecen privados y se abren mediante enlaces temporales."
      />

      {message && <div className="form-alert danger">{message}</div>}

      <div className="review-layout">
        <section className="surface review-list">
          <div className="surface-heading evidence-list-heading">
            <div><h2>{loading ? 'Cargando…' : `${filtered.length} evidencia${filtered.length === 1 ? '' : 's'}`}</h2><p>Solo se muestran intentos entregados o vencidos.</p></div>
          </div>
          <div className="evidence-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar alumno, examen o archivo" /></div>

          {!loading && filtered.length === 0 && <div className="empty-review-copy">No hay evidencias enviadas que coincidan con la búsqueda.</div>}
          {filtered.map((item) => (
            <button key={item.id} type="button" className={`review-item ${item.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
              <div>
                <strong>{studentName(item.student)}</strong>
                <span>Pregunta {item.question?.display_order || '—'} · {item.exam?.title || 'Examen'}</span>
                <small>{item.original_filename}</small>
              </div>
              <div>
                <StatusBadge tone="neutral">{item.mime_type === 'application/pdf' ? 'PDF' : 'Imagen'}</StatusBadge>
                <small>{formatBytes(item.size_bytes)}</small>
              </div>
            </button>
          ))}
        </section>

        <section className="surface evidence-preview teacher-evidence-detail">
          {!selected ? (
            <div className="empty-review-copy large">Selecciona una evidencia para revisarla.</div>
          ) : (
            <>
              <div className="surface-heading">
                <div>
                  <h2>Pregunta {selected.question?.display_order || '—'}</h2>
                  <p>{studentName(selected.student)} · intento {selected.attempt?.attempt_number || 1}</p>
                </div>
                <StatusBadge tone="neutral">{selected.mime_type === 'application/pdf' ? 'PDF' : 'Imagen'}</StatusBadge>
              </div>

              <div className="teacher-evidence-question">
                <span>Enunciado</span>
                <strong>{selected.question?.prompt_snapshot || 'Pregunta sin enunciado disponible'}</strong>
                <p>{selected.exam?.title || 'Examen'} · {Number(selected.question?.points_snapshot || 0)} pts</p>
              </div>

              <div className="teacher-evidence-viewer">
                {previewLoading && <span>Generando vista segura…</span>}
                {!previewLoading && previewUrl && selected.mime_type?.startsWith('image/') && <img src={previewUrl} alt={`Evidencia de ${studentName(selected.student)}`} loading="lazy" decoding="async" />}
                {!previewLoading && previewUrl && selected.mime_type === 'application/pdf' && <iframe src={previewUrl} title={`Evidencia ${selected.original_filename}`} />}
                {!previewLoading && !previewUrl && <span>No se pudo generar la vista previa.</span>}
              </div>

              <div className="evidence-detail-grid">
                <div><span>Archivo</span><strong>{selected.original_filename}</strong></div>
                <div><span>Tamaño</span><strong>{formatBytes(selected.size_bytes)}</strong></div>
                <div><span>Subido</span><strong>{formatDateTime(selected.uploaded_at)}</strong></div>
                <div><span>Entrega</span><strong>{formatDateTime(selected.attempt?.submitted_at)}</strong></div>
              </div>

              <div className="evidence-teacher-actions">
                {previewUrl && <a className="button secondary" href={previewUrl} target="_blank" rel="noreferrer">Abrir archivo</a>}
                <Link className="button primary" to={`/docente/calificacion?response=${selected.response_id}`}>Calificar respuesta</Link>
                <span className="muted-copy">La calificación manual sustituye el puntaje automático preliminar de esta pregunta.</span>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  )
}
