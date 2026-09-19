import { supabase, hasSupabaseConfig } from './supabaseClient'

export const DEFAULT_GLOBAL_SETTINGS = Object.freeze({
  id: 1,
  institutionName: 'Universidad Nacional de San Agustín de Arequipa',
  platformName: 'Desafío Industrial',
  platformSubtitle: 'Ingeniería Industrial UNSA',
  logoBucket: null,
  logoPath: null,
  logoUrl: null,
  gradeScaleMax: 20,
  passingGrade: 10.5,
  timezone: 'America/Lima',
  dateFormat: 'DD/MM/YYYY',
  evidenceAllowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  evidenceMaxBytes: 5 * 1024 * 1024,
  updatedAt: null,
})

export const SUPPORTED_EVIDENCE_TYPES = Object.freeze([
  { mime: 'image/jpeg', label: 'JPG / JPEG', extensions: ['.jpg', '.jpeg'] },
  { mime: 'image/png', label: 'PNG', extensions: ['.png'] },
  { mime: 'image/webp', label: 'WEBP', extensions: ['.webp'] },
  { mime: 'application/pdf', label: 'PDF', extensions: ['.pdf'] },
])

const BRANDING_BUCKET = 'branding'
const MAX_LOGO_BYTES = 3 * 1024 * 1024
const LOGO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function requireClient() {
  if (!hasSupabaseConfig || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

function publicLogoUrl(bucket, path) {
  if (!supabase || !bucket || !path) return null
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data?.publicUrl || null
}

function mapSettings(row) {
  if (!row) return { ...DEFAULT_GLOBAL_SETTINGS }
  const allowed = Array.isArray(row.evidence_allowed_mime_types) && row.evidence_allowed_mime_types.length
    ? row.evidence_allowed_mime_types
    : DEFAULT_GLOBAL_SETTINGS.evidenceAllowedMimeTypes
  return {
    id: 1,
    institutionName: row.institution_name || DEFAULT_GLOBAL_SETTINGS.institutionName,
    platformName: row.platform_name || DEFAULT_GLOBAL_SETTINGS.platformName,
    platformSubtitle: row.platform_subtitle || '',
    logoBucket: row.logo_bucket || null,
    logoPath: row.logo_path || null,
    logoUrl: publicLogoUrl(row.logo_bucket, row.logo_path),
    gradeScaleMax: Number(row.grade_scale_max ?? DEFAULT_GLOBAL_SETTINGS.gradeScaleMax),
    passingGrade: Number(row.passing_grade ?? DEFAULT_GLOBAL_SETTINGS.passingGrade),
    timezone: row.timezone || DEFAULT_GLOBAL_SETTINGS.timezone,
    dateFormat: row.date_format || DEFAULT_GLOBAL_SETTINGS.dateFormat,
    evidenceAllowedMimeTypes: allowed,
    evidenceMaxBytes: Number(row.evidence_max_bytes ?? DEFAULT_GLOBAL_SETTINGS.evidenceMaxBytes),
    updatedAt: row.updated_at || null,
  }
}

export async function getGlobalSettings() {
  if (!hasSupabaseConfig || !supabase) return { ...DEFAULT_GLOBAL_SETTINGS }
  const { data, error } = await supabase
    .from('configuracion_global')
    .select('id,institution_name,platform_name,platform_subtitle,logo_bucket,logo_path,grade_scale_max,passing_grade,timezone,date_format,evidence_allowed_mime_types,evidence_max_bytes,updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return mapSettings(data)
}

function normalizePayload(settings) {
  const gradeScaleMax = Number(settings.gradeScaleMax)
  const passingGrade = Number(settings.passingGrade)
  const evidenceMaxBytes = Number(settings.evidenceMaxBytes)
  const allowed = [...new Set((settings.evidenceAllowedMimeTypes || []).filter((mime) => SUPPORTED_EVIDENCE_TYPES.some((item) => item.mime === mime)))]

  if (!String(settings.institutionName || '').trim()) throw new Error('Ingresa el nombre de la institución.')
  if (!String(settings.platformName || '').trim()) throw new Error('Ingresa el nombre de la plataforma.')
  if (!Number.isFinite(gradeScaleMax) || gradeScaleMax <= 0) throw new Error('La escala máxima debe ser mayor que cero.')
  if (!Number.isFinite(passingGrade) || passingGrade < 0 || passingGrade > gradeScaleMax) throw new Error('La nota aprobatoria debe estar dentro de la escala.')
  if (!String(settings.timezone || '').trim()) throw new Error('Selecciona una zona horaria válida.')
  if (!['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(settings.dateFormat)) throw new Error('Selecciona un formato de fecha válido.')
  if (!allowed.length) throw new Error('Selecciona al menos un formato de evidencia.')
  if (!Number.isFinite(evidenceMaxBytes) || evidenceMaxBytes < 1024 * 1024 || evidenceMaxBytes > 50 * 1024 * 1024) {
    throw new Error('El límite de evidencia debe estar entre 1 y 50 MB.')
  }

  return {
    institution_name: String(settings.institutionName).trim(),
    platform_name: String(settings.platformName).trim(),
    platform_subtitle: String(settings.platformSubtitle || '').trim(),
    grade_scale_max: gradeScaleMax,
    passing_grade: passingGrade,
    timezone: String(settings.timezone).trim(),
    date_format: settings.dateFormat,
    evidence_allowed_mime_types: allowed,
    evidence_max_bytes: Math.round(evidenceMaxBytes),
  }
}

export async function updateGlobalSettings(settings) {
  const client = requireClient()
  const payload = normalizePayload(settings)
  const { data, error } = await client
    .from('configuracion_global')
    .update(payload)
    .eq('id', 1)
    .select('id,institution_name,platform_name,platform_subtitle,logo_bucket,logo_path,grade_scale_max,passing_grade,timezone,date_format,evidence_allowed_mime_types,evidence_max_bytes,updated_at')
    .single()
  if (error) throw error
  return mapSettings(data)
}

function sanitizeLogoName(name) {
  const extension = String(name || '').toLowerCase().match(/\.(jpe?g|png|webp)$/)?.[0] || ''
  const base = String(name || 'logo')
    .replace(/\.[^.]+$/, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'logo'
  return `${base}${extension}`
}

export async function uploadGlobalLogo(file, currentSettings) {
  const client = requireClient()
  if (!file) throw new Error('Selecciona una imagen.')
  if (!LOGO_MIME_TYPES.has(file.type)) throw new Error('El logotipo debe ser JPG, PNG o WEBP.')
  if (file.size <= 0 || file.size > MAX_LOGO_BYTES) throw new Error('El logotipo debe pesar como máximo 3 MB.')

  const oldBucket = currentSettings?.logoBucket || null
  const oldPath = currentSettings?.logoPath || null
  const path = `global/${Date.now()}-${sanitizeLogoName(file.name)}`
  const { error: uploadError } = await client.storage.from(BRANDING_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  })
  if (uploadError) throw uploadError

  const { data, error } = await client
    .from('configuracion_global')
    .update({ logo_bucket: BRANDING_BUCKET, logo_path: path })
    .eq('id', 1)
    .select('id,institution_name,platform_name,platform_subtitle,logo_bucket,logo_path,grade_scale_max,passing_grade,timezone,date_format,evidence_allowed_mime_types,evidence_max_bytes,updated_at')
    .single()

  if (error) {
    await client.storage.from(BRANDING_BUCKET).remove([path])
    throw error
  }

  if (oldBucket && oldPath && (oldBucket !== BRANDING_BUCKET || oldPath !== path)) {
    await client.storage.from(oldBucket).remove([oldPath]).catch(() => {})
  }
  return mapSettings(data)
}

export async function removeGlobalLogo(currentSettings) {
  const client = requireClient()
  const oldBucket = currentSettings?.logoBucket || null
  const oldPath = currentSettings?.logoPath || null
  const { data, error } = await client
    .from('configuracion_global')
    .update({ logo_bucket: null, logo_path: null })
    .eq('id', 1)
    .select('id,institution_name,platform_name,platform_subtitle,logo_bucket,logo_path,grade_scale_max,passing_grade,timezone,date_format,evidence_allowed_mime_types,evidence_max_bytes,updated_at')
    .single()
  if (error) throw error
  if (oldBucket && oldPath) await client.storage.from(oldBucket).remove([oldPath]).catch(() => {})
  return mapSettings(data)
}
