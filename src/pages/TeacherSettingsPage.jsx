import { useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'
import { SUPPORTED_EVIDENCE_TYPES } from '../services/globalSettingsManagement'
import { formatDateTimeWithSettings } from '../utils/dateFormatting'

const COMMON_TIMEZONES = [
  'America/Lima',
  'America/Bogota',
  'America/Guayaquil',
  'America/Santiago',
  'America/La_Paz',
  'America/Argentina/Buenos_Aires',
  'America/Mexico_City',
  'America/New_York',
  'Europe/Madrid',
  'UTC',
]

function isValidTimezone(value) {
  try {
    new Intl.DateTimeFormat('es-PE', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

function mbFromBytes(bytes) {
  return Math.round((Number(bytes || 0) / 1024 / 1024) * 10) / 10
}

export default function TeacherSettingsPage() {
  const { settings, loading, error: loadError, save, uploadLogo, removeLogo, formatDateTime } = useGlobalSettings()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [logoWorking, setLogoWorking] = useState(false)
  const [message, setMessage] = useState(null)
  const logoInputRef = useRef(null)
  const formInitializedRef = useRef(false)

  useEffect(() => {
    if (loading || formInitializedRef.current) return
    formInitializedRef.current = true
    setForm({
      institutionName: settings.institutionName,
      platformName: settings.platformName,
      platformSubtitle: settings.platformSubtitle,
      gradeScaleMax: settings.gradeScaleMax,
      passingGrade: settings.passingGrade,
      timezone: settings.timezone,
      dateFormat: settings.dateFormat,
      evidenceAllowedMimeTypes: [...settings.evidenceAllowedMimeTypes],
      evidenceMaxMb: mbFromBytes(settings.evidenceMaxBytes),
    })
  }, [loading, settings])

  const previewDate = useMemo(() => formatDateTimeWithSettings(new Date(), { timezone: form?.timezone, dateFormat: form?.dateFormat }), [form?.dateFormat, form?.timezone])

  if (loading && !form) return <div className="loading-block">Cargando configuración global…</div>
  if (!form) return <div className="notice danger">{loadError || 'No se pudo cargar la configuración global.'}</div>

  const patch = (name, value) => setForm((current) => ({ ...current, [name]: value }))

  const toggleMime = (mime) => {
    setForm((current) => {
      const active = current.evidenceAllowedMimeTypes.includes(mime)
      return {
        ...current,
        evidenceAllowedMimeTypes: active
          ? current.evidenceAllowedMimeTypes.filter((item) => item !== mime)
          : [...current.evidenceAllowedMimeTypes, mime],
      }
    })
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setMessage(null)
    if (!isValidTimezone(form.timezone)) {
      setMessage({ type: 'danger', text: 'La zona horaria no es válida. Usa un identificador IANA, por ejemplo America/Lima.' })
      return
    }
    if (!form.evidenceAllowedMimeTypes.length) {
      setMessage({ type: 'danger', text: 'Selecciona al menos un tipo de evidencia permitido.' })
      return
    }
    setSaving(true)
    try {
      await save({
        ...form,
        gradeScaleMax: Number(form.gradeScaleMax),
        passingGrade: Number(form.passingGrade),
        evidenceMaxBytes: Math.round(Number(form.evidenceMaxMb) * 1024 * 1024),
      })
      setMessage({ type: 'success', text: 'Configuración global guardada. Los nuevos exámenes utilizarán estos valores académicos como predeterminados.' })
    } catch (saveError) {
      setMessage({ type: 'danger', text: saveError.message || 'No se pudo guardar la configuración.' })
    } finally {
      setSaving(false)
    }
  }

  const handleLogo = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setLogoWorking(true)
    setMessage(null)
    try {
      await uploadLogo(file)
      setMessage({ type: 'success', text: 'Logotipo actualizado.' })
    } catch (logoError) {
      setMessage({ type: 'danger', text: logoError.message || 'No se pudo actualizar el logotipo.' })
    } finally {
      setLogoWorking(false)
    }
  }

  const handleRemoveLogo = async () => {
    if (!settings.logoUrl || logoWorking) return
    if (!window.confirm('¿Quitar el logotipo institucional de la plataforma?')) return
    setLogoWorking(true)
    setMessage(null)
    try {
      await removeLogo()
      setMessage({ type: 'success', text: 'Logotipo retirado.' })
    } catch (logoError) {
      setMessage({ type: 'danger', text: logoError.message || 'No se pudo retirar el logotipo.' })
    } finally {
      setLogoWorking(false)
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Preferencias"
        title="Configuración global"
        description="Personaliza la identidad institucional, valores académicos predeterminados y reglas generales para evidencias."
      />

      {message && <div className={`notice ${message.type}`}>{message.text}</div>}
      {loadError && <div className="notice warning">Se utilizaron valores locales mientras se recupera la configuración: {loadError}</div>}

      <form className="settings-global-grid" onSubmit={handleSave}>
        <section className="surface form-section settings-span-two">
          <div className="section-label-row">
            <div>
              <h2>Identidad institucional</h2>
              <p className="muted-copy">Estos datos aparecen en la portada, accesos y encabezados de la plataforma.</p>
            </div>
          </div>

          <div className="branding-settings-row">
            <div className="branding-logo-preview">
              {settings.logoUrl
                ? <img src={settings.logoUrl} alt="Logotipo institucional actual" />
                : <div className="branding-logo-placeholder">Sin logotipo</div>}
              <div className="actions compact-actions">
                <input ref={logoInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleLogo} />
                <button className="button secondary compact" type="button" disabled={logoWorking} onClick={() => logoInputRef.current?.click()}>{settings.logoUrl ? 'Reemplazar' : 'Subir logotipo'}</button>
                {settings.logoUrl && <button className="button danger ghost compact" type="button" disabled={logoWorking} onClick={handleRemoveLogo}>Quitar</button>}
              </div>
              <small>JPG, PNG o WEBP · máximo 5 MB.</small>
            </div>

            <div className="form-grid two-columns settings-brand-fields">
              <label>Institución
                <input value={form.institutionName} maxLength={180} required onChange={(event) => patch('institutionName', event.target.value)} placeholder="Universidad / instituto / organización" />
              </label>
              <label>Nombre de la plataforma
                <input value={form.platformName} maxLength={100} required onChange={(event) => patch('platformName', event.target.value)} placeholder="Desafío Industrial" />
              </label>
              <label className="span-two">Subtítulo
                <input value={form.platformSubtitle} maxLength={160} onChange={(event) => patch('platformSubtitle', event.target.value)} placeholder="Ingeniería Industrial" />
              </label>
            </div>
          </div>
        </section>

        <section className="surface form-section">
          <h2>Valores académicos predeterminados</h2>
          <p className="muted-copy">Se aplican al crear nuevos exámenes. Los exámenes existentes conservan su propia configuración.</p>
          <div className="form-grid two-columns">
            <label>Escala máxima
              <input type="number" min="0.1" max="1000" step="0.1" value={form.gradeScaleMax} onChange={(event) => patch('gradeScaleMax', event.target.value)} />
            </label>
            <label>Nota aprobatoria
              <input type="number" min="0" max={form.gradeScaleMax || 20} step="0.1" value={form.passingGrade} onChange={(event) => patch('passingGrade', event.target.value)} />
            </label>
          </div>
        </section>

        <section className="surface form-section">
          <h2>Fecha y zona horaria</h2>
          <div className="stack">
            <label>Zona horaria
              <input list="platform-timezones" value={form.timezone} onChange={(event) => patch('timezone', event.target.value)} placeholder="America/Lima" />
              <datalist id="platform-timezones">{COMMON_TIMEZONES.map((zone) => <option value={zone} key={zone} />)}</datalist>
            </label>
            <label>Formato de fecha
              <select value={form.dateFormat} onChange={(event) => patch('dateFormat', event.target.value)}>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </label>
            <div className="settings-preview-card"><span>Vista previa actual</span><strong>{previewDate}</strong></div>
          </div>
        </section>

        <section className="surface form-section settings-span-two">
          <h2>Evidencias del estudiante</h2>
          <p className="muted-copy">Estas reglas se validan tanto en la interfaz como en el servidor y se sincronizan con el bucket privado de evidencias.</p>
          <div className="evidence-settings-grid">
            <fieldset className="settings-fieldset">
              <legend>Tipos permitidos</legend>
              <div className="checkbox-grid">
                {SUPPORTED_EVIDENCE_TYPES.map((item) => (
                  <label className="check-card" key={item.mime}>
                    <input type="checkbox" checked={form.evidenceAllowedMimeTypes.includes(item.mime)} onChange={() => toggleMime(item.mime)} />
                    <span><strong>{item.label}</strong></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>Límite por evidencia (MB)
              <input type="number" min="1" max="50" step="1" value={form.evidenceMaxMb} onChange={(event) => patch('evidenceMaxMb', event.target.value)} />
              <small>Rango permitido: 1 a 50 MB.</small>
            </label>
          </div>
        </section>

        <section className="surface settings-save-bar settings-span-two">
          <div>
            <strong>Configuración persistente</strong>
            <span>{settings.updatedAt ? `Última actualización: ${formatDateTime(settings.updatedAt)}` : 'Valores iniciales de la plataforma.'}</span>
          </div>
          <button className="button primary" type="submit" disabled={saving || logoWorking}>{saving ? 'Guardando…' : 'Guardar configuración'}</button>
        </section>
      </form>
    </section>
  )
}
