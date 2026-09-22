import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [examFilter, setExamFilter] = useState(() => searchParams.get('exam') || '')
  const [statusFilter, setStatusFilter] = useState('all')

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

  const exams = useMemo(() => {
    const map = new Map()
    items.forEach((item) => { if (item.exam?.id) map.set(item.exam.id, item.exam.title || 'Examen') })
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [items])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return items.filter((item) => {
      if (examFilter && item.exam?.id !== examFilter) return false
      const reviewStatus = item.response?.review_status || 'not_required'
      if (statusFilter === 'pending' && reviewStatus !== 'pending') return false
      if (statusFilter === 'reviewed' && reviewStatus !== 'reviewed') return false
      if (statusFilter === 'automatic' && reviewStatus !== 'not_required') return false
      if (!term) return true
      const haystack = [
        studentName(item.student), item.exam?.title,
        item.question?.prompt_snapshot, item.original_filename,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [items, query, examFilter, statusFilter])

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
        description="Archivos adjuntados en intentos ya enviados. La evidencia permanece visible para auditoría aunque la pregunta haya sido calificada automáticamente."
      />

      {message && <div className="form-alert danger">{message}</div>}

      <div className="review-layout">
        <section className="surface review-list">
          <div className="surface-heading evidence-list-heading">
            <div><h2>{loading ? 'Cargando…' : `${filtered.length} evidencia${filtered.length === 1 ? '' : 's'}`}</h2><p>Solo se muestran intentos entregados o vencidos.</p></div>
          </div>
          <div className="evidence-search">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar alumno, examen o archivo" />
            <select value={examFilter} onChange={(event) => setExamFilter(event.target.value)} aria-label="Filtrar por examen">
              <option value="">Todos los exámenes</option>
              {exams.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por revisión">
              <option value="all">Todos los estados</option>
              <option value="pending">Pendiente de revisión</option>
              <option value="reviewed">Revisada</option>
              <option value="automatic">Automática / informativa</option>
            </select>
          </div>

          {!loading && filtered.length === 0 && <div className="empty-review-copy">No hay evidencias enviadas que coincidan con la búsqueda.</div>}
          {filtered.map((item) => (
            <button key={item.id} type="button" className={`review-item ${item.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
              <div>
                <strong>{studentName(item.student)}</strong>
                <span>Pregunta {item.question?.display_order || '—'} · {item.exam?.title || 'Examen'}</span>
                <small>{item.original_filename}</small>
              </div>
              <div>
                <StatusBadge tone={item.response?.review_status === 'pending' ? 'warning' : item.response?.review_status === 'reviewed' ? 'success' : 'neutral'}>
                  {item.response?.review_status === 'pending' ? 'Pendiente' : item.response?.review_status === 'reviewed' ? 'Revisada' : 'Automática'}
                </StatusBadge>
                <small>{item.mime_type === 'application/pdf' ? 'PDF' : 'Imagen'} · {formatBytes(item.size_bytes)}</small>
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
                <StatusBadge tone={selected.response?.review_status === 'pending' ? 'warning' : selected.response?.review_status === 'reviewed' ? 'success' : 'neutral'}>
                  {selected.response?.review_status === 'pending' ? 'Pendiente' : selected.response?.review_status === 'reviewed' ? 'Revisada' : 'Evidencia informativa'}
                </StatusBadge>
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
                <div><span>Puntaje automático</span><strong>{selected.response?.auto_score == null ? '—' : selected.response.auto_score}</strong></div>
                <div><span>Puntaje manual</span><strong>{selected.response?.manual_score == null ? '—' : selected.response.manual_score}</strong></div>
              </div>

              <div className="evidence-teacher-actions">
                {previewUrl && <a className="button secondary" href={previewUrl} target="_blank" rel="noreferrer">Abrir archivo</a>}
                {['pending', 'reviewed'].includes(selected.response?.review_status) && <Link className="button primary" to={`/docente/calificacion?response=${selected.response_id}`}>Calificar respuesta</Link>}
                <span className="muted-copy">{['pending', 'reviewed'].includes(selected.response?.review_status) ? 'La revisión docente puede confirmar o sustituir el puntaje preliminar.' : 'Esta evidencia es auditable y no modifica por sí sola la calificación automática.'}</span>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  )
}
