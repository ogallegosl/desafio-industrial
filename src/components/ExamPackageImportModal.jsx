import { useEffect, useState } from 'react'
import Modal from './Modal'
import StatusBadge from './StatusBadge'
import {
  EXAM_PACKAGE_SAMPLE_ZIP,
  EXAM_PACKAGE_TEMPLATE_XLSX,
  analyzeExamPackage,
  executeExamPackageImport,
} from '../services/examPackageImport'

const STAGE_LABELS = {
  course: 'Curso', banks: 'Bancos', questions: 'Preguntas e imágenes', exam: 'Examen', plan: 'Plan de preguntas', done: 'Finalizado',
}

export default function ExamPackageImportModal({ open, userId, settings, onClose, onImported }) {
  const [file, setFile] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    if (!open) return
    setFile(null); setAnalysis(null); setProcessing(false); setProgress(null); setError(''); setSuccess(null)
  }, [open])

  async function chooseFile(nextFile) {
    if (!nextFile) return
    setFile(nextFile); setAnalysis(null); setError(''); setSuccess(null); setProgress(null); setProcessing(true)
    try {
      const result = await analyzeExamPackage(nextFile, {
        timezone: settings?.timezone || 'America/Lima',
        gradeScaleMax: Number(settings?.gradeScaleMax ?? 20),
        passingGrade: Number(settings?.passingGrade ?? 10.5),
      })
      setAnalysis(result)
    } catch (err) {
      setError(err.message || 'No se pudo analizar el paquete.')
      setFile(null)
    } finally { setProcessing(false) }
  }

  async function confirmImport() {
    if (!analysis?.valid || processing || success) return
    setProcessing(true); setError(''); setProgress(null)
    try {
      const result = await executeExamPackageImport(analysis, userId, setProgress)
      setSuccess(result)
      await onImported?.(result)
    } catch (err) {
      setError(err.message || 'No se pudo completar la importación.')
    } finally { setProcessing(false) }
  }

  const canImport = Boolean(analysis?.valid && !processing && !success)

  return (
    <Modal
      open={open}
      wide
      onClose={() => !processing && onClose?.()}
      title="Importar examen completo"
      description="Crea o reutiliza el curso y sus bancos, importa preguntas e imágenes y construye el plan del examen. El resultado siempre queda en Borrador para revisión docente."
      footer={<>
        <button className="button secondary" type="button" disabled={processing} onClick={onClose}>{success ? 'Cerrar' : 'Cancelar'}</button>
        {!success && <button className="button primary" type="button" disabled={!canImport} onClick={confirmImport}>{processing && progress ? 'Importando…' : processing ? 'Analizando…' : 'Crear examen en borrador'}</button>}
      </>}
    >
      <div className="exam-package-import-flow">
        {error && <div className="form-alert danger-alert">{error}</div>}
        {success && <div className="form-alert success-alert"><strong>Examen importado correctamente.</strong> Se creó en Borrador con {success.fixedQuestions} pregunta{success.fixedQuestions === 1 ? '' : 's'} fija{success.fixedQuestions === 1 ? '' : 's'} y {success.randomQuestions} seleccionada{success.randomQuestions === 1 ? '' : 's'} mediante reglas.</div>}

        <section className="import-step-card">
          <div className="import-step-number">1</div>
          <div className="import-step-content">
            <strong>Prepara el paquete</strong>
            <p>Usa la plantilla Excel. Si existen preguntas de fotografía, coloca el Excel y las imágenes dentro de un ZIP; la columna Imagen debe contener el nombre o ruta del archivo.</p>
            <div className="actions inline-actions compact-actions">
              <a className="button secondary button-small" href={EXAM_PACKAGE_TEMPLATE_XLSX} download>Plantilla examen completo</a>
              <a className="button secondary button-small" href={EXAM_PACKAGE_SAMPLE_ZIP} download>Ejemplo ZIP con imágenes</a>
            </div>
          </div>
        </section>

        <section className="import-step-card">
          <div className="import-step-number">2</div>
          <div className="import-step-content">
            <strong>Selecciona el Excel o ZIP</strong>
            <p>Admite XLSX, XLS y ZIP. El ZIP puede contener hasta 500 imágenes JPG, PNG o WEBP; cada imagen puede pesar hasta 10 MB.</p>
            <label className={`import-file-drop${success ? ' disabled' : ''}`}>
              <input type="file" accept=".xlsx,.xls,.zip" disabled={processing || Boolean(success)} onChange={(event) => chooseFile(event.target.files?.[0])} />
              <b>{processing && !progress ? 'Analizando estructura y datos…' : file?.name || 'Seleccionar paquete'}</b>
              <span>{file ? 'Selecciona otro archivo para reemplazarlo y volver a validar.' : 'La validación no modifica la base de datos.'}</span>
            </label>
          </div>
        </section>

        {progress && <section className="import-progress-card" aria-live="polite">
          <div><strong>{STAGE_LABELS[progress.stage] || 'Importación'}</strong><span>{progress.message}</span></div>
          {Number(progress.total) > 0 && <span>{Math.min(progress.current, progress.total)}/{progress.total}</span>}
        </section>}

        {analysis && <section className="import-validation-section">
          <div className="surface-heading import-summary-heading">
            <div><h3>Validación del examen</h3><p>{analysis.sourceName} · {analysis.exam.title || 'Sin título'}</p></div>
            <StatusBadge tone={analysis.valid ? 'success' : 'danger'}>{analysis.valid ? 'Listo para importar' : 'Requiere corrección'}</StatusBadge>
          </div>

          <div className="exam-package-summary-grid">
            <div><span>Curso</span><strong>{analysis.course.code} · {analysis.course.name}</strong><small>{analysis.course.action === 'reuse' ? 'Se reutilizará' : 'Se creará'}</small></div>
            <div><span>Bancos</span><strong>{analysis.banks.length}</strong><small>{analysis.stats.banksCreate} nuevos · {analysis.stats.banksReuse} existentes</small></div>
            <div><span>Preguntas</span><strong>{analysis.stats.totalRows}</strong><small>{analysis.stats.createQuestions} nuevas · {analysis.stats.reuseQuestions} reutilizadas</small></div>
            <div><span>Imágenes</span><strong>{analysis.stats.imageQuestions}</strong><small>Asociadas a preguntas visuales</small></div>
            <div><span>Plan</span><strong>{analysis.exam.targetQuestionCount}</strong><small>{analysis.stats.fixedQuestions} fijas · {analysis.stats.randomQuestions} aleatorias</small></div>
            <div><span>Duración</span><strong>{analysis.exam.durationMinutes} min</strong><small>{analysis.exam.maxAttempts} intento{analysis.exam.maxAttempts === 1 ? '' : 's'}</small></div>
          </div>

          {analysis.warnings.length > 0 && <div className="import-warning-list"><strong>Advertencias</strong>{analysis.warnings.slice(0, 20).map((item, index) => <span key={`${index}-${item}`}>• {item}</span>)}{analysis.warnings.length > 20 && <span>• … y {analysis.warnings.length - 20} advertencias adicionales.</span>}</div>}

          {analysis.errors.length > 0 && <div className="import-error-banner import-error-stack"><div><strong>No se escribirá ningún dato mientras existan errores.</strong><span>Corrige el Excel/ZIP y vuelve a seleccionarlo.</span></div><div className="import-error-list">{analysis.errors.slice(0, 30).map((item, index) => <span key={`${index}-${item}`}>• {item}</span>)}{analysis.errors.length > 30 && <span>• … y {analysis.errors.length - 30} errores adicionales.</span>}</div></div>}

          <div className="table-wrap import-preview-table-wrap">
            <table className="data-table import-preview-table">
              <thead><tr><th>Fila</th><th>ID</th><th>Banco</th><th>Pregunta</th><th>Imagen</th><th>Acción</th><th>Plan</th></tr></thead>
              <tbody>{analysis.questions.slice(0, 100).map((row) => <tr key={`${row.rowNumber}-${row.externalId}`} className={row.isValid ? '' : 'import-row-error'}>
                <td>{row.rowNumber}</td><td><strong>{row.externalId || '—'}</strong></td><td>{row.bankName || '—'}</td>
                <td className="import-question-cell"><span>{row.question.prompt || 'Sin enunciado'}</span>{row.errors.length > 0 && <small>{row.errors.join(' · ')}</small>}</td>
                <td>{row.imageName || '—'}</td><td><StatusBadge tone={row.action === 'reuse' ? 'info' : 'success'}>{row.action === 'reuse' ? 'Reutilizar' : 'Crear'}</StatusBadge></td><td>{row.includeFixed ? `Fija${row.position ? ` #${row.position}` : ''}` : 'Banco'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {analysis.questions.length > 100 && <p className="field-hint">Se muestran las primeras 100 filas; la validación se realizó sobre {analysis.questions.length} preguntas.</p>}
        </section>}
      </div>
    </Modal>
  )
}
