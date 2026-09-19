import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { recordStudentSecurityEvent } from '../services/studentExamAccess'

const DEFAULTS = {
  enabled: true,
  requireFullscreen: true,
  detectVisibility: true,
  detectBlur: true,
  blockClipboard: true,
  blockContextMenu: true,
  blockShortcuts: true,
  watermark: true,
  detectExtendedDisplay: true,
  requireSeb: false,
  maxIncidents: 3,
  incidentCount: 0,
}

function normalized(config) {
  return { ...DEFAULTS, ...(config || {}) }
}

function mobileLikeDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches
  return Boolean(coarsePointer || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''))
}

export async function requestExamFullscreen() {
  if (!document.fullscreenEnabled || document.fullscreenElement) return Boolean(document.fullscreenElement || !document.fullscreenEnabled)
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    return true
  } catch {
    return false
  }
}

export default function ExamSecurityGuard({ sessionToken, config, studentName = 'Estudiante', examTitle = 'Examen' }) {
  const security = useMemo(() => normalized(config), [config])
  const isMobileLike = useMemo(() => mobileLikeDevice(), [])
  const [incidentCount, setIncidentCount] = useState(() => Math.max(0, Number(security.incidentCount || 0)))
  const [warning, setWarning] = useState('')
  const [fullscreenBlocked, setFullscreenBlocked] = useState(Boolean(security.enabled && security.requireFullscreen && document.fullscreenEnabled && !document.fullscreenElement))
  const lastEventRef = useRef({ type: '', at: 0 })
  const hiddenAtRef = useRef(null)
  const pausedRef = useRef(false)
  const warningTimerRef = useRef(null)
  const blurTimerRef = useRef(null)
  const wakeLockRef = useRef(null)

  useEffect(() => {
    const authoritative = Number(security.incidentCount)
    if (Number.isFinite(authoritative) && authoritative >= 0) {
      setIncidentCount((current) => Math.max(current, authoritative))
    }
  }, [security.incidentCount])

  const showWarning = useCallback((text) => {
    setWarning(text)
    window.clearTimeout(warningTimerRef.current)
    warningTimerRef.current = window.setTimeout(() => setWarning(''), 5000)
  }, [])

  const requestWakeLock = useCallback(async () => {
    if (!security.enabled || document.hidden || !navigator.wakeLock?.request) return false
    try {
      if (wakeLockRef.current && !wakeLockRef.current.released) return true
      const sentinel = await navigator.wakeLock.request('screen')
      wakeLockRef.current = sentinel
      sentinel.addEventListener?.('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null
      })
      return true
    } catch {
      return false
    }
  }, [security.enabled])

  const record = useCallback((type, metadata = {}, text = '') => {
    if (!security.enabled) return
    const now = Date.now()
    if (lastEventRef.current.type === type && now - lastEventRef.current.at < 700) return
    lastEventRef.current = { type, at: now }
    setIncidentCount((value) => value + 1)
    if (text) showWarning(text)
    recordStudentSecurityEvent(sessionToken, { type, metadata })
      .then((result) => {
        const authoritative = Number(result?.incidentCount)
        if (Number.isFinite(authoritative) && authoritative >= 0) setIncidentCount(authoritative)
      })
      .catch(() => {})
  }, [security.enabled, sessionToken, showWarning])

  useEffect(() => {
    if (!security.enabled) return undefined
    document.body.classList.add('secure-exam-active')
    requestWakeLock()

    if (security.detectExtendedDisplay && window.screen?.isExtended) {
      record('SECURITY_EXTENDED_DISPLAY', {}, 'El navegador informa que el equipo utiliza una pantalla extendida.')
    }

    const onVisibility = () => {
      if (pausedRef.current || !security.detectVisibility) return
      if (document.hidden) {
        hiddenAtRef.current = Date.now()
        return
      }

      requestWakeLock()
      if (hiddenAtRef.current) {
        const durationMs = Date.now() - hiddenAtRef.current
        hiddenAtRef.current = null
        record(
          'SECURITY_VISIBILITY_INTERRUPTION',
          { durationMs, device: isMobileLike ? 'mobile' : 'desktop' },
          'Se registró una salida temporal de la página del examen.',
        )
      }
    }

    const onBlur = () => {
      // En móviles, teclado, permisos y UI del sistema generan blur legítimos.
      // La detección de visibilidad es más estable para identificar cambio de app.
      if (pausedRef.current || !security.detectBlur || isMobileLike) return
      window.clearTimeout(blurTimerRef.current)
      blurTimerRef.current = window.setTimeout(() => {
        if (!pausedRef.current && !document.hidden) record('SECURITY_WINDOW_BLUR', {}, 'Se registró una pérdida de foco de la ventana.')
      }, 450)
    }

    const onFullscreen = () => {
      const exited = security.requireFullscreen && document.fullscreenEnabled && !document.fullscreenElement
      setFullscreenBlocked(exited)
      // Si la página está oculta (p. ej., pantalla del celular bloqueada), no
      // contamos además una segunda incidencia por fullscreen. La interrupción
      // de visibilidad se registrará una sola vez al regresar.
      if (exited && !pausedRef.current && !document.hidden && !hiddenAtRef.current) {
        record('SECURITY_FULLSCREEN_EXIT', {}, 'Debes volver al modo de pantalla completa para continuar.')
      }
    }

    const preventClipboard = (event) => {
      if (!security.blockClipboard) return
      event.preventDefault()
      record(`SECURITY_${event.type.toUpperCase()}`, {}, 'Copiar, cortar y pegar están deshabilitados durante la evaluación.')
    }
    const onContext = (event) => {
      if (!security.blockContextMenu) return
      event.preventDefault()
      record('SECURITY_CONTEXT_MENU', {}, 'El menú contextual está deshabilitado durante la evaluación.')
    }
    const onDrag = (event) => {
      if (!security.blockClipboard) return
      event.preventDefault()
      record('SECURITY_DRAG_BLOCKED', {}, 'Arrastrar contenido está deshabilitado durante la evaluación.')
    }
    const onBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
      return ''
    }
    const onKey = (event) => {
      if (!security.blockShortcuts) return
      const key = String(event.key || '').toLowerCase()
      const blockedCtrl = (event.ctrlKey || event.metaKey) && ['c', 'v', 'x', 'p', 's', 'u'].includes(key)
      const blockedDev = key === 'f12' || ((event.ctrlKey || event.metaKey) && event.shiftKey && ['i', 'j', 'c'].includes(key))
      if (blockedCtrl || blockedDev || key === 'printscreen') {
        event.preventDefault()
        record('SECURITY_BLOCKED_SHORTCUT', { key, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey }, 'Ese atajo está deshabilitado durante la evaluación.')
        if (key === 'printscreen' && navigator.clipboard?.writeText) navigator.clipboard.writeText('').catch(() => {})
      }
    }
    const onBeforePrint = () => record('SECURITY_PRINT_ATTEMPT', {}, 'La impresión está deshabilitada durante la evaluación.')
    const onPause = () => { pausedRef.current = true }
    const onResume = () => {
      pausedRef.current = false
      hiddenAtRef.current = null
      requestWakeLock()
      if (security.requireFullscreen && document.fullscreenEnabled && !document.fullscreenElement) setFullscreenBlocked(true)
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('exam-security-pause', onPause)
    window.addEventListener('exam-security-resume', onResume)
    window.addEventListener('blur', onBlur)
    document.addEventListener('fullscreenchange', onFullscreen)
    document.addEventListener('copy', preventClipboard, true)
    document.addEventListener('cut', preventClipboard, true)
    document.addEventListener('paste', preventClipboard, true)
    document.addEventListener('contextmenu', onContext, true)
    document.addEventListener('dragstart', onDrag, true)
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('beforeprint', onBeforePrint)

    return () => {
      document.body.classList.remove('secure-exam-active')
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('exam-security-pause', onPause)
      window.removeEventListener('exam-security-resume', onResume)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('copy', preventClipboard, true)
      document.removeEventListener('cut', preventClipboard, true)
      document.removeEventListener('paste', preventClipboard, true)
      document.removeEventListener('contextmenu', onContext, true)
      document.removeEventListener('dragstart', onDrag, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('beforeprint', onBeforePrint)
      window.clearTimeout(warningTimerRef.current)
      window.clearTimeout(blurTimerRef.current)
      wakeLockRef.current?.release?.().catch(() => {})
      wakeLockRef.current = null
    }
  }, [security, record, sessionToken, isMobileLike, requestWakeLock])

  if (!security.enabled) return null
  const max = Math.max(1, Number(security.maxIncidents || 3))
  return (
    <>
      {security.watermark && <div className="exam-security-watermark" aria-hidden="true"><span>{studentName} · {examTitle}</span><span>{studentName} · {examTitle}</span><span>{studentName} · {examTitle}</span></div>}
      <div className={`security-incident-counter ${incidentCount >= max ? 'critical' : ''}`} title="Incidencias de integridad registradas">Integridad: {incidentCount} incidencia{incidentCount === 1 ? '' : 's'}</div>
      {warning && <div className={`security-warning-toast ${incidentCount >= max ? 'critical' : ''}`} role="alert">{warning}{incidentCount >= max ? ' Se alcanzó el umbral de incidencias; el docente podrá revisar este registro.' : ''}</div>}
      {fullscreenBlocked && <div className="security-fullscreen-lock" role="dialog" aria-modal="true" aria-label="Pantalla completa requerida"><div><strong>Pantalla completa requerida</strong><p>La evaluación está protegida. Vuelve a pantalla completa para continuar.</p><button className="button primary" type="button" onClick={async () => { const ok = await requestExamFullscreen(); if (ok) setFullscreenBlocked(false) }}>Volver a pantalla completa</button></div></div>}
    </>
  )
}
