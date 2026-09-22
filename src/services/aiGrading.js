import { supabase, hasSupabaseConfig } from './supabaseClient'

function ensureSupabase() {
  if (!hasSupabaseConfig || !supabase) throw new Error('La conexión con Supabase todavía no está configurada.')
}

function normalizeFunctionError(error, fallback) {
  const message = error?.context?.body?.message || error?.message || fallback
  return new Error(message)
}

export async function requestAiGradingSuggestion({ responseId, rubricCriteria = [] }) {
  ensureSupabase()
  if (!responseId) throw new Error('Selecciona una respuesta antes de solicitar la corrección con IA.')

  const { data, error } = await supabase.functions.invoke('ai-grading', {
    body: {
      action: 'suggest',
      responseId,
      rubricCriteria,
    },
  })

  if (error) throw normalizeFunctionError(error, 'No se pudo obtener la sugerencia de corrección con IA.')
  if (!data?.suggestion) throw new Error(data?.message || 'La IA no devolvió una sugerencia utilizable.')
  return data.suggestion
}

export async function recordAiGradingDecision({ suggestionId, decision }) {
  ensureSupabase()
  if (!suggestionId || !['applied', 'rejected'].includes(decision)) {
    throw new Error('La decisión de la sugerencia de IA no es válida.')
  }

  const { data, error } = await supabase.functions.invoke('ai-grading', {
    body: {
      action: 'decision',
      suggestionId,
      decision,
    },
  })

  if (error) throw normalizeFunctionError(error, 'No se pudo registrar la decisión sobre la sugerencia de IA.')
  return data?.suggestion || null
}
