export function parseFlexibleNumber(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const raw = String(value).trim().replace(/\s+/g, '')
  if (!raw) return null
  if (raw.includes(',') && raw.includes('.')) return null
  const normalized = raw.includes(',') ? raw.replace(',', '.') : raw
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function isFlexibleNumber(value) {
  return parseFlexibleNumber(value) !== null
}
