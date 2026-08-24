# Aria — assistente di studio

App di organizzazione studio pensata per menti ADHD: cattura rapida dei pensieri, vista "Oggi" senza sovraccarico, calendario con drag&drop, materiali per materia (con export veloce verso NotebookLM), focus timer, gamification gentile (XP, livelli, streak con "salvastreak" invece di azzeramenti bruschi) e una chat AI ("Aria", su Google Gemini) che aiuta a spezzare i compiti in piccoli passi.

È una **PWA**: un solo progetto, installabile sia su PC che su telefono, funziona anche offline. Funziona da subito senza alcun account: i dati restano sul dispositivo (localStorage). Se vuoi sincronizzare PC e telefono, collega Supabase (gratuito, vedi sotto).

Live (provvisorio): [funny-starship-804504.netlify.app](https://funny-starship-804504.netlify.app)

## Perché esiste (oltre l'uso quotidiano)

Aria è anche il campo di applicazione reale di un progetto di ricerca parallelo, [**Cognitive RPG**](../cognitive_rpg) (`../cognitive_rpg`, progetto sorella indipendente): un ecosistema di agenti LLM piccoli che imparano procedure tramite una libreria di skill condivisa, verificata con evidenza reale invece che sulla fiducia. La sezione **Libreria di skill** di Aria (`src/lib/skills.ts`, `src/lib/skillEvents.ts`) è un porting manuale — non una dipendenza di codice, i due progetti restano tecnicamente isolati — dell'architettura Book/Librarian/skill_generator/optimizer di quel progetto: ogni interazione reale con Aria (feedback 👍/👎, un piano di studio seguito o abbandonato) produce dati di comportamento genuini per la stessa domanda di ricerca, mentre l'app resta, prima di tutto, uno strumento usato davvero ogni giorno.

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
