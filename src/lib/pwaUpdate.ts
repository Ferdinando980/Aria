import { registerSW } from 'virtual:pwa-register'

// Registered exactly once, at app startup (imported from main.tsx), rather
// than inside a component — registerType is "autoUpdate", so once a new
// service worker is found it activates and reloads the page on its own;
// this module just exposes a way to force that check to happen *right now*
// instead of waiting for the browser's own lazy background check.
let registration: ServiceWorkerRegistration | undefined

registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    registration = reg
  },
})

export async function checkForAppUpdate(): Promise<void> {
  try {
    await registration?.update()
  } catch {
    // no-op — the caller treats "nothing happened" as "already current"
  }
}
