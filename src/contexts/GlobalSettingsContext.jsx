import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_GLOBAL_SETTINGS,
  getGlobalSettings,
  removeGlobalLogo,
  updateGlobalSettings,
  uploadGlobalLogo,
} from '../services/globalSettingsManagement'
import { hasSupabaseConfig } from '../services/supabaseClient'
import { formatDateWithSettings, formatDateTimeWithSettings } from '../utils/dateFormatting'

const GlobalSettingsContext = createContext(null)

export function GlobalSettingsProvider({ children }) {
  const [settings, setSettings] = useState({ ...DEFAULT_GLOBAL_SETTINGS })
  const [loading, setLoading] = useState(hasSupabaseConfig)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!hasSupabaseConfig) {
      setSettings({ ...DEFAULT_GLOBAL_SETTINGS })
      setLoading(false)
      return DEFAULT_GLOBAL_SETTINGS
    }
    setLoading(true)
    try {
      const next = await getGlobalSettings()
      setSettings(next)
      setError(null)
      return next
    } catch (nextError) {
      setError(nextError.message || 'No se pudo cargar la configuración global.')
      return settings
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (settings.platformName && typeof document !== 'undefined') document.title = settings.platformName
  }, [settings.platformName])

  const save = useCallback(async (draft) => {
    const next = await updateGlobalSettings(draft)
    setSettings(next)
    setError(null)
    return next
  }, [])

  const uploadLogo = useCallback(async (file) => {
    const next = await uploadGlobalLogo(file, settings)
    setSettings(next)
    return next
  }, [settings])

  const removeLogo = useCallback(async () => {
    const next = await removeGlobalLogo(settings)
    setSettings(next)
    return next
  }, [settings])

  const formatDate = useCallback((value) => formatDateWithSettings(value, settings), [settings])
  const formatDateTime = useCallback((value) => formatDateTimeWithSettings(value, settings), [settings])

  const value = useMemo(() => ({
    settings,
    loading,
    error,
    refresh,
    save,
    uploadLogo,
    removeLogo,
    formatDate,
    formatDateTime,
  }), [settings, loading, error, refresh, save, uploadLogo, removeLogo, formatDate, formatDateTime])

  return <GlobalSettingsContext.Provider value={value}>{children}</GlobalSettingsContext.Provider>
}

export function useGlobalSettings() {
  const context = useContext(GlobalSettingsContext)
  if (!context) throw new Error('useGlobalSettings debe utilizarse dentro de GlobalSettingsProvider.')
  return context
}
