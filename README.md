# Aria — assistente di studio

Aria è nata per risolvere un problema molto concreto: organizzare lo studio quando hai l'ADHD e i planner "normali" non reggono — troppi passaggi tra pensare una cosa e scriverla da qualche parte, troppo facile sentirsi in colpa quando salta una streak, troppo poco feedback immediato per restare motivati. Ogni scelta di design nasce da lì, non da una lista di feature generiche.

Cattura rapida dei pensieri da un pulsante sempre raggiungibile, una home "Oggi" che mostra solo quello che conta adesso invece del calendario intero, task grossi spezzabili in micro-passi con l'aiuto della chat AI, streak che si "congelano" invece di azzerarsi di colpo, e un ciclo di richiamo attivo distanziato (spaced retrieval, SM-2) integrato nella home invece che relegato in un angolo. È una **PWA**: un solo progetto, installabile su PC e telefono, funziona offline. Parte subito senza account (i dati restano sul dispositivo); se vuoi sincronizzare più device, colleghi Supabase gratuitamente (vedi sotto).

Live (provvisorio): [aria-jarvis.netlify.app](https://aria-jarvis.netlify.app)

## Cosa fa, in pratica

- **Oggi** — la vera home. In cima, "Ripasso lampo": una domanda a scelta, pescata da un algoritmo di ripetizione dilazionata (intervalli che raddoppiano fino a 21 giorni se rispondi bene, si azzerano a 1 giorno se sbagli) sulle domande generate dai piani di studio. Sotto, i task del giorno — compresi quelli generati automaticamente da un piano di studio.
- **Piano di studio con AI** — generabile su un singolo file o su tutta una materia insieme (due percorsi distinti, voluti separati: un piano su un file resta stretto a quel contenuto, uno su tutta la materia collega argomenti tra file diversi). Se c'è una data d'esame, i passi vengono distribuiti giorno per giorno per pagine reali da studiare (non solo per minuti stimati) e diventano **task veri** — non eventi calendario fittizi: appaiono in Oggi (con tanto di "Pagine di oggi: X-Y") e nel Calendario con lo stesso identico stato, spuntarli da uno dei due posti li completa ovunque.
- **Calendario** — FullCalendar con drag&drop per spostare task ed eventi tra i giorni, colore per materia con contrasto del testo calcolato al volo (non fisso: su un colore chiaro come l'ambra il testo diventa nero automaticamente, non serve sceglierlo a mano).
- **Materiali** — organizzati per materia, con chat AI dedicata affiancata al visualizzatore (non sopra, per non nascondere il documento) e memoria persistente per file: Aria ricorda cosa avete già discusso su quel materiale specifico da una sessione all'altra.
- **Chat generale con Aria** — allegati veri (immagini, PDF), inviati come contenuto multimodale a Gemini, non solo menzionati nel testo. Il visualizzatore dell'allegato è una finestra flottante trascinabile e ridimensionabile, non un overlay fisso — riparte chiusa a ogni apertura, ma dalla posizione dove l'avevi lasciata l'ultima volta.
- **Flashcard e Riassunti** — sezioni dedicate, generate per capitolo o sottosezione (rilevati automaticamente dal documento). I riassunti seguono regole pensate per l'ADHD: paragrafi corti, intestazioni con emoji ed etichette colorate (definizione, esempio, attenzione...) come veri appunti evidenziati, formule matematiche vere (KaTeX) invece di LaTeX grezzo, il dato chiave in grassetto.
- **Focus timer** con messaggi da "body double" invece di un countdown freddo, e un minigioco (Tetris, 10 minuti/giorno) in una scheda separata per le pause, sbloccato solo a timer fermo.
- **Progressi, senza punizioni** — XP, livelli, streak che si congelano invece di azzerarsi: mai una barra rossa, mai un badge "fallito". Il linguaggio evita sistematicamente il tono da rimprovero, in ogni schermata.
- **Cheat Study** — carichi una traccia d'esame (PDF o foto) e Aria individua gli esercizi da soli; per ognuno genera una scaletta di esercizi propedeutici dal più facile in su (per non bloccarsi davanti a quello vero), una spiegazione passo-passo come timeline numerata, e un esercizio equivalente per allenarsi oltre alla traccia. Figure (alberi, grafi, automi) come diagrammi Mermaid veri, non immagini generate — gratuito, stesso modello di testo. Scelta multipla come card grandi e cliccabili quando l'esercizio è davvero a scelta multipla, mai forzata. Ogni sezione si scarica come PDF pulito, pronto per essere usato come vera prova d'allenamento.
- **Allenamento skill** — una sezione dedicata a *correggere* Aria, non a generare da capo: scegli un esercizio già in Cheat Study (o caricane uno nuovo qui, mai salvato su Storage — solo il testo estratto), scegli UNA delle tre aree (spiegazione / esercizio equivalente / esercizi di base) e correggi l'output a mano. La correzione aggiorna il record vero che vedi in Cheat Study, e se è sostanziale Aria distilla lì per lì un principio riusabile personale, taggato con l'area da cui viene così da preferirlo in futuro proprio per quel tipo di generazione. Le skill personali si vedono, si disattivano o si eliminano da un pannello dedicato nella stessa pagina.

## Il laboratorio dentro l'app

Aria è anche il banco di prova reale di un progetto di ricerca parallelo, [**Cognitive RPG**](../cognitive_rpg) (progetto sorella, tecnicamente indipendente): un ecosistema di agenti LLM piccoli che imparano procedure tramite una libreria di skill condivisa e verificata con evidenza reale, mai sulla fiducia. La **Libreria di skill** di Aria (`src/lib/skills.ts`, `src/lib/skillEvents.ts`) è un porting manuale di quell'architettura — Book/Librarian/optimizer — su ogni superficie AI dell'app (<!-- AUTO:DOMAINS:START -->chat generale, scomposizione task, chat materiale, piano di studio, modifica PDF (Word), conoscenza materiali, rilevamento capitoli, flashcard, riassunti, esempi numerici e cheat Study<!-- AUTO:DOMAINS:END -->): ogni chiamata logga cosa è stato recuperato, ogni 👍/👎 o piano seguito fino in fondo logga un esito, e una skill viene promossa da bozza a verificata solo dopo un numero minimo di usi con un tasso di successo che batte il baseline "senza skill" di un margine reale — non alla prima volta che sembra funzionare. L'uso quotidiano vero produce dati di comportamento genuini per la stessa domanda di ricerca, mentre l'app resta prima di tutto uno strumento usato davvero, non un esperimento travestito da prodotto.

Un dettaglio di governance preso sul serio: le skill di *contenuto* (legate a un materiale o una chat specifica) non escono mai dall'account che le ha generate, a prescindere da qualunque consenso — solo le skill di *procedura* (tecniche generali, tipo "come strutturare un buon riassunto"), o quelle che la sezione Allenamento giudica esplicitamente generiche, sono candidate a una libreria condivisa tra utenti. La pipeline è reale (non solo un interruttore pronto): una skill candidata (`CROSS_USER_CANDIDATE`) si promuove a verificata solo dopo un numero minimo di verifiche indipendenti da *altri* account che hanno anche loro dato consenso esplicito (mai contati altrimenti, mai il contenuto altrui — solo conteggi aggregati via una funzione Postgres dedicata), sopra una soglia assoluta più una quota proporzionale alla base utenti reale — a due utenti resta strutturalmente irraggiungibile, come deve essere. Consenso acceso di default (disattivabile in Impostazioni), come il consenso alla ricerca. Con l'app usata ora da più di una persona, ogni numero aggregato dichiara onestamente n=2 — resta un campione minuscolo, non un risultato da generalizzare.

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
