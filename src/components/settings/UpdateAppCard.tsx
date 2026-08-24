import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../ui/Card'
import { Button } from '../ui/Button'
import { useToastStore } from '../../store/toastStore'
import { checkForAppUpdate } from '../../lib/pwaUpdate'

export function UpdateAppCard() {
  const [checking, setChecking] = useState(false)
  const push = useToastStore((s) => s.push)

  async function handleUpdate() {
    setChecking(true)
    try {
      // registration.update() can hang (or never resolve) in some browser/SW
      // states — never let the button get stuck because of that.
      await Promise.race([checkForAppUpdate(), new Promise((r) => setTimeout(r, 4000))])
    } catch {
      // ignore — handled below either way
    }
    // If a new version was found, the service worker activates and reloads
    // the page on its own within a moment. If nothing happens, we were
    // already current — say so instead of leaving the button hanging.
    window.setTimeout(() => {
      setChecking(false)
      push({ title: 'Sei già all\'ultima versione', tone: 'good' })
    }, 1500)
  }

  return (
    <Card>
      <CardTitle>Aggiorna app</CardTitle>
      <CardSubtitle className="mb-3">Controlla se c'è una versione più recente e la applica subito.</CardSubtitle>
      <Button variant="soft" size="sm" onClick={handleUpdate} disabled={checking}>
        <RefreshCw size={14} className={checking ? 'animate-spin' : undefined} />
        {checking ? 'Controllo...' : 'Controlla aggiornamenti'}
      </Button>
    </Card>
  )
}
