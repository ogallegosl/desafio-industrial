import { supabase, hasSupabaseConfig } from './supabaseClient'
import {
  demoAccessResults,
  demoDeleteEvidence,
  demoFinalizeEvidence,
  demoGetStatus,
  demoLoadEngine,
  demoNavigate,
  demoPing,
  demoPrepareAttempt,
  demoPrepareEvidence,
  demoRecordSecurityEvent,
  demoRecoverTimedOutAnswers,
  demoSaveAnswer,
  demoStartAttempt,
  demoSubmit,
  demoUploadEvidence,
  demoValidateCode,
  demoValidateResultsCode,
  isLocalDemoCode,
  isLocalDemoSession,
} from './localDemoExam'

async function invokeExamAccess(body) {
  if (!hasSupabaseConfig || !supabase) {
    const error = new Error('La conexión con Supabase todavía no está configurada.')
    error.code = 'SUPABASE_NOT_CONFIGURED'
    throw error
  }

  const { data, error } = await supabase.functions.invoke('exam-access', { body })

  if (error) {
    let payload = null
    try {
      if (error.context?.json) payload = await error.context.json()
    } catch {
      payload = null
    }
    const appError = new Error(payload?.message || error.message || 'No se pudo procesar la solicitud.')
    appError.code = payload?.code || 'FUNCTION_ERROR'
    appError.details = payload?.details || null
    throw appError
  }

  if (!data?.ok) {
    const appError = new Error(data?.message || 'No se pudo procesar la solicitud.')
    appError.code = data?.code || 'FUNCTION_ERROR'
    appError.details = data?.details || null
    throw appError
  }

  return data
}

export function validateExamCode(accessCode, recoveryAttemptId = null) {
  if (isLocalDemoCode(accessCode)) return demoValidateCode()
  return invokeExamAccess({ action: 'validate', accessCode, recoveryAttemptId })
}

export function validateExamResultsCode(accessCode) {
  if (isLocalDemoCode(accessCode)) return demoValidateResultsCode()
  return invokeExamAccess({ action: 'validate_results', accessCode })
}

export function accessStudentResults(accessCode, identity, resultAccessCode = '') {
  if (isLocalDemoCode(accessCode)) return demoAccessResults(identity)
  return invokeExamAccess({ action: 'result_access', accessCode, identity, resultAccessCode })
}

export function prepareStudentAttempt(accessCode, identity, recoveryAttemptId = null) {
  if (isLocalDemoCode(accessCode)) return demoPrepareAttempt(identity)
  return invokeExamAccess({ action: 'prepare', accessCode, identity, recoveryAttemptId })
}

export function getStudentAttemptStatus(sessionToken, resultAccess = false, resultAccessCode = '') {
  if (isLocalDemoSession(sessionToken)) return demoGetStatus(sessionToken)
  return invokeExamAccess({
    action: 'status',
    sessionToken,
    resultAccess: Boolean(resultAccess),
    resultAccessCode: String(resultAccessCode || '').trim(),
  })
}

export function startStudentAttempt(sessionToken) {
  if (isLocalDemoSession(sessionToken)) return demoStartAttempt(sessionToken)
  return invokeExamAccess({ action: 'start', sessionToken })
}

export function loadStudentExamEngine(sessionToken) {
  if (isLocalDemoSession(sessionToken)) return demoLoadEngine(sessionToken)
  return invokeExamAccess({ action: 'engine', sessionToken })
}

export function saveStudentAnswer(sessionToken, answer) {
  if (isLocalDemoSession(sessionToken)) return demoSaveAnswer(sessionToken, answer)
  return invokeExamAccess({ action: 'save_answer', sessionToken, answer })
}

export function recoverTimedOutStudentAnswers(sessionToken, answers) {
  if (isLocalDemoSession(sessionToken)) return demoRecoverTimedOutAnswers(sessionToken, answers)
  return invokeExamAccess({ action: 'timeout_recover', sessionToken, answers })
}

export function saveStudentNavigation(sessionToken, targetOrder) {
  if (isLocalDemoSession(sessionToken)) return demoNavigate(sessionToken, targetOrder)
  return invokeExamAccess({ action: 'navigate', sessionToken, targetOrder })
}

export function pingStudentAttempt(sessionToken) {
  if (isLocalDemoSession(sessionToken)) return demoPing(sessionToken)
  return invokeExamAccess({ action: 'ping', sessionToken })
}

export function submitStudentAttempt(sessionToken, reason = 'STUDENT_SUBMITTED') {
  if (isLocalDemoSession(sessionToken)) return demoSubmit(sessionToken, reason)
  return invokeExamAccess({ action: 'submit', sessionToken, reason })
}

export function prepareStudentEvidence(sessionToken, file) {
  if (isLocalDemoSession(sessionToken)) return demoPrepareEvidence(sessionToken, file)
  return invokeExamAccess({ action: 'prepare_evidence', sessionToken, file })
}

export async function uploadStudentEvidenceToSignedUrl(upload, file) {
  if (upload?.bucket === 'local-demo') return demoUploadEvidence(upload, file)
  if (!hasSupabaseConfig || !supabase) {
    const error = new Error('La conexión con Supabase todavía no está configurada.')
    error.code = 'SUPABASE_NOT_CONFIGURED'
    throw error
  }
  const { data, error } = await supabase.storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return data
}

export function finalizeStudentEvidence(sessionToken, uploadId) {
  if (isLocalDemoSession(sessionToken)) return demoFinalizeEvidence(sessionToken, uploadId)
  return invokeExamAccess({ action: 'finalize_evidence', sessionToken, uploadId })
}

export function deleteStudentEvidence(sessionToken, evidenceId) {
  if (isLocalDemoSession(sessionToken)) return demoDeleteEvidence(sessionToken, evidenceId)
  return invokeExamAccess({ action: 'delete_evidence', sessionToken, evidenceId })
}

export function recordStudentSecurityEvent(sessionToken, event) {
  if (isLocalDemoSession(sessionToken)) return demoRecordSecurityEvent(sessionToken, event)
  return invokeExamAccess({ action: 'security_event', sessionToken, event })
}
