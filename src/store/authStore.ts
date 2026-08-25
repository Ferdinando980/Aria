import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured, setRememberMe } from '../lib/supabase'

// Real bug found live (2026-08-25): relying only on onAuthStateChange's
// PASSWORD_RECOVERY event lost the signal entirely. `supabase` (lib/
// supabase.ts) is built at MODULE LOAD time, and supabase-js's GoTrueClient
// starts detecting/consuming the recovery token from the URL as part of its
// own constructor-time initialization -- but authStore's onAuthStateChange
// listener isn't attached until `init()` runs, which only happens from a
// React useEffect, well after module evaluation. The event fired and was
// gone before anyone was listening, so a recovery-link click silently
// became a normal session with no "set new password" prompt ever shown --
// reported live: "mi fa il login su un account generico... non c'e'
// nessuna scritta resetta la password". Fix: read the URL's own `type=
// recovery` marker synchronously at module load, before any async client
// initialization can race it. This can never be late -- it's parsed from
// the exact same URL the browser already has, not from an event that has
// to survive a round trip through the client's internal init first.
function parseAuthUrlSignal(): { recovery: boolean; error: string | null } {
  if (typeof window === 'undefined') return { recovery: false, error: null }
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const hashParams = new URLSearchParams(raw)
  const queryParams = new URLSearchParams(window.location.search)
  const type = hashParams.get('type') ?? queryParams.get('type')
  const errorDescription = hashParams.get('error_description') ?? queryParams.get('error_description')
  return { recovery: type === 'recovery', error: errorDescription ? decodeURIComponent(errorDescription.replace(/\+/g, ' ')) : null }
}
const initialAuthUrlSignal = parseAuthUrlSignal()

interface AuthState {
  session: Session | null
  ready: boolean
  // Supabase's client auto-detects a recovery token in the URL and silently
  // opens a real session (detectSessionInUrl, on by default), so `session`
  // alone can't tell a normal login apart from someone who just clicked a
  // "reset password" email link and hasn't actually picked a new password
  // yet. AuthGate checks this BEFORE its normal `if (session)` bypass so
  // that click lands on a "set new password" form instead of straight into
  // the app under a session nobody chose the password for. Seeded from the
  // URL directly (see parseAuthUrlSignal above), then only ever upgraded
  // (never cleared) by a later PASSWORD_RECOVERY event -- whichever signal
  // arrives, real or delayed, wins.
  recovery: boolean
  // A recovery/magic link that was already expired or already used when
  // clicked (Supabase redirects with #error=...&error_code=otp_expired
  // instead of a session) -- AuthGate shows this so the person isn't left
  // guessing why nothing happened, and can request a fresh one right away.
  recoveryError: string | null
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
  recovery: initialAuthUrlSignal.recovery,
  recoveryError: initialAuthUrlSignal.error,
  init: () => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, ready: true })
    })
    supabase.auth.onAuthStateChange((event, session) => {
      set((state) => ({ session, recovery: state.recovery || event === 'PASSWORD_RECOVERY' }))
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
    set({ recovery: false, recoveryError: null })
  },
  signOut: async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    set({ recovery: false, recoveryError: null })
  },
}))
