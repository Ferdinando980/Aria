import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured, setRememberMe } from '../lib/supabase'

interface AuthState {
  session: Session | null
  ready: boolean
  init: () => void
  signIn: (email: string, password: string, remember: boolean) => Promise<void>
  signUp: (email: string, password: string, remember: boolean) => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  ready: !isSupabaseConfigured,
  init: () => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, ready: true })
    })
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session })
    })
  },
  signIn: async (email, password, remember) => {
    if (!supabase) return
    setRememberMe(remember)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  },
  signUp: async (email, password, remember) => {
    if (!supabase) return
    setRememberMe(remember)
    // "Confirm email" e' disattivato lato Supabase: signUp restituisce subito una sessione valida, niente email da aspettare.
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  },
  signOut: async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  },
}))
