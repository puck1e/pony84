# PONY84

Groovebox ispirata a Elektron Model:Cycles e alla Roland SP-404, con i colori della 808.
Motori FM e sample → sequencer a 16 step → scatter, delay, riverbero e mixer a 6 canali.

## Struttura

- `web/` — la webapp giocabile (un solo file `index.html`, Web Audio API). È la cartella che pubblica Netlify.
- `prototype/` — il prototipo Python che genera un groove in `groove.wav`.
- `prototype/samples/` — i WAV per il motore SAMPLE.

## Provare la webapp

Apri `web/index.html` nel browser, oppure pubblicala con Netlify (vedi sotto) e aprila dal telefono.

- **Tracce**: 6 tracce, ognuna assegnabile a KICK, SNARE, METAL, PERC, TONE o SAMPLE.
- **TRIG**: tocca gli step per accenderli.
- **P-LOCK**: scegli uno step e gira le manopole per dargli valori propri.
- **PROB**: tocca uno step acceso per cambiare quando suona: sempre → 75% → 50% → 25% → 1:2 → 2:2 → 1:4 → 4:4 (1:2 = prima battuta ogni due, 4:4 = quarta battuta ogni quattro).
- **PATTERN**: i 16 tasti diventano i pattern A01–A16; durante la riproduzione il cambio avviene a fine battuta.
- **FX**: BPM, swing, delay, riverbero, drive e volume master.
- **SCATTER**: tieni premuto un pad (o attiva LATCH): REPEAT, STUTTER, REVERSE, GATE, TAPESTOP, RANDOM.
- **TAP / BPM**: tocca TAP a tempo, oppure trascina su e giù il numero dei BPM sul display.
- **ROLL**: pad da suonare. KEYS = note del motore della traccia scelta (scala, tonica, ottava); KIT = le 6 tracce. RIPETI ripete la nota a tempo finché tieni premuto; in alto sul pad suona più forte. REC registra nel pattern.
- **Viste**: sul telefono SEQ → MIXER → ROLL con i tab o con lo swipe verso destra. Su tablet in orizzontale e PC (almeno 900×600) le tre viste sono affiancate.
- **Tastiera (PC)**: barra spaziatrice = play/pausa.

Il progetto viene salvato nel browser; i WAV caricati vanno ricaricati a ogni apertura.

## Prototipo Python

```
cd prototype
pip install numpy
python groovebox.py
```

## Pubblicare su Netlify

Collega il repository su Netlify ("Add new site" → "Import an existing project"): la cartella da pubblicare (`web`) è già indicata in `netlify.toml`, non serve nessun comando di build.
