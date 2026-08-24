# Aria — brief di progetto per aiuto nel design

## Cos'è

App PWA (React 19 + TypeScript + Vite) di organizzazione studio "stile Jarvis" per un'utente con **ADHD**. Non è un prodotto generico da vendere — è costruita per una persona specifica, con le sue difficoltà specifiche: facilità a dimenticare/perdere pensieri se non catturati subito, paura di fallire, blocco iniziale sui task grandi (task paralysis), bisogno di feedback immediato e positivo per restare motivata.

**Questo è il vincolo di design più importante, non un dettaglio**: ogni scelta visiva o di interazione deve tenerne conto. Niente linguaggio colpevolizzante (mai "hai fallito", "streak persa"), cattura istantanea dei pensieri sempre raggiungibile, vista "Oggi" come home invece del calendario intero per ridurre il sovraccarico visivo, feedback immediato (confetti, XP, toast) dopo ogni piccola azione.

## Stack tecnico

- React 19 + TypeScript + Vite, zustand per lo stato (con persist su localStorage)
- Supabase opzionale per sync multi-dispositivo (l'app funziona anche 100% locale senza account)
- Tailwind per lo styling, componenti UI custom sopra Radix UI (checkbox, dialog, dropdown, select, slider, switch, tabs, toast)
- Icone: lucide-react
- Assistente AI "Aria" via Google Gemini (chiave gratuita dell'utente, salvata solo in localStorage)
- PWA installabile, funziona offline

## Sistema di design attuale

- **Tema scuro fisso** (non ha ancora un tema chiaro):
  - sfondo `#0f1115`, superficie `#171a21`, superficie alternativa `#1f232c`, bordo `#2a2f3a`
  - testo `#f2f2f7`, testo attenuato `#9aa0ac`
  - primario (viola/indaco) `#6c5ce7`, accento (ambra) `#fdcb6e`, "buono"/successo `#55efc4`, "attenzione" `#ffb26b`, "calmo" `#74b9ff`
  - font: Inter
  - angoli molto arrotondati (`1.25rem`–`1.75rem` di raggio) — sensazione morbida, non squadrata
- Componenti base: `Card`/`CardTitle`/`CardSubtitle`, `Button` (varianti soft/outline/icon), `Input`/`Textarea`, `SidePanel` per pannelli laterali scorrevoli
- Micro-animazioni: confetti al completamento task (`canvas-confetti`), toast di feedback

## Le sezioni (pagine)

1. **Oggi** (home) — vista principale, pensata per ridurre il sovraccarico: task del giorno, più la card **"Ripasso lampo"** in cima (una domanda di richiamo attivo pescata da un algoritmo di ripetizione dilazionata stile SM-2).
2. **Calendario** — FullCalendar con drag&drop, eventi collegabili a task/materie.
3. **Materiali** — materie (subjects) → link/appunti/file dentro ciascuna, con drag&drop. Da qui: **piano di studio AI** (sia per singolo file che per l'intera materia, due flussi distinti e voluti separati), **chat AI per materiale** con memoria persistente, disegno a mano libera sopra il materiale, export verso NotebookLM.
4. **Aria** (`/aria`) — chat AI generale, stile Gemini, con allegati (file/immagini) trascinabili/ridimensionabili. Punto d'ingresso anche per "Spezza con Aria" (scomposizione di un task in micro-passi, richiamato da un pulsante sui task del giorno).
5. **Progressi** — gamification: XP, livelli, streak (con "streak freeze" invece di azzeramento brusco quando si salta un giorno).
6. **Impostazioni** — chiave API Gemini, account/sync, backup dati, e (novità di oggi) la **libreria di skill**.
7. **/gioco** — minigioco pausa (Tetris), si apre in una scheda separata del browser, sbloccato solo a focus-timer non attivo, 10 minuti/giorno.

## Novità appena aggiunta: libreria di skill ("Librarian")

Un'architettura di apprendimento sperimentale (porta un progetto di ricerca parallelo sull'apprendimento dei modelli linguistici dentro l'uso quotidiano di Aria): Aria costruisce nel tempo una libreria di "skill" — consigli/pattern richiamati automaticamente in base al contesto — che vengono promossi da "in prova" a "verificati" solo dopo evidenza reale di successo (completamento task, piano seguito, feedback 👍/👎), confrontata contro un baseline (le chiamate senza skill), e retrocessi se smettono di funzionare. Visibile in Impostazioni con un interruttore on/off, un elenco delle skill correnti (titolo, dominio, stato, tasso di successo), un riepilogo F-vs-baseline per dominio, ed export delle metriche in JSON.

Aggiunte con lo stesso rigore usato lato ricerca: modello Gemini pinnato in un'unica costante e loggato ad ogni chiamata (per accorgersi se cambia sotto i piedi), e un consenso esplicito opt-in ("Contribuisci alla ricerca", spento di default) prima che l'app venga usata da chiunque oltre alla prima persona — decide cosa entra in analisi aggregate multi-utente, mai il contenuto personale delle skill.

## Cosa NON toccare/violare quando si propone un design

- Nessuno stato di "fallimento" duro (barre rosse, streak azzerate senza spiegazione, badge "mancato")
- Il pulsante `+` di cattura rapida deve restare raggiungibile da ogni schermata
- La vista Oggi resta la home, non il calendario
- Menu laterale comprimibile a icone (68px)
