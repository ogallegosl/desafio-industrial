import { useCallback, useEffect, useMemo, useState } from 'react'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import QuestionBankEditorModal from '../components/QuestionBankEditorModal'
import QuestionEditorModal from '../components/QuestionEditorModal'
import QuestionPreviewModal from '../components/QuestionPreviewModal'
import QuestionsImportModal from '../components/QuestionsImportModal'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../contexts/AuthContext'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'
import { listTeacherCourses } from '../services/examManagement'
import {
  duplicateQuestion,
  getQuestion,
  listQuestionBanks,
  listQuestions,
  setQuestionArchived,
  setQuestionBankArchived,
} from '../services/questionBankManagement'
import { QUESTION_DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, QUESTION_TYPES } from '../utils/constants'

function shortPrompt(text, limit = 110) {
  if (!text) return 'Sin enunciado'
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text
}

export default function TeacherQuestionBanksPage() {
  const { user } = useAuth()
  const { formatDate } = useGlobalSettings()
  const [banks, setBanks] = useState([])
  const [courses, setCourses] = useState([])
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState({ search: '', courseId: '', bankId: '', type: '', difficulty: '', unit: '', topic: '', status: 'active' })
  const [bankModal, setBankModal] = useState({ open: false, bank: null })
  const [questionModal, setQuestionModal] = useState({ open: false, id: null, bankId: '' })
  const [preview, setPreview] = useState({ open: false, loading: false, question: null })
  const [importModalOpen, setImportModalOpen] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [nextBanks, nextCourses, nextQuestions] = await Promise.all([
        listQuestionBanks(),
        listTeacherCourses(),
        listQuestions({ includeArchivedBanks: true }),
      ])
      setBanks(nextBanks); setCourses(nextCourses); setQuestions(nextQuestions)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el banco de preguntas.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 3500)
    return () => clearTimeout(timer)
  }, [notice])

  const filteredBanks = useMemo(() => banks.filter((bank) => !filters.courseId || bank.course_id === filters.courseId), [banks, filters.courseId])
  const units = useMemo(() => [...new Set(questions.map((q) => q.unit).filter(Boolean))].sort(), [questions])
  const topics = useMemo(() => [...new Set(questions.map((q) => q.topic).filter(Boolean))].sort(), [questions])

  const visibleQuestions = useMemo(() => {
    const term = filters.search.trim().toLowerCase()
    return questions.filter((question) => {
      const bank = question.bancos_preguntas
      const course = bank?.cursos
      if (filters.courseId && bank?.course_id !== filters.courseId) return false
      if (filters.bankId && question.bank_id !== filters.bankId) return false
      if (filters.type && question.type !== filters.type) return false
      if (filters.difficulty && question.difficulty !== filters.difficulty) return false
      if (filters.unit && question.unit !== filters.unit) return false
      if (filters.topic && question.topic !== filters.topic) return false
      if (filters.status === 'active' && (!question.is_active || bank?.is_archived)) return false
      if (filters.status === 'archived' && question.is_active && !bank?.is_archived) return false
      if (!term) return true
      return [question.prompt, question.unit, question.topic, question.subtopic, bank?.name, course?.name]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(term))
    })
  }, [questions, filters])

  const stats = useMemo(() => ({
    activeBanks: banks.filter((bank) => !bank.is_archived).length,
    activeQuestions: questions.filter((question) => question.is_active && !question.bancos_preguntas?.is_archived).length,
    visualQuestions: questions.filter((question) => question.media_path || question.metadata?.demoMediaUrl).length,
    cases: questions.filter((question) => question.type === 'case_group').length,
  }), [banks, questions])

  const patchFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value, ...(key === 'courseId' ? { bankId: '' } : {}) }))

  const openPreview = async (id) => {
    setPreview({ open: true, loading: true, question: null })
    try {
      const question = await getQuestion(id)
      setPreview({ open: true, loading: false, question })
    } catch (err) {
      setPreview({ open: false, loading: false, question: null }); setError(err.message)
    }
  }

  const archiveQuestion = async (question) => {
    const archive = question.is_active
    if (archive && !window.confirm('¿Archivar esta pregunta? Dejará de estar disponible para nuevos exámenes.')) return
    setWorking(true); setError('')
    try {
      await setQuestionArchived(question.id, archive)
      setNotice(archive ? 'Pregunta archivada.' : 'Pregunta restaurada.')
      await loadData()
    } catch (err) { setError(err.message) } finally { setWorking(false) }
  }

  const duplicate = async (question) => {
    if (working) return
    setWorking(true); setError('')
    try {
      await duplicateQuestion(question.id, user.id)
      setNotice('Pregunta duplicada. La copia puede editarse de forma independiente.')
      await loadData()
    } catch (err) { setError(err.message) } finally { setWorking(false) }
  }

  const archiveBank = async (bank) => {
    const archive = !bank.is_archived
    if (archive && !window.confirm('¿Archivar este banco? Sus preguntas quedarán fuera de las selecciones activas, pero no se eliminarán.')) return
    setWorking(true); setError('')
    try {
      await setQuestionBankArchived(bank.id, archive)
      setNotice(archive ? 'Banco archivado.' : 'Banco restaurado.')
      await loadData()
    } catch (err) { setError(err.message) } finally { setWorking(false) }
  }

  return (
    <section>
      <PageHeader eyebrow="Contenido" title="Banco de preguntas" description="Crea preguntas reutilizables, clasifícalas por curso y tema, incorpora imágenes y configura su corrección." action={<div className="actions inline-actions"><button className="button secondary" onClick={() => setBankModal({ open: true, bank: null })}>+ Nuevo banco</button><button className="button secondary" onClick={() => setImportModalOpen(true)}>Importar Excel/CSV</button><button className="button primary" onClick={() => setQuestionModal({ open: true, id: null, bankId: filters.bankId })}>+ Nueva pregunta</button></div>} />

      {error && <div className="form-alert danger-alert page-alert">{error}</div>}
      {notice && <div className="form-alert success-alert page-alert">{notice}</div>}

      <div className="question-bank-stats">
        <div><strong>{stats.activeBanks}</strong><span>Bancos activos</span></div>
        <div><strong>{stats.activeQuestions}</strong><span>Preguntas activas</span></div>
        <div><strong>{stats.visualQuestions}</strong><span>Con imagen</span></div>
        <div><strong>{stats.cases}</strong><span>Casos prácticos</span></div>
      </div>

      <section className="surface section-gap">
        <div className="surface-heading"><div><h2>Bancos por curso</h2><p>Los bancos organizan el contenido antes de construir exámenes.</p></div></div>
        {loading ? <div className="loading-block">Cargando bancos…</div> : filteredBanks.length === 0 ? <EmptyState title="Aún no hay bancos" description="Crea el primer banco y luego añade preguntas." action={<button className="button primary" onClick={() => setBankModal({ open: true, bank: null })}>Crear banco</button>} /> : <div className="table-wrap"><table className="data-table question-bank-table"><thead><tr><th>Banco</th><th>Curso</th><th>Preguntas</th><th>Estado</th><th>Actualizado</th><th>Acciones</th></tr></thead><tbody>{filteredBanks.map((bank) => <tr key={bank.id}><td><strong>{bank.name}</strong><span>{bank.description || 'Sin descripción'}</span></td><td>{bank.cursos?.name || '—'}<span>{[bank.cursos?.academic_period, bank.cursos?.section].filter(Boolean).join(' · ')}</span></td><td><StatusBadge tone="neutral">{bank.questionCount}</StatusBadge></td><td><StatusBadge tone={bank.is_archived ? 'dark' : 'success'}>{bank.is_archived ? 'Archivado' : 'Activo'}</StatusBadge></td><td>{formatDate(bank.updated_at)}</td><td><div className="table-actions"><button className="text-button" onClick={() => setFilters((current) => ({ ...current, courseId: bank.course_id, bankId: bank.id }))}>Ver preguntas</button><button className="text-button" onClick={() => setBankModal({ open: true, bank })}>Editar</button><button className="text-button" disabled={working} onClick={() => archiveBank(bank)}>{bank.is_archived ? 'Restaurar' : 'Archivar'}</button></div></td></tr>)}</tbody></table></div>}
      </section>

      <section className="section-gap">
        <div className="surface compact-surface question-filter-panel"><div className="question-filter-grid">
          <input className="search-input" value={filters.search} onChange={(event) => patchFilter('search', event.target.value)} placeholder="Buscar por enunciado, tema o banco…" />
          <select value={filters.courseId} onChange={(event) => patchFilter('courseId', event.target.value)}><option value="">Todos los cursos</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.name}</option>)}</select>
          <select value={filters.bankId} onChange={(event) => patchFilter('bankId', event.target.value)}><option value="">Todos los bancos</option>{filteredBanks.map((bank) => <option value={bank.id} key={bank.id}>{bank.name}</option>)}</select>
          <select value={filters.type} onChange={(event) => patchFilter('type', event.target.value)}><option value="">Todos los tipos</option>{QUESTION_TYPES.map((type) => <option value={type} key={type}>{QUESTION_TYPE_LABELS[type]}</option>)}</select>
          <select value={filters.difficulty} onChange={(event) => patchFilter('difficulty', event.target.value)}><option value="">Toda dificultad</option><option value="basic">Básica</option><option value="intermediate">Intermedia</option><option value="advanced">Avanzada</option></select>
          <select value={filters.unit} onChange={(event) => patchFilter('unit', event.target.value)}><option value="">Todas las unidades</option>{units.map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select>
          <select value={filters.topic} onChange={(event) => patchFilter('topic', event.target.value)}><option value="">Todos los temas</option>{topics.map((topic) => <option value={topic} key={topic}>{topic}</option>)}</select>
          <select value={filters.status} onChange={(event) => patchFilter('status', event.target.value)}><option value="active">Activas</option><option value="archived">Archivadas</option><option value="all">Todas</option></select>
        </div></div>

        <section className="surface section-gap">
          <div className="surface-heading"><div><h2>Preguntas</h2><p>{visibleQuestions.length} resultado{visibleQuestions.length === 1 ? '' : 's'} con los filtros actuales.</p></div><button className="button primary button-small" onClick={() => setQuestionModal({ open: true, id: null, bankId: filters.bankId })}>+ Nueva pregunta</button></div>
          {loading ? <div className="loading-block">Cargando preguntas…</div> : visibleQuestions.length === 0 ? <EmptyState title="No hay preguntas para mostrar" description="Cambia los filtros o crea una nueva pregunta en un banco activo." action={<button className="button primary" onClick={() => setQuestionModal({ open: true, id: null, bankId: filters.bankId })}>Crear pregunta</button>} /> : <div className="table-wrap"><table className="data-table question-table"><thead><tr><th>Pregunta</th><th>Clasificación</th><th>Tipo</th><th>Dificultad</th><th>Puntaje</th><th>Acciones</th></tr></thead><tbody>{visibleQuestions.map((question) => <tr key={question.id}><td className="question-cell"><strong>{shortPrompt(question.prompt)}</strong><span>{question.bancos_preguntas?.name}{(question.media_path || question.metadata?.demoMediaUrl) ? ' · Con imagen' : ''}</span></td><td>{question.topic || question.unit || 'Sin clasificar'}<span>{[question.unit, question.subtopic].filter(Boolean).join(' · ')}</span></td><td><StatusBadge tone="info">{QUESTION_TYPE_LABELS[question.type] || question.type}</StatusBadge></td><td>{QUESTION_DIFFICULTY_LABELS[question.difficulty] || question.difficulty}</td><td>{Number(question.points || 0)}</td><td><div className="table-actions wrap-actions"><button className="text-button" onClick={() => openPreview(question.id)}>Vista previa</button><button className="text-button" onClick={() => setQuestionModal({ open: true, id: question.id, bankId: question.bank_id })}>Editar</button><button className="text-button" disabled={working} onClick={() => duplicate(question)}>Duplicar</button><button className="text-button" disabled={working} onClick={() => archiveQuestion(question)}>{question.is_active ? 'Archivar' : 'Restaurar'}</button></div></td></tr>)}</tbody></table></div>}
        </section>
      </section>

      <QuestionBankEditorModal open={bankModal.open} bank={bankModal.bank} courses={courses} userId={user?.id} onClose={() => setBankModal({ open: false, bank: null })} onSaved={async () => { setNotice(bankModal.bank ? 'Banco actualizado.' : 'Banco creado.'); await loadData() }} />
      <QuestionEditorModal open={questionModal.open} questionId={questionModal.id} defaultBankId={questionModal.bankId} banks={banks} userId={user?.id} onClose={() => setQuestionModal({ open: false, id: null, bankId: '' })} onSaved={async () => { setNotice(questionModal.id ? 'Pregunta actualizada.' : 'Pregunta creada.'); await loadData() }} />
      <QuestionPreviewModal open={preview.open} loading={preview.loading} question={preview.question} onClose={() => setPreview({ open: false, loading: false, question: null })} />
      <QuestionsImportModal open={importModalOpen} banks={banks} defaultBankId={filters.bankId} existingQuestions={questions} userId={user?.id} onClose={() => setImportModalOpen(false)} onImported={async (result) => { setNotice(`${result.imported} pregunta${result.imported === 1 ? '' : 's'} importada${result.imported === 1 ? '' : 's'}.`); await loadData() }} />
    </section>
  )
}
