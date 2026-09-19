import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { hasSupabaseConfig, supabase } from '../services/supabaseClient'

const AuthContext = createContext(null)

async function fetchProfile(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, role, first_name, last_name, display_name, email, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(hasSupabaseConfig)
  const [authError, setAuthError] = useState(null)

  const hydrateUser = useCallback(async (candidateUser) => {
    if (!candidateUser) {
      setUser(null)
      setProfile(null)
      setLoading(false)
      return
    }

    setUser(candidateUser)
    try {
      const nextProfile = await fetchProfile(candidateUser.id)
      const allowed = nextProfile?.is_active && ['teacher', 'admin'].includes(nextProfile.role)
      if (!allowed) {
        setProfile(null)
        setAuthError('La cuenta no tiene autorización docente en esta plataforma.')
        await supabase.auth.signOut()
        setUser(null)
      } else {
        setProfile(nextProfile)
        setAuthError(null)
      }
    } catch (error) {
      setProfile(null)
      setAuthError('No se pudo verificar el perfil docente.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setLoading(false)
      return undefined
    }

    let active = true

    supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return
      if (error || !data?.user) {
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }
      hydrateUser(data.user)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'SIGNED_OUT' || !session?.user) {
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }

      setLoading(true)
      queueMicrotask(() => {
        if (active) hydrateUser(session.user)
      })
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [hydrateUser])

  const signIn = useCallback(async (email, password) => {
    if (!hasSupabaseConfig || !supabase) {
      return { ok: false, message: 'Configura VITE_SUPABASE_URL y la clave pública de Supabase.' }
    }

    setAuthError(null)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data?.user) {
      return { ok: false, message: 'Correo o contraseña incorrectos, o la cuenta no admite este método de acceso.' }
    }

    try {
      const nextProfile = await fetchProfile(data.user.id)
      const allowed = nextProfile?.is_active && ['teacher', 'admin'].includes(nextProfile.role)
      if (!allowed) {
        await supabase.auth.signOut()
        return { ok: false, message: 'La cuenta existe, pero no está autorizada como docente.' }
      }
      setUser(data.user)
      setProfile(nextProfile)
      setLoading(false)
      return { ok: true }
    } catch {
      await supabase.auth.signOut()
      return { ok: false, message: 'No se pudo verificar el perfil docente.' }
    }
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }, [])

  const value = useMemo(() => ({
    user,
    profile,
    role: profile?.role ?? null,
    loading,
    authError,
    signIn,
    signOut,
    isConfigured: hasSupabaseConfig,
  }), [user, profile, loading, authError, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe utilizarse dentro de AuthProvider.')
  return context
}
