import { useEffect, useState } from 'react'
import Modal from './Modal'
import { createQuestionBank, updateQuestionBank } from '../services/questionBankManagement'

export default function QuestionBankEditorModal({ open, bank, courses, userId, onClose, onSaved }) {
  const [form, setForm] = useState({ courseId: '', name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(bank ? {
      courseId: bank.course_id,
      name: bank.name || '',
      description: bank.description || '',
    } : {
      courseId: courses.find((course) => course.is_active)?.id || '',
      name: '',
      description: '',
    })
  }, [open, bank, courses])

  const submit = async () => {
    if (saving) return
    setSaving(true); setError('')
    try {
      if (bank) await updateQuestionBank(bank.id, form)
      else await createQuestionBank(form, userId)
      await onSaved?.(); onClose?.()
    } catch (err) {
      setError(err.message || 'No se pudo guardar el banco.')
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={() => !saving && onClose?.()} title={bank ? 'Editar banco' : 'Nuevo banco de preguntas'} description="Agrupa preguntas por curso antes de clasificarlas por unidad, tema y dificultad." footer={<><button className="button secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className="button primary" type="button" onClick={submit} disabled={saving}>{saving ? 'Guardando…' : 'Guardar banco'}</button></>}>
      {error && <div className="form-alert danger-alert">{error}</div>}
      <div className="form-grid">
        <label>Curso<select value={form.courseId} disabled={Boolean(bank?.questionCount)} onChange={(event) => setForm((v) => ({ ...v, courseId: event.target.value }))}><option value="">Selecciona un curso</option>{courses.filter((course) => course.is_active).map((course) => <option value={course.id} key={course.id}>{course.name}{course.section ? ` · ${course.section}` : ''}</option>)}</select>{Boolean(bank?.questionCount) && <small className="field-hint">El curso queda bloqueado cuando el banco ya contiene preguntas.</small>}</label>
        <label>Nombre del banco<input value={form.name} onChange={(event) => setForm((v) => ({ ...v, name: event.target.value }))} placeholder="Ej. Seguridad · Banco general" /></label>
        <label>Descripción<textarea value={form.description} onChange={(event) => setForm((v) => ({ ...v, description: event.target.value }))} placeholder="Contenido y propósito del banco…" /></label>
      </div>
    </Modal>
  )
}
