import { useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteStudentEvidence,
  finalizeStudentEvidence,
  prepareStudentEvidence,
  uploadStudentEvidenceToSignedUrl,
} from '../services/studentExamAccess'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'
import { isLocalDemoSession } from '../services/localDemoExam'
import { SUPPORTED_EVIDENCE_TYPES } from '../services/globalSettingsManagement'
import { compressEvidenceImage, videoFrameToFile } from '../utils/imageCompression'

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function pauseExamSecurity() { window.dispatchEvent(new Event('exam-security-pause')) }
function resumeExamSecurity() { window.setTimeout(() => window.dispatchEvent(new Event('exam-security-resume')), 250) }

export default function StudentEvidenceUploader({ questionId, sessionToken, evidence, disabled = false, onEvidenceChange }) {
  const { settings } = useGlobalSettings()
  const localDemo = isLocalDemoSession(sessionToken)
  const [candidate, setCandidate] = useState(null)
  const [candidateUrl, setCandidateUrl] = useState(null)
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraStream, setCameraStream] = useState(null)
  const fileInputRef = useRef(null)
  const fallbackCameraInputRef = useRef(null)
  const videoRef = useRef(null)
  const operationGuardRef = useRef(false)

  const allowedMimes = settings.evidenceAllowedMimeTypes || []
  const allowedSet = useMemo(() => new Set(allowedMimes), [allowedMimes])
  const maxBytes = Math.min(Number(settings.evidenceMaxBytes || 5 * 1024 * 1024), 5 * 1024 * 1024)
  const maxMb = Math.round((maxBytes / 1024 / 1024) * 10) / 10
  const allowedLabels = SUPPORTED_EVIDENCE_TYPES.filter((item) => allowedSet.has(item.mime)).map((item) => item.label).join(', ')
  const accept = allowedMimes.join(',')
  const imageAllowed = allowedMimes.some((mime) => mime.startsWith('image/'))
  const isImageCandidate = useMemo(() => candidate?.type?.startsWith('image/'), [candidate])
  const isImageEvidence = evidence?.mimeType?.startsWith('image/')

  useEffect(() => {
    if (!candidate) { setCandidateUrl(null); return undefined }
    const url = URL.createObjectURL(candidate)
    setCandidateUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [candidate])

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream
  }, [cameraStream, cameraOpen])

  useEffect(() => () => cameraStream?.getTracks?.().forEach((track) => track.stop()), [cameraStream])

  const choose = async (rawFile) => {
    setMessage('')
    if (!rawFile) return
    try {
      setStatus('optimizing')
      const file = rawFile.type?.startsWith('image/') ? await compressEvidenceImage(rawFile) : rawFile
      if (!allowedSet.has(file.type)) throw new Error(`Formato no permitido. Usa: ${allowedLabels || 'los formatos habilitados'}.`)
      if (file.size <= 0 || file.size > maxBytes) throw new Error(`El archivo debe pesar como máximo ${maxMb} MB.`)
      setCandidate(file)
      if (rawFile.type?.startsWith('image/') && file.size < rawFile.size) setMessage(`Imagen optimizada: ${formatBytes(rawFile.size)} → ${formatBytes(file.size)}.`)
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setMessage(error.message || 'No se pudo preparar la evidencia.')
    } finally {
      resumeExamSecurity()
    }
  }

  const stopCamera = () => {
    cameraStream?.getTracks?.().forEach((track) => track.stop())
    setCameraStream(null)
    setCameraOpen(false)
    resumeExamSecurity()
  }

  const openCamera = async () => {
    setMessage('')
    pauseExamSecurity()
    if (!navigator.mediaDevices?.getUserMedia) {
      fallbackCameraInputRef.current?.click()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      setCameraStream(stream)
      setCameraOpen(true)
    } catch {
      // Desktop browsers may not have a camera or permission may be denied.
      setMessage('No se pudo abrir una cámara. Puedes elegir una imagen desde el equipo.')
      fallbackCameraInputRef.current?.click()
    }
  }

  const capturePhoto = async () => {
    try {
      const file = await videoFrameToFile(videoRef.current, `evidencia-${Date.now()}.jpg`)
      stopCamera()
      await choose(file)
    } catch (error) { setMessage(error.message || 'No se pudo tomar la fotografía.') }
  }

  const upload = async () => {
    if (!candidate || disabled || status === 'uploading' || operationGuardRef.current) return
    if (!navigator.onLine && !localDemo) { setMessage('Necesitas conexión a internet para subir la evidencia.'); return }
    operationGuardRef.current = true
    setStatus('uploading')
    setMessage('')
    try {
      const prepared = await prepareStudentEvidence(sessionToken, { attemptQuestionId: questionId, name: candidate.name, mimeType: candidate.type, sizeBytes: candidate.size })
      await uploadStudentEvidenceToSignedUrl(prepared.upload, candidate)
      const finalized = await finalizeStudentEvidence(sessionToken, prepared.upload.id)
      onEvidenceChange?.(finalized.evidence || null)
      setCandidate(null)
      setStatus('done')
      setMessage('Evidencia guardada correctamente.')
    } catch (error) {
      setStatus('error')
      setMessage(error.message || 'No se pudo subir la evidencia. La evidencia anterior permanece intacta.')
    } finally { operationGuardRef.current = false }
  }

  const remove = async () => {
    if (!evidence?.id || disabled || status === 'uploading' || operationGuardRef.current) return
    if (!navigator.onLine && !localDemo) { setMessage('Necesitas conexión para eliminar una evidencia almacenada.'); return }
    if (!window.confirm('¿Eliminar esta evidencia?')) return
    operationGuardRef.current = true
    setStatus('uploading')
    try { await deleteStudentEvidence(sessionToken, evidence.id); onEvidenceChange?.(null); setStatus('idle'); setMessage('Evidencia eliminada.') }
    catch (error) { setStatus('error'); setMessage(error.message || 'No se pudo eliminar la evidencia.') }
    finally { operationGuardRef.current = false }
  }

  return (
    <section className="student-evidence-uploader" aria-label="Evidencia del procedimiento">
      <div className="evidence-uploader-head"><div><strong>Evidencia del procedimiento</strong><span>{allowedLabels || 'Formatos configurados'} · máximo {maxMb} MB · fotografías optimizadas automáticamente</span></div>{evidence && <span className="evidence-saved-pill">Guardada</span>}</div>

      {cameraOpen && <div className="camera-capture-panel" role="dialog" aria-label="Tomar fotografía">
        <video ref={videoRef} autoPlay playsInline muted />
        <div className="camera-capture-actions"><button className="button primary" type="button" onClick={capturePhoto}>Capturar foto</button><button className="button secondary" type="button" onClick={stopCamera}>Cancelar</button></div>
      </div>}

      {evidence && <div className="student-evidence-current"><div className="student-evidence-preview">{isImageEvidence && evidence.previewUrl ? <img src={evidence.previewUrl} alt="Evidencia adjunta" loading="lazy" decoding="async" /> : <div className="pdf-evidence-card"><strong>{evidence.mimeType === 'application/pdf' ? 'PDF' : 'Archivo'}</strong><span>{evidence.name}</span></div>}</div><div className="student-evidence-meta"><strong>{evidence.name}</strong><span>{formatBytes(evidence.sizeBytes)}</span><div className="evidence-inline-actions">{evidence.previewUrl && <a className="button tertiary compact" href={evidence.previewUrl} target="_blank" rel="noreferrer">Abrir</a>}<button className="button danger ghost compact" type="button" onClick={remove} disabled={disabled || status === 'uploading'}>Eliminar</button></div></div></div>}

      {candidate && <div className="student-evidence-candidate"><div className="student-evidence-preview">{isImageCandidate && candidateUrl ? <img src={candidateUrl} alt="Vista previa" decoding="async" /> : <div className="pdf-evidence-card"><strong>PDF</strong><span>{candidate.name}</span></div>}</div><div className="student-evidence-meta"><strong>{candidate.name}</strong><span>{formatBytes(candidate.size)} · listo para subir</span><div className="evidence-inline-actions"><button className="button primary compact" type="button" onClick={upload} disabled={disabled || status === 'uploading'}>{status === 'uploading' ? 'Subiendo…' : evidence ? 'Reemplazar evidencia' : 'Guardar evidencia'}</button><button className="button tertiary compact" type="button" onClick={() => setCandidate(null)} disabled={status === 'uploading'}>Cancelar</button></div></div></div>}

      {!candidate && !cameraOpen && <div className="evidence-picker-actions"><button className="button secondary compact" type="button" onClick={() => { pauseExamSecurity(); fileInputRef.current?.click() }} disabled={disabled || status === 'uploading'}>{evidence ? 'Elegir archivo para reemplazar' : 'Elegir archivo'}</button>{imageAllowed && <button className="button tertiary compact" type="button" onClick={openCamera} disabled={disabled || status === 'uploading'}>Abrir cámara / tomar foto</button>}</div>}
      <input ref={fileInputRef} className="visually-hidden-input" type="file" accept={accept} onChange={(event) => choose(event.target.files?.[0])} />
      {imageAllowed && <input ref={fallbackCameraInputRef} className="visually-hidden-input" type="file" accept="image/*" capture="environment" onChange={(event) => choose(event.target.files?.[0])} />}
      {message && <div className={`evidence-upload-message ${status === 'error' ? 'error' : ''}`}>{status === 'optimizing' ? 'Optimizando imagen…' : message}</div>}
    </section>
  )
}
