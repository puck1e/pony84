# Novità di PONY84

Registro dei rilasci, dal più recente. Versione online: https://app.sadponygirl.com/novita/

## PonyDrone v0.1.0 — 2026-10-20 · Il nastro che suona da solo

Seconda app dell'ecosistema, in `web/drone/`, online su https://app.sadponygirl.com/drone/. Versione indipendente da PONY84.

- **Nuovo**: nastro da 45 s: WAV, microfono (REC, OVERDUB, FREEZE; senza cancellazione d'eco, riduzione del rumore e guadagno automatico) o suoni di PONY84.
- **Nuovo**: motore GRANI e GLITCH, 4 varianti ciascuno; macro ATTIVITÀ, RIPETI, FORMA, TEMPO, CAOS; pad XY con due macro per algoritmo; TEMPO libero o a divisioni di BPM.
- **Nuovo**: pedaliera da 3–4 slot: TAPE, VHS, FILTRO, BITCRUSH, con bypass.
- **Nuovo**: SPAZIO (riverbero FDN 2–20 s con freeze), MIX, LIVELLO, limiter sempre attivo; STOP = tape stop.
- **Nuovo**: rocchetti animati dalla telemetria del worklet; scene `.ponydrone` (formato `ver` 1), export WAV 1–10 min, PWA con service worker su `/drone/`.

## v0.12.0 — 2026-10-20 · Arriva PonyDrone

- **Nuovo**: link a PonyDrone nel menu PROGETTO & MIDI.
- **Nuovo**: ponte con PonyDrone su `BroadcastChannel('pony')`: i WAV registrati (LOOP e JAM LIBERA) arrivano a PonyDrone aperto in un'altra scheda; BPM, play e stop vengono inviati a ogni cambio.
- **Fix**: il service worker di PONY84 ignora le richieste sotto `/drone/` (PonyDrone ha il suo).

## v0.11.0 — 2026-10-20 · La cassa con la punta

- **Meglio**: SWEEP della KICK fino a +72 semitoni (prima +38): l'attacco parte dai kHz e dà il tick, poi scende sulla pancia. Il display mostra i semitoni.
- **Meglio**: CONTOUR della KICK esponenziale da 0,8 a 150 ms (prima 5–105 ms lineare).
- **Meglio**: la KICK attacca in 0,2 ms invece di 2: il transiente non viene smussato.
- **Fix**: progetti e file .pony84 precedenti convertiti (formato `ver` 3): SWEEP e CONTOUR della KICK, p-lock compresi, ricalcolati perché la cassa suoni come prima.

## v0.10.0 — 2026-10-20 · Pattern lunghi

- **Nuovo**: pattern fino a 64 step (pagine 1–4 sopra gli step); allungando, le pagine vuote nascono come copia delle precedenti; tieni premuto per accorciare (le pagine tolte non si perdono).
- **Nuovo**: SEGUI, la vista segue la pagina in riproduzione; Shift + ◀ ▶ sulla Move cambia pagina.
- **Meglio**: le condizioni 1:2, 1:4… contano i giri del pattern; il cambio di pattern avviene a fine pattern. I progetti salvati diventano pattern da 1 pagina e suonano identici.

## v0.9.1 — 2026-10-20 · Più comoda da suonare

- **Nuovo**: tieni premuta una traccia per metterla in mute; riparte al rilascio.
- **Meglio**: su ROLL e SCATTER il dito può scivolare da un pad all'altro (Android).
- **Fix**: su Mac le manopole (e fader, BPM) restavano agganciate al mouse dopo il rilascio.

## v0.9.0 — 2026-10-19 · Annulla e registra

- **Nuovo**: **Annulla e ripeti** (↶ ↷ accanto a TAP, 60 passi; Ctrl+Z / Ctrl+Maiusc+Z; Undo e Shift+Undo sulla Move).
- **Nuovo**: **Registra WAV** nel menu PROGETTO: LOOP di 1/2/4/8 battute esatte o JAM LIBERA (max 5 minuti), WAV 16 bit stereo; Capture / Shift+Capture sulla Move.

## v0.8.0 — 2026-10-19 · Velocity e meno click

- **Nuovo**: **Velocity per step**: in STEP trascina su o giù su uno step; in P-LOCK la manopola DELAY diventa `VEL`. Una barretta nello step mostra i colpi piano.
- **Meglio**: I colpi piano sono anche più scuri, su tutte le machine: ghost note e accenti più naturali.
- **Fix**: Meno click in cuffia: lo SCATTER gira sul thread dell'audio (AudioWorklet); il colpo nuovo su KICK, SNARE, METAL e PERC chiude in 4 ms la coda del precedente; nel SYNTH la voce rubata sfuma invece di sparire.
- **Nuovo**: Menu PROGETTO, sezione `AUDIO`: BASSA LATENZA o STABILE.

## v0.7.1 — 2026-10-19 · Licenza e crediti

- **Sito**: PONY84 è open source con **licenza MIT** (file `LICENSE`). In fondo al menu PROGETTO: © e link alla pagina Crediti e licenze (`/crediti/`).

## v0.7.0 — 2026-10-19 · PONY84 diventa un'app

- **Nuovo**: **PONY84 si installa come app**: tasto `INSTALLA L'APP` nel menu PROGETTO, icona con la maschera da luchador, apertura a tutto schermo.
- **Nuovo**: **Funziona senza internet**: app, guida e novità restano disponibili offline; gli aggiornamenti arrivano da soli quando torni online.
- **Meglio**: Mentre il sequencer suona lo schermo resta acceso.

## v0.6.0 — 2026-10-19 · Nuovi suoni: SYNTH, decay e WAVE

- **Nuovo**: `SYNTH` al posto di TONE, con quattro modelli: **FM2** (il TONE di prima), **FM4** (4 operatori, algoritmi e feedback), **CZ** (phase distortion stile Casio) e **MOD** (modale: marimba, campana, metallo, vetro, tamburo).
- **Nuovo**: Editor `WAVE`: **E prima di S = suono al contrario**, anche su singoli step in P-LOCK.
- **Meglio**: Editor WAVE più immediato: zoom a due dita e scorrimento, ascolto automatico quando lasci la maniglia, AGGANCIO ZERO contro i clic, PITCH/DECAY/FILTER/GAIN nell'editor, interruttore TRACCIA / STEP.
- **Fix**: `DECAY` a 0 ora è un "tic" di 3–4 ms su tutte le machine (prima restavano da 70 a 350 ms).
- **Meglio**: I progetti salvati si aggiornano da soli e suonano come prima.
- **Nuovo**: Laboratorio dei motori su /lab/: confronto dei modelli e test di carico.

## v0.5.1 — 2026-10-19 · Nuova casa

- **Sito**: PONY84 si trasferisce su **app.sadponygirl.com** (Cloudflare). Per portarti i progetti: ESPORTA FILE dal vecchio indirizzo, IMPORTA FILE sul nuovo.

## v0.5.0 — 2026-10-17 · Ableton Move e skin Sad Pony Girl

- **Nuovo**: **Ableton Move** come controller (step, pad, encoder, tasti e LED) grazie a movewire di Auri.
- **Nuovo**: Skin **SAD PONY GIRL**: giallo "Guerrilla", maschere rosa, display VHS. Si sceglie nel menu PROGETTO.

## v0.4.0 — 2026-10-17 · Banchi e campioni

- **Nuovo**: **128 pattern** in 8 banchi A–H, con COPIA / INCOLLA di pattern e tracce.
- **Nuovo**: Editor `WAVE` in stile MPC: START ed END sulla forma d'onda, zoom e ascolto.
- **Meglio**: Il sequencer resta nello stesso punto in tutte le modalità.
- **Meglio**: Su Android CARICA WAV permette anche di registrare un audio al volo.

## v0.3.0 — 2026-10-17 · Progetto, MIDI e mixer

- **Nuovo**: Menu `PROGETTO & MIDI`: esporta e importa file .pony84, nuovo progetto, WAV salvati nel browser.
- **Nuovo**: Controller MIDI con MIDI LEARN.
- **Nuovo**: Mixer con **3 BUS + MASTER** e catene di 3 effetti: filter, sidechain, lo-fi, vinyl, drive, chorus, tape echo, isolator, reverb.
- **Nuovo**: Guida completa in italiano e inglese.

## v0.2.0 — 2026-10-17 · Sul telefono e dal vivo

- **Meglio**: Schermata che si adatta al telefono; BPM trascinabile sul display e `TAP`.
- **Nuovo**: `ROLL`: pad KEYS e KIT con scale, ripetizione a tempo e registrazione.
- **Nuovo**: Vista larga per tablet e PC: SEQ, ROLL e MIXER affiancati.
- **Meglio**: Demo minimal techno alla prima apertura; COND diventa `PROB`, TRIG diventa `STEP`.

## v0.1.0 — 2026-10-16 · La prima webapp

- **Nuovo**: 6 tracce con motori FM e SAMPLE, sequencer a 16 step con P-LOCK e condizioni.
- **Nuovo**: `SCATTER` in stile SP-404, delay e riverbero globali, mixer a 6 canali. Colori della 808.
