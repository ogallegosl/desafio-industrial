function safeTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return timezone
  } catch {
    return 'America/Lima'
  }
}

function partsFor(value, timezone, includeTime = false) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const options = {
    timeZone: safeTimeZone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }
  if (includeTime) {
    options.hour = '2-digit'
    options.minute = '2-digit'
    options.hourCycle = 'h23'
  }
  const entries = new Intl.DateTimeFormat('en-GB', options).formatToParts(date)
  return Object.fromEntries(entries.filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]))
}

export function formatDateWithSettings(value, settings = {}) {
  const parts = partsFor(value, settings.timezone || 'America/Lima', false)
  if (!parts) return '—'
  switch (settings.dateFormat) {
    case 'MM/DD/YYYY': return `${parts.month}/${parts.day}/${parts.year}`
    case 'YYYY-MM-DD': return `${parts.year}-${parts.month}-${parts.day}`
    default: return `${parts.day}/${parts.month}/${parts.year}`
  }
}

export function formatDateTimeWithSettings(value, settings = {}) {
  const parts = partsFor(value, settings.timezone || 'America/Lima', true)
  if (!parts) return '—'
  const date = settings.dateFormat === 'MM/DD/YYYY'
    ? `${parts.month}/${parts.day}/${parts.year}`
    : settings.dateFormat === 'YYYY-MM-DD'
      ? `${parts.year}-${parts.month}-${parts.day}`
      : `${parts.day}/${parts.month}/${parts.year}`
  return `${date} ${parts.hour}:${parts.minute}`
}

export function toZonedInputParts(value, timezone = 'America/Lima') {
  const parts = partsFor(value, timezone, true)
  if (!parts) return { date: '', time: '' }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

function timezoneOffsetMs(date, timezone) {
  const parts = partsFor(date, timezone, true)
  if (!parts) return 0
  const wallAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), 0, 0,
  )
  const roundedInstant = Math.floor(date.getTime() / 60000) * 60000
  return wallAsUtc - roundedInstant
}

export function zonedLocalToIso(dateText, timeText, timezone = 'America/Lima') {
  if (!dateText || !timeText) return null
  const [year, month, day] = String(dateText).split('-').map(Number)
  const [hour, minute] = String(timeText).split(':').map(Number)
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null

  const tz = safeTimeZone(timezone)
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  let guess = new Date(wallUtc)
  let offset = timezoneOffsetMs(guess, tz)
  guess = new Date(wallUtc - offset)
  const correctedOffset = timezoneOffsetMs(guess, tz)
  if (correctedOffset !== offset) guess = new Date(wallUtc - correctedOffset)

  const verification = partsFor(guess, tz, true)
  if (!verification
      || Number(verification.year) !== year
      || Number(verification.month) !== month
      || Number(verification.day) !== day
      || Number(verification.hour) !== hour
      || Number(verification.minute) !== minute) return null
  return guess.toISOString()
}

export function datetimeLocalToZonedIso(value, timezone = 'America/Lima') {
  if (!value) return null
  const [date, time] = String(value).split('T')
  return zonedLocalToIso(date, time, timezone)
}

export function toZonedDatetimeLocal(value, timezone = 'America/Lima') {
  const parts = toZonedInputParts(value, timezone)
  return parts.date && parts.time ? `${parts.date}T${parts.time}` : ''
}
