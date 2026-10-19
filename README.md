# PONY84

Groovebox ispirata a Elektron Model:Cycles e alla Roland SP-404, con i colori della 808.
Motori FM e sample → sequencer a 16 step → scatter, delay, riverbero e mixer a 6 canali.

## Struttura

- `web/guide/` — la guida completa (italiano/inglese), online su `/guide/`.
- `web/vendor/movewire/` — libreria movewire 0.1.0 di Aureliano Bergese (MIT) per l'Ableton Move.
- `web/` — la webapp giocabile (un solo file `index.html`, Web Audio API). È la cartella che pubblica Cloudflare.
- `prototype/` — il prototipo Python che genera un groove in `groove.wav`.
- `prototype/samples/` — i WAV per il motore SAMPLE.

## Provare la webapp

Online: **https://app.sadponygirl.com** (anche https://pony84.raptuzbass.workers.dev) (la guida è su `/guide/`). In locale: apri `web/index.html` nel browser.

- **Tracce**: 6 tracce, ognuna assegnabile a KICK, SNARE, METAL, PERC, TONE o SAMPLE.
- **WAVE** (motore SAMPLE): editor della forma d'onda con maniglie START/END, zoom fino a 64× e ascolto; in P-LOCK i punti valgono per il singolo step. Su Android, CARICA WAV permette anche di registrare un audio al momento.
- **STEP**: tocca gli step per accenderli.
- **P-LOCK**: scegli uno step e gira le manopole per dargli valori propri.
- **PROB**: tocca uno step acceso per cambiare quando suona: sempre → 75% → 50% → 25% → 1:2 → 2:2 → 1:4 → 4:4 (1:2 = prima battuta ogni due, 4:4 = quarta battuta ogni quattro).
- **PATTERN**: 128 pattern in 8 banchi (A–H × 16). Scegli il banco nella fila A…H e il pattern con i 16 tasti; durante la riproduzione il cambio avviene a fine battuta. **COPIA / INCOLLA** copia un pattern intero (in PATTERN) o una sola traccia (in STEP), con conferma prima di sovrascrivere.
- **FX**: BPM, swing, delay, riverbero, drive e volume master.
- **SCATTER**: tieni premuto un pad (o attiva LATCH): REPEAT, STUTTER, REVERSE, GATE, TAPESTOP, RANDOM.
- **MIXER · CANALI**: volume, pan, mandata delay, mute/solo; il tasto sotto il nome sceglie l'uscita del canale: MAIN o BUS A/B/C.
- **MIXER · BUS · FX**: 3 bus (A, B, C) più MASTER, ognuno con 3 slot di effetti: FILTER (DJ, con LFO a tempo), SIDECHAIN (pompa con la traccia scelta), LO-FI, VINYL, DRIVE, CHORUS, TAPE ECHO, ISOLATOR, REVERB. I bus hanno volume e mute; il MASTER lavora su tutto il mix dopo lo scatter.
- **TAP / BPM**: tocca TAP a tempo, oppure trascina su e giù il numero dei BPM sul display.
- **ROLL**: pad da suonare. KEYS = note del motore della traccia scelta (scala, tonica, ottava); KIT = le 6 tracce. RIPETI ripete la nota a tempo finché tieni premuto; in alto sul pad suona più forte. REC registra nel pattern.
- **Viste**: sul telefono SEQ → MIXER → ROLL con i tab o con lo swipe verso destra. Su tablet in orizzontale e PC (almeno 900×600) le tre viste sono affiancate.
- **Tastiera (PC)**: barra spaziatrice = play/pausa.

- **Menu PROGETTO & MIDI**: tocca il logo PONY84.
  - **Esporta / Importa**: file `.pony84` con pattern, suoni, mixer, effetti e WAV, da riaprire su qualsiasi dispositivo.
  - **Nuovo vuoto / Nuovo da demo**: due tocchi per confermare.
  - **Skin**: 808 oppure SAD PONY GIRL (giallo acido, maschere rosa, display VHS in stile weirdcore/nostalgiacore). La scelta resta salvata.
  - **Controller MIDI** (Chrome su PC e Android, sul telefono con adattatore USB-C OTG): pad sul canale 10 (note 36–41) → tracce 1–6; tastiera sugli altri canali → note della traccia scelta (C4 = intonazione della traccia); CC 70–77 → le 8 manopole della pagina aperta; program change 1–128 → pattern A01–H16; Start/Stop MIDI → play/stop. Con **MIDI LEARN** tocchi una manopola o un fader e muovi un controllo del controller per assegnarlo.
  - **Ableton Move**: COLLEGA MOVE trasforma la Move nel controller di PONY84 (step, pad, encoder, LED), grazie a [movewire](https://github.com/auridevil/movewire) di Auri, incluso in `web/vendor/movewire/` (licenza MIT). Mappatura completa nella guida.

Il progetto e i WAV caricati vengono salvati nel browser in automatico.

## Prototipo Python

```
cd prototype
pip install numpy
python groovebox.py
```

## Pubblicare su Cloudflare

Il sito è un Worker di Cloudflare con soli file statici, collegato a questo repository: ogni commit su `main` viene pubblicato da solo in circa mezzo minuto (scheda *Deployments* nella dashboard di Cloudflare).

- La configurazione è in `wrangler.jsonc`: nome del Worker (`pony84`) e cartella da pubblicare (`web`). Non serve nessun comando di build.
- Le richieste ai file statici non hanno costi né limiti mensili sul piano gratuito.
- Nota: progetto, WAV e mappature MIDI salvati nel browser sono legati all'indirizzo del sito. Cambiando indirizzo, usa ESPORTA FILE sul vecchio e IMPORTA FILE sul nuovo.
