# Foundation skills — log di costruzione e verifica

Un'unica pagina da scorrere per rivedere "i controlli alla fine" (2026-08-25, richiesta esplicita: "forza il tutto... predisponi un log facile"). Ogni pilota qui sotto segue la stessa disciplina del primo (`fs_self_verification_recompute`): meccanismo reale cablato in un call site di produzione + test causale (casi noti + manipolazione diretta: stesso input rotto, con e senza il controllo). Vedi l'artifact `foundation-skills-taxonomy.html` per la tassonomia completa e il criterio.

**Regola di stato**: resta `CANDIDATE` finché non ha accumulato evidenza comportamentale reale in produzione (uso vero, non solo il test causale una tantum). `VERIFIED` non si assegna qui.

---

## fs_self_verification_recompute

| Campo | Valore |
|---|---|
| Dominio applicato | `chapters` (generalizzato da `formula_example`, già in produzione) |
| File | `src/lib/chapterVerification.ts` |
| Call site | `src/components/materials/ChaptersPanel.tsx` (`detect()`) |
| Cosa verifica | Copertura pagine, sovrapposizioni, fuori-range — ricalcolo indipendente dalle pagine reali estratte dal PDF, mai dalla dichiarazione del modello |
| Test causale | ✅ 2026-08-25 — 4 casi noti (1 buono, 3 rotti) tutti come atteso; manipolazione diretta: stesso input rotto, `pass=false` con il controllo → `pass=true` senza (script usa-e-getta, cancellato) |
| Stato | `CANDIDATE` — 0 uso reale in produzione finora |

---

## fs_task_decomposition_structure_check

| Campo | Valore |
|---|---|
| Dominio applicato | `task_breakdown` (chat libera, prefisso "Aiutami a spezzare...") |
| File | `src/lib/taskDecompositionVerification.ts` |
| Call site | `src/pages/Assistant.tsx` (dopo `askAria()`, solo se `domain === 'task_breakdown'`) |
| Cosa verifica | Primo passo estratto dalla risposta: assenza di congiunzione "e" tra due clausole, lunghezza sotto soglia (proxy di "atomico, sotto i 2 minuti") — generalizza la regola già scritta in `seed_task_breakdown_first_step` |
| Modalità | **Log-only, mai blocca** — testo libero parsato euristicamente, più debole del pilota #1 (dichiarato esplicitamente nel codice sorgente) |
| Test causale | ✅ 2026-08-25 — 4 casi noti (1 buono, 3 rotti: congiunzione, primo passo troppo lungo, nessun passo riconosciuto) tutti come atteso dopo una correzione del caso di test stesso (non del codice); manipolazione diretta: stesso input rotto, `pass=false` con il controllo → `pass=true` senza (script usa-e-getta, cancellato) |
| Stato | `CANDIDATE` — 0 uso reale in produzione finora |

---

## fs_error_detection_duplicate_check

| Campo | Valore |
|---|---|
| Dominio applicato | `flashcards` |
| File | `src/lib/flashcardDuplicateCheck.ts` |
| Call site | `src/pages/Flashcards.tsx` (`generate()`, prima di `addFlashcards()`) |
| Cosa verifica | Che il modello abbia davvero rispettato l'istruzione "non ripetere le flashcard esistenti" già nel prompt (`FLASHCARDS_PROMPT`) — confronto testuale normalizzato contro i front esistenti E contro il resto del batch appena generato |
| Modalità | **Agisce davvero** (non solo log): scarta le card duplicate prima di salvarle — sicuro per costruzione, un duplicato normalizzato è ridondante per definizione, non può mai scartare una card legittima |
| Test causale | ✅ 2026-08-25 — 4 casi noti (nuove, duplicato esatto, duplicato case-insensitive, duplicato interno al batch) tutti come atteso; manipolazione diretta: stessa card duplicata, `keep=0` con il controllo → `keep=1` senza (script usa-e-getta, cancellato) |
| Stato | `CANDIDATE` — 0 uso reale in produzione finora |

---

## fs_uncertainty_disclosure_check

| Campo | Valore |
|---|---|
| Dominio applicato | `material_chat` |
| File | `src/lib/uncertaintyDisclosureCheck.ts` |
| Call site | `src/components/materials/MaterialAskPanel.tsx` (`send()`, dopo `askAboutMaterial()`) |
| Cosa verifica | Generalizza `seed_material_chat_honesty`: quando `getMaterialText()` ha già detto (indipendentemente dal modello) che il contenuto non è disponibile, la risposta contiene davvero una frase di dichiarazione del limite? Regex su frasi italiane tipiche |
| Modalità | **Log-only, mai blocca** — proxy grezzo (una frase può soddisfare la lettera senza lo spirito), dichiarato esplicitamente nel codice |
| Test causale | ✅ 2026-08-25 — 3 casi noti (contenuto disponibile, non disponibile+onesto, non disponibile+disonesto) come atteso; manipolazione diretta confermata |
| Stato | `CANDIDATE` — 0 uso reale |

---

## fs_contradiction_check

| Campo | Valore |
|---|---|
| Dominio applicato | `chapters` (flusso "Continua" su documenti lunghi) |
| File | `src/lib/chapterContinuationCheck.ts` |
| Call site | `src/components/materials/ChaptersPanel.tsx` (`continueDetect()`) |
| Cosa verifica | Il modello riceve esplicitamente `lastEndPage` come vincolo nel prompt di continuazione — questo controlla se il nuovo primo capitolo lo rispetta davvero: non un caso sintetico ma il vero punto del codice dove il modello riceve un fatto e deve costruirci sopra senza contraddirlo |
| Modalità | Log-only — un'eventuale violazione è già silenziosamente clampata da `generateChapters()`; questo la rende visibile come contraddizione reale invece che invisibile |
| Test causale | ✅ 2026-08-25 — 3 casi noti come atteso; manipolazione diretta confermata |
| Stato | `CANDIDATE` — 0 uso reale |

---

## fs_targeted_error_correction

| Campo | Valore |
|---|---|
| Dominio applicato | `flashcards` |
| File | `src/lib/flashcardDuplicateCheck.ts` (`frontsToAvoidForRetry`, `mergeCorrectedBatch`) |
| Call site | `src/pages/Flashcards.tsx` (`generate()`, dopo il check duplicati) |
| Cosa verifica/fa | **Dipende da `fs_error_detection_duplicate_check`**, come previsto dal grafo di dipendenze della tassonomia: se ci sono duplicati scartati, tenta UN retry mirato (solo per gli slot mancanti, evitando sia i front originali sia quelli appena tenuti), poi riapplica lo stesso check sul risultato |
| Modalità | Agisce davvero — recupera card altrimenti perse |
| Test causale | ✅ 2026-08-25 — sulla logica pura di pianificazione/merge (avoid-list, filtro del retry); **la vera chiamata Gemini del retry NON è coperta dal test causale**, dichiarato esplicitamente — uno script usa-e-getta non doveva né poteva chiamare l'API reale |
| Stato | `CANDIDATE` — 0 uso reale |

---

## fs_cite_before_claim

| Campo | Valore |
|---|---|
| Dominio applicato | `material_chat` |
| File | `src/lib/evidenceGroundingCheck.ts` |
| Call site | `src/components/materials/MaterialAskPanel.tsx` (`send()`, solo quando il contenuto è disponibile) |
| Cosa verifica | Il più debole e stretto dei 7 per disegno esplicito: solo numeri (≥2 cifre) citati nella risposta, controllati per presenza letterale nel testo sorgente reale. Niente giudizio semantico su parafrasi/claim generici — richiederebbe NLP vera, fuori scope |
| Modalità | **Log-only, mai blocca** |
| Test causale | ✅ 2026-08-25 — 3 casi noti come atteso; manipolazione diretta confermata |
| Stato | `CANDIDATE` — 0 uso reale |

---

