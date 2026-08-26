import { registerSW } from 'virtual:pwa-register'

// Registered exactly once, at app startup (imported from main.tsx).
let registration: ServiceWorkerRegistration | undefined

registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    registration = reg
  },
})

/** Force-checks for a new deploy and, if one is found, guarantees the app
 * actually picks it up -- doesn't just trust registerType 'autoUpdate' to
 * skip-waiting/reload on its own. Found live (2026-08-26, real user stuck
 * on a build from before several real deploys, `Analisi della traccia non
 * riuscita` and material-separation fixes both invisible to them): a real
 * user's tab had a fully-installed newer worker sitting in
 * `registration.waiting` indefinitely, across multiple `registration.update()`
 * calls from App.tsx's mount/focus/login triggers -- the "it activates and
 * reloads on its own" theory this module used to document did NOT hold up
 * under real repeated testing. Root cause not fully isolated (Workbox
 * generateSW + registerType 'autoUpdate' is supposed to bake in
 * `self.skipWaiting()`/`clientsClaim()`), but rather than keep trusting a
 * mechanism just proven unreliable, this makes the outcome unconditional:
 * if a waiting worker exists after an update check, ask it to skip waiting
 * (harmless no-op if unheeded), then independently clear every cache and
 * unregister so the immediately-following reload is guaranteed to fetch
 * everything fresh from the network regardless of whether that message did
 * anything. Self-limiting: once the fresh version is loaded, there's
 * nothing newer to find, so this stops reloading on its own. */
export async function checkForAppUpdate(): Promise<void> {
  try {
    if (!registration) return
    await registration.update()
    if (!registration.waiting) return
    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    await registration.unregister()
    window.location.reload()
  } catch {
    // no-op — the caller treats "nothing happened" as "already current"
  }
}
