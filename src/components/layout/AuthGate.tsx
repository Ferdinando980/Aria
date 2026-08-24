import { useState, type ReactNode } from 'react'
import { Sparkles, Check } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useToastStore } from '../../store/toastStore'
import { isSupabaseConfigured } from '../../lib/supabase'
import { cn } from '../../lib/utils'

function friendlyError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
  if (/invalid login credentials/i.test(msg)) return 'Email o password sbagliate.'
  if (/user already registered/i.test(msg)) return 'Esiste gia\' un account con questa email — prova ad accedere.'
  if (/password.*(least|6|weak)/i.test(msg)) return 'La password deve avere almeno 6 caratteri.'
  return 'Non e\' andata, riprova.'
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, ready, signIn, signUp } = useAuthStore()
  const push = useToastStore((s) => s.push)

  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)

  if (!isSupabaseConfigured) return <>{children}</>
  if (!ready) return null
  if (session) return <>{children}</>

  const canSubmit = email.trim() && password.length >= 6 && (mode === 'login' || password === confirmPassword)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password, remember)
        push({ title: 'Bentornata!', description: 'Sei dentro.', tone: 'good' })
      } else {
        await signUp(email.trim(), password, remember)
        push({ title: 'Account creato', description: 'Sei dentro — da qui resti loggata.', tone: 'good' })
      }
    } catch (err) {
      push({ title: 'Non e\' andata', description: friendlyError(err), tone: 'warn' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm animate-pop rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-7">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--color-primary)] text-white">
            <Sparkles size={22} />
          </div>
          <h1 className="text-lg font-semibold">Aria</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {mode === 'login' ? 'Accedi con email e password.' : 'Crea il tuo account.'}
          </p>
        </div>

        <div className="mb-4 flex rounded-xl bg-[var(--color-surface-2)] p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={cn(
              'flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors',
              mode === 'login' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-ink-muted)]',
            )}
          >
            Accedi
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={cn(
              'flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors',
              mode === 'signup' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-ink-muted)]',
            )}
          >
            Registrati
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="tuaemail@esempio.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            autoComplete="email"
          />
          <Input
            type="password"
            placeholder="Password (almeno 6 caratteri)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'signup' && (
            <Input
              type="password"
              placeholder="Ripeti la password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          )}

          <button
            type="button"
            onClick={() => setRemember((r) => !r)}
            className="flex items-center gap-2 self-start text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <span
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition-colors',
                remember ? 'border-[var(--color-primary)] bg-[var(--color-primary)]' : 'border-[var(--color-border)]',
              )}
            >
              {remember && <Check size={12} className="text-white" />}
            </span>
            Ricordami su questo dispositivo
          </button>

          <Button type="submit" size="lg" disabled={!canSubmit || loading}>
            {loading ? 'Un attimo...' : mode === 'login' ? 'Accedi' : 'Crea account'}
          </Button>

          {mode === 'signup' && password && password.length < 6 && (
            <p className="text-center text-xs text-[var(--color-ink-muted)]">La password deve avere almeno 6 caratteri.</p>
          )}
          {mode === 'signup' && confirmPassword && password !== confirmPassword && (
            <p className="text-center text-xs text-[var(--color-warn)]">Le password non coincidono.</p>
          )}
        </form>
      </div>
    </div>
  )
}
