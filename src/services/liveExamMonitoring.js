import { supabase, hasSupabaseConfig } from './supabaseClient'

function ensureClient() {
  if (!hasSupabaseConfig || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

function fail(error, fallback) {
  throw new Error(error?.message || fallback)
}

export async function getLiveExamMonitor(examId) {
  const client = ensureClient()
  const { data, error } = await client.rpc('get_exam_live_monitor', { p_exam_id: examId })
  if (error) fail(error, 'No se pudo cargar el monitoreo en vivo.')
  return data || { exam: {}, summary: {}, attempts: [], serverNow: new Date().toISOString() }
}

export async function setExamAdmissions(examId, accept) {
  const client = ensureClient()
  const { data, error } = await client.rpc('set_exam_accept_new_attempts', { p_exam_id: examId, p_accept: Boolean(accept) })
  if (error) fail(error, 'No se pudo cambiar el estado de ingreso.')
  return data
}

export async function extendAttemptTime(attemptId, minutes) {
  const client = ensureClient()
  const { data, error } = await client.rpc('teacher_extend_attempt_time', { p_attempt_id: attemptId, p_minutes: Number(minutes) })
  if (error) fail(error, 'No se pudo ampliar el tiempo del estudiante.')
  return data
}

export async function extendExamTime(examId, minutes) {
  const client = ensureClient()
  const { data, error } = await client.rpc('teacher_extend_exam_time', { p_exam_id: examId, p_minutes: Number(minutes) })
  if (error) fail(error, 'No se pudo ampliar el tiempo del examen.')
  return data
}

export async function forceSubmitAttempt(attemptId, reason = '') {
  const client = ensureClient()
  const { data, error } = await client.rpc('teacher_force_submit_attempt', { p_attempt_id: attemptId, p_reason: reason || null })
  if (error) fail(error, 'No se pudo finalizar el intento.')
  return data
}

export async function forceCloseExam(examId, reason = '') {
  const client = ensureClient()
  const { data, error } = await client.rpc('teacher_force_close_exam', { p_exam_id: examId, p_reason: reason || null })
  if (error) fail(error, 'No se pudo finalizar el examen para todos.')
  return data
}

export function subscribeLiveExam(examId, onChange, onStatus = () => {}) {
  const client = ensureClient()
  const channel = client
    .channel(`live-exam-${examId}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'intentos', filter: `exam_id=eq.${examId}` }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs', filter: `exam_id=eq.${examId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'examenes', filter: `id=eq.${examId}` }, onChange)
    .subscribe((status) => onStatus(status))

  return () => {
    client.removeChannel(channel)
  }
}
