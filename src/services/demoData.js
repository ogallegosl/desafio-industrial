import { supabase } from './supabaseClient'

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export async function createSafetyDemo() {
  const client = requireClient()
  const { data, error } = await client.rpc('create_safety_demo')
  if (error) throw new Error(error.message || 'No se pudo crear el examen DEMO.')
  return data
}
