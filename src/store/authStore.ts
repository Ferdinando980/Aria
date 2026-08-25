import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured, setRememberMe } from '../lib/supabase'

interface AuthState {
  session: Session | null
  ready: boolean
  // Set by onAuthStateChange's PASSWORD_RECOVERY event -- Supabase's client
  // auto-detects the recovery token in the URL and silently opens a real
  // session (detectSessionInUrl, on by default), so `session` alone can't
  // tell a normal login apart from someone who just clicked a "reset
  // password" email link and hasn't actually picked a new password yet.
  // AuthGate checks this BEFORE its normal `if (session)` bypass so that
  // click lands on a "set new password" form instead of straight into the
  // app under a session nobody chose the password for.
  recovery: boolean
  init: () => void
  signIn: (email: string, password: string, remember: boolean) => Promise<void>
  signUp: (email: string, password: string, remember: boolean) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  ready: !isSupabaseConfigured,
  recovery: false,
  init: () => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, ready: true })
    })
    supabase.auth.onAuthStateChange((event, session) => {
      set({ session, recovery: event === 'PASSWORD_RECOVERY' })
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
  requestPasswordReset: async (email) => {
    if (!supabase) return
    // redirectTo must be in Supabase's Redirect URLs allow list (Auth ->
    // URL Configuration) or the link falls back to the project's Site URL
    // instead -- see CLAUDE.md's 2026-08-25 note on that misconfiguration.
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    if (error) throw error
  },
  updatePassword: async (password) => {
    if (!supabase) return
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    set({ recovery: false })
  },
  signOut: async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    set({ recovery: false })
  },
}))
