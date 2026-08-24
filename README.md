# Aria — assistente di studio

Aria è nata per risolvere un problema molto concreto: organizzare lo studio quando hai l'ADHD e i planner "normali" non reggono — troppi passaggi tra pensare una cosa e scriverla da qualche parte, troppo facile sentirsi in colpa quando salta una streak, troppo poco feedback immediato per restare motivati. Ogni scelta di design nasce da lì, non da una lista di feature generiche.

Cattura rapida dei pensieri da un pulsante sempre raggiungibile, una home "Oggi" che mostra solo quello che conta adesso invece del calendario intero, task grossi spezzabili in micro-passi con l'aiuto della chat AI, streak che si "congelano" invece di azzerarsi di colpo, e un ciclo di richiamo attivo distanziato (spaced retrieval, SM-2) integrato nella home invece che relegato in un angolo. È una **PWA**: un solo progetto, installabile su PC e telefono, funziona offline. Parte subito senza account (i dati restano sul dispositivo); se vuoi sincronizzare più device, colleghi Supabase gratuitamente (vedi sotto).

Live (provvisorio): [funny-starship-804504.netlify.app](https://funny-starship-804504.netlify.app)

## Cosa fa, in pratica

- **Oggi** — la vera home. In cima, "Ripasso lampo": una domanda a scelta, pescata da un algoritmo di ripetizione dilazionata (intervalli che raddoppiano fino a 21 giorni se rispondi bene, si azzerano a 1 giorno se sbagli) sulle domande generate dai piani di studio. Sotto, i task del giorno — compresi quelli generati automaticamente da un piano di studio.
- **Piano di studio con AI** — generabile su un singolo file o su tutta una materia insieme (due percorsi distinti, voluti separati: un piano su un file resta stretto a quel contenuto, uno su tutta la materia collega argomenti tra file diversi). Se c'è una data d'esame, i passi vengono distribuiti giorno per giorno e diventano **task veri** — non eventi calendario fittizi: appaiono in Oggi e nel Calendario con lo stesso identico stato, spuntarli da uno dei due posti li completa ovunque.
- **Materiali** — organizzati per materia, con chat AI dedicata affiancata al visualizzatore (non sopra, per non nascondere il documento) e memoria persistente per file: Aria ricorda cosa avete già discusso su quel materiale specifico da una sessione all'altra.
- **Flashcard e Riassunti** — sezioni dedicate, generate per capitolo o sottosezione (rilevati automaticamente dal documento). I riassunti seguono regole pensate per l'ADHD: paragrafi corti, intestazioni frequenti, punti elenco invece di prosa lunga, il dato chiave in grassetto.
- **Focus timer** con messaggi da "body double" invece di un countdown freddo, e un minigioco (Tetris, 10 minuti/giorno) in una scheda separata per le pause, sbloccato solo a timer fermo.
- **Gamification senza punizioni** — XP, livelli, streak: mai una barra rossa, mai un badge "fallito". Il linguaggio evita sistematicamente il tono da rimprovero.

## Il laboratorio dentro l'app

Aria è anche il banco di prova reale di un progetto di ricerca parallelo, [**Cognitive RPG**](../cognitive_rpg) (progetto sorella, tecnicamente indipendente): un ecosistema di agenti LLM piccoli che imparano procedure tramite una libreria di skill condivisa e verificata con evidenza reale, mai sulla fiducia. La **Libreria di skill** di Aria (`src/lib/skills.ts`, `src/lib/skillEvents.ts`) è un porting manuale di quell'architettura — Book/Librarian/optimizer — su ogni superficie AI dell'app (chat sui materiali, generazione piano di studio, capitoli, flashcard, riassunti): ogni chiamata logga cosa è stato recuperato, ogni 👍/👎 o piano seguito fino in fondo logga un esito, e una skill viene promossa da bozza a verificata solo dopo un numero minimo di usi con un tasso di successo che batte il baseline "senza skill" di un margine reale — non alla prima volta che sembra funzionare. L'uso quotidiano vero produce dati di comportamento genuini per la stessa domanda di ricerca, mentre l'app resta prima di tutto uno strumento usato davvero, non un esperimento travestito da prodotto.

## Avvio in locale

```bash
npm install
npm run dev
```

Apri l'indirizzo che appare in terminale (di solito `http://localhost:5173`).

## Installarla come app (PC e telefono)

- **Desktop (Chrome/Edge)**: apri l'app, clicca l'icona di installazione nella barra degli indirizzi ("Installa app").
- **Android (Chrome)**: menu ⋮ → "Installa app" / "Aggiungi a schermata Home".
- **iPhone (Safari)**: pulsante Condividi → "Aggiungi alla schermata Home".

Dopo l'installazione, l'app si apre a schermo intero come un'app nativa e continua a funzionare anche offline.

## Chiave AI per la chat "Aria" (gratuita)

1. Vai su https://aistudio.google.com/apikey e crea una chiave (account Google, nessuna carta di credito).
2. Nell'app: **Impostazioni → Chiave API Gemini**, incolla e salva.

La chiave resta solo sul tuo dispositivo (`localStorage`), non viene mai inviata altrove se non direttamente a Google per generare le risposte.

## Sincronizzare PC e telefono (facoltativo, gratuito)

Senza questo passaggio l'app funziona benissimo, ma ogni dispositivo ha i suoi dati separati.

1. Crea un progetto gratuito su https://supabase.com.
2. Nel progetto Supabase: **SQL Editor → New query**, incolla tutto il contenuto di [`supabase/schema.sql`](./supabase/schema.sql) e premi **Run**.
3. Vai in **Project Settings → API**: copia "Project URL" e "anon public key".
4. Nel progetto, copia `.env.example` in `.env` e incolla i due valori:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
5. Riavvia `npm run dev` (o rifai la build). Ora compare una schermata di login (email + password, con "Ricordami") — registrati la prima volta, poi fai lo stesso login sull'altro dispositivo e i dati si sincronizzano automaticamente. Se `VITE_SUPABASE_URL`/`KEY` non sono configurate l'app resta local-only e il login si salta del tutto.

## Materiali e NotebookLM

Non esiste un'API pubblica di NotebookLM, quindi l'integrazione è: organizzi link/appunti/file per materia nella sezione **Materiali**, poi con un tasto **"Copia fonti"** li copi pronti da incollare in NotebookLM, oppure **"Apri NotebookLM"** apre notebooklm.google.com in una nuova scheda.

## Build di produzione

```bash
npm run build
npm run preview
```

L'output sta in `dist/`, pubblicabile su qualunque hosting statico (Vercel, Netlify, Cloudflare Pages, GitHub Pages...) — ricordati di impostare `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` come variabili d'ambiente sull'hosting se usi la sync.

## Stack

React + TypeScript + Vite · Tailwind CSS v4 · Zustand (stato + persistenza locale) · FullCalendar · Supabase (auth + Postgres + realtime, facoltativo) · Google Gemini (chat AI) · vite-plugin-pwa.

Vedi [`CLAUDE.md`](./CLAUDE.md) per il contesto di design (perché le scelte ADHD-friendly) da tenere a mente in ogni modifica futura.
