import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

const REMEMBER_KEY = 'aria.rememberMe'

/** Call before signIn/signUp so the session that's about to be written lands in the right place. */
export function setRememberMe(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
  } catch {
    // ignore — falls back to remembered by default
  }
}

function isRemembered(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0'
  } catch {
    return true
  }
}

// "Ricordami" spento -> sessione in sessionStorage (sparisce alla chiusura del browser).
// "Ricordami" acceso (default) -> sessione in localStorage, sopravvive a riavvii, com'era prima.
const rememberAwareStorage = {
  getItem: (key: string) => {
    const primary = isRemembered() ? localStorage : sessionStorage
    const fallback = isRemembered() ? sessionStorage : localStorage
    return primary.getItem(key) ?? fallback.getItem(key)
  },
  setItem: (key: string, value: string) => {
    ;(isRemembered() ? localStorage : sessionStorage).setItem(key, value)
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, { auth: { storage: rememberAwareStorage } })
  : null
