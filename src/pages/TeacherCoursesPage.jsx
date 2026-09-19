import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../contexts/AuthContext'
import { createTeacherCourse, listTeacherCourses, updateTeacherCourse } from '../services/examManagement'

const EMPTY = { name: '', code: '', academicPeriod: '2026-II', section: '', description: '' }

export default function TeacherCoursesPage() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  async function reload() {
    setLoading(true)
    try {
      setCourses(await listTeacherCourses())
    } catch (error) {
      setMessage({ type: 'danger', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  function openNew() {
    setEditingId(null)
    setForm(EMPTY)
    setShowForm(true)
  }

  function openEdit(course) {
    setEditingId(course.id)
    setForm({
      name: course.name || '',
      code: course.code || '',
      academicPeriod: course.academic_period || '',
      section: course.section || '',
      description: course.description || '',
    })
    setShowForm(true)
  }

  async function save(event) {
    event.preventDefault()
    if (!form.name.trim()) {
      setMessage({ type: 'danger', text: 'Ingresa el nombre del curso.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      if (editingId) await updateTeacherCourse(editingId, { ...form, isActive: true })
      else await createTeacherCourse(form, user.id)
      setMessage({ type: 'success', text: editingId ? 'Curso actualizado.' : 'Curso creado correctamente.' })
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY)
      await reload()
    } catch (error) {
      setMessage({ type: 'danger', text: error.message })
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(course) {
    setSaving(true)
    setMessage(null)
    try {
      await updateTeacherCourse(course.id, {
        name: course.name,
        code: course.code,
        academicPeriod: course.academic_period,
        section: course.section,
        description: course.description,
        isActive: !course.is_active,
      })
      setMessage({ type: 'success', text: course.is_active ? 'Curso archivado.' : 'Curso reactivado.' })
      await reload()
    } catch (error) {
      setMessage({ type: 'danger', text: error.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <PageHeader eyebrow="Organización" title="Cursos" description="Los exámenes y bancos se organizan por asignatura y periodo académico." action={<button className="button primary" onClick={openNew}>+ Nuevo curso</button>} />
      {message && <div className={`form-alert ${message.type === 'success' ? 'success' : 'danger'} page-alert`}>{message.text}</div>}

      {showForm && (
        <form className="surface form-section course-form" onSubmit={save}>
          <div className="surface-heading"><div><h2>{editingId ? 'Editar curso' : 'Nuevo curso'}</h2><p>Datos mínimos para crear y organizar evaluaciones.</p></div><button type="button" className="text-button" onClick={() => setShowForm(false)}>Cerrar</button></div>
          <div className="form-grid two-cols">
            <label>Nombre <span className="required-mark">*</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Ingeniería de Seguridad" /></label>
            <label>Código<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SEG-IND" /></label>
            <label>Periodo académico<input value={form.academicPeriod} onChange={(e) => setForm({ ...form, academicPeriod: e.target.value })} placeholder="2026-II" /></label>
            <label>Sección<input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="A" /></label>
            <label className="span-2">Descripción<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div className="form-actions-end"><button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar curso'}</button></div>
        </form>
      )}

      {loading ? <div className="route-loading">Cargando cursos…</div> : courses.length === 0 ? (
        <div className="surface table-state"><strong>Aún no hay cursos.</strong><span>Crea el primero para poder registrar exámenes.</span></div>
      ) : (
        <div className="course-grid">
          {courses.map((course) => (
            <article className="course-card" key={course.id}>
              <div className="course-card-top"><StatusBadge tone={course.is_active ? 'info' : 'dark'}>{course.is_active ? (course.academic_period || 'Activo') : 'Archivado'}</StatusBadge><span className="course-code">{course.code || 'SIN CÓDIGO'}</span></div>
              <h2>{course.name}</h2>
              <div className="course-meta"><span>{course.section ? `Sección ${course.section}` : 'Sin sección'}</span><span>{course.academic_period || 'Sin periodo'}</span></div>
              <div className="course-actions"><button className="button secondary full" onClick={() => openEdit(course)}>Editar</button><button className="text-button" disabled={saving} onClick={() => toggleArchive(course)}>{course.is_active ? 'Archivar' : 'Reactivar'}</button></div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
