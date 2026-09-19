import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import StatusBadge from './StatusBadge'
import {
  IMPORT_TEMPLATE_CSV,
  IMPORT_TEMPLATE_XLSX,
  downloadImportErrors,
  importValidatedQuestions,
  parseQuestionImportFile,
  validateQuestionImportRows,
} from '../services/questionImport'
import { QUESTION_DIFFICULTY_LABELS, QUESTION_TYPE_LABELS } from '../utils/constants'

const PREVIEW_LIMIT = 100

export default function QuestionsImportModal({ open, banks, defaultBankId, existingQuestions, userId, onClose, onImported }) {
  const activeBanks = useMemo(() => (banks || []).filter((bank) => !bank.is_archived), [banks])
  const [bankId, setBankId] = useState('')
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [validation, setValidation] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const bank = useMemo(() => activeBanks.find((item) => item.id === bankId) || null, [activeBanks, bankId])

  useEffect(() => {
    if (!open) return
    const preferred = activeBanks.some((item) => item.id === defaultBankId) ? defaultBankId : activeBanks[0]?.id || ''
    setBankId(preferred)
    setFile(null)
    setParsed(null)
    setValidation(null)
    setProgress(null)
    setError('')
    setSuccess('')
  // Se reinicia únicamente al abrir; cambios de datos posteriores no deben borrar el resultado de una importación.
  }, [open])

  const resetFile = () => {
    setFile(null); setParsed(null); setValidation(null); setProgress(null); setError(''); setSuccess('')
  }

  const changeBank = (next) => {
    setBankId(next)
    resetFile()
  }

  const chooseFile = async (nextFile) => {
    if (!nextFile) return
    setProcessing(true); setError(''); setSuccess(''); setValidation(null); setParsed(null); setFile(nextFile)
    try {
      if (!bank) throw new Error('Selecciona primero un banco de destino.')
      const nextParsed = await parseQuestionImportFile(nextFile)
      const nextValidation = validateQuestionImportRows(nextParsed.rows, { bank, existingQuestions })
      setParsed(nextParsed)
      setValidation(nextValidation)
    } catch (err) {
      setFile(null)
      setError(err.message || 'No se pudo analizar el archivo.')
    } finally {
      setProcessing(false)
    }
  }

  const confirmImport = async () => {
    if (!validation || processing) return
    if (validation.errorCount > 0) {
      setError('Corrige todas las filas con error antes de confirmar la importación.')
      return
    }
    setProcessing(true); setError(''); setSuccess('')
    try {
      const result = await importValidatedQuestions(validation.rows, userId, setProgress)
      if (result.failures.length) {
        const failed = result.failures[0]
        if (result.imported > 0) await onImported?.(result)
        setFile(null); setParsed(null); setValidation(null)
        throw new Error(`Se importaron ${result.imported} de ${result.total}. Falló la fila ${failed.rowNumber}: ${failed.message}. Vuelve a cargar el archivo para revalidar los IDs.`)
      }
      setSuccess(`${result.imported} pregunta${result.imported === 1 ? '' : 's'} importada${result.imported === 1 ? '' : 's'} correctamente.`)
      await onImported?.(result)
    } catch (err) {
      setError(err.message || 'La importación no pudo completarse.')
    } finally {
      setProcessing(false); setProgress(null)
    }
  }

  const canImport = validation && validation.validCount > 0 && validation.errorCount === 0 && !processing && !success

  return (
    <Modal
      open={open}
      wide
      onClose={() => !processing && onClose?.()}
      title="Importar preguntas"
      description="Carga un archivo Excel o CSV, valida cada fila y revisa la previsualización antes de guardar en el banco."
      footer={<>
        <button className="button secondary" type="button" disabled={processing} onClick={onClose}>{success ? 'Cerrar' : 'Cancelar'}</button>
        {!success && <button className="button primary" type="button" disabled={!canImport} onClick={confirmImport}>{processing && progress ? `Importando ${progress.current}/${progress.total}…` : processing ? 'Procesando…' : `Importar ${validation?.validCount || 0} preguntas`}</button>}
      </>}
    >
      <div className="question-import-flow">
        {error && <div className="form-alert danger-alert">{error}</div>}
        {success && <div className="form-alert success-alert">{success}</div>}

        <section className="import-step-card">
          <div className="import-step-number">1</div>
          <div className="import-step-content">
            <strong>Descarga la plantilla</strong>
            <p>Mantén los encabezados. La hoja Excel incluye ejemplos e instrucciones de llenado.</p>
            <div className="actions inline-actions compact-actions">
              <a className="button secondary button-small" href={IMPORT_TEMPLATE_XLSX} download>Plantilla Excel</a>
              <a className="button secondary button-small" href={IMPORT_TEMPLATE_CSV} download>Plantilla CSV</a>
            </div>
          </div>
        </section>

        <section className="import-step-card">
          <div className="import-step-number">2</div>
          <div className="import-step-content">
            <strong>Selecciona el banco de destino</strong>
            <p>La columna Curso del archivo debe coincidir con el código o nombre del curso de este banco.</p>
            <select value={bankId} onChange={(event) => changeBank(event.target.value)} disabled={processing || Boolean(success)}>
              <option value="">Selecciona un banco</option>
              {activeBanks.map((item) => <option value={item.id} key={item.id}>{item.cursos?.name || 'Curso'} · {item.name}</option>)}
            </select>
          </div>
        </section>

        <section className="import-step-card">
          <div className="import-step-number">3</div>
          <div className="import-step-content">
            <strong>Carga y valida el archivo</strong>
            <p>Formatos admitidos: XLSX, XLS y CSV. Se aceptan hasta 1000 preguntas por importación.</p>
            <label className={`import-file-drop${!bank || success ? ' disabled' : ''}`}>
              <input type="file" accept=".xlsx,.xls,.csv" disabled={!bank || processing || Boolean(success)} onChange={(event) => chooseFile(event.target.files?.[0])} />
              <b>{processing && !progress ? 'Analizando archivo…' : file?.name || 'Seleccionar archivo'}</b>
              <span>{file ? 'Puedes reemplazarlo seleccionando otro archivo.' : 'Haz clic para buscar el Excel o CSV.'}</span>
            </label>
          </div>
        </section>

        {validation && <section className="import-validation-section">
          <div className="surface-heading import-summary-heading">
            <div>
              <h3>Resultado de la validación</h3>
              <p>{parsed?.fileName} · hoja {parsed?.sheetName}</p>
            </div>
            <div className="import-counts">
              <StatusBadge tone="success">{validation.validCount} válidas</StatusBadge>
              <StatusBadge tone={validation.errorCount ? 'danger' : 'neutral'}>{validation.errorCount} con error</StatusBadge>
            </div>
          </div>

          {validation.errorCount > 0 && <div className="import-error-banner">
            <div><strong>No se puede confirmar todavía.</strong><span>Corrige las filas indicadas y vuelve a cargar el archivo.</span></div>
            <button className="text-button" type="button" onClick={() => downloadImportErrors(validation.rows, parsed?.fileName)}>Descargar errores CSV</button>
          </div>}

          <div className="table-wrap import-preview-table-wrap">
            <table className="data-table import-preview-table">
              <thead><tr><th>Fila</th><th>ID</th><th>Pregunta</th><th>Tipo</th><th>Dificultad</th><th>Puntaje</th><th>Estado</th></tr></thead>
              <tbody>
                {validation.rows.slice(0, PREVIEW_LIMIT).map((row) => <tr key={`${row.rowNumber}-${row.externalId}`} className={row.isValid ? '' : 'import-row-error'}>
                  <td>{row.rowNumber}</td>
                  <td><strong>{row.externalId || '—'}</strong></td>
                  <td className="import-question-cell"><span>{row.question.prompt || 'Sin enunciado'}</span>{!row.isValid && <small>{row.errors.join(' · ')}</small>}</td>
                  <td>{QUESTION_TYPE_LABELS[row.question.type] || row.raw?.Tipo || '—'}</td>
                  <td>{QUESTION_DIFFICULTY_LABELS[row.question.difficulty] || '—'}</td>
                  <td>{row.question.points}</td>
                  <td><StatusBadge tone={row.isValid ? 'success' : 'danger'}>{row.isValid ? 'Válida' : 'Error'}</StatusBadge></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {validation.rows.length > PREVIEW_LIMIT && <p className="field-hint">Se muestran las primeras {PREVIEW_LIMIT} de {validation.rows.length} filas. La validación sí se realizó sobre el archivo completo.</p>}
        </section>}
      </div>
    </Modal>
  )
}
