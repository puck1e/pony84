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
- **COND**: tocca uno step acceso per cambiare la condizione (50%, 25%, 75%, 1:2, 2:2, 1:4, 4:4).
- **PATTERN**: i 16 tasti diventano i pattern A01–A16; durante la riproduzione il cambio avviene a fine battuta.
- **FX**: BPM, swing, delay, riverbero, drive e volume master.
- **SCATTER**: tieni premuto un pad (o attiva LATCH).
- **MIXER**: swipe verso destra, oppure il tab MIXER.

Il progetto viene salvato nel browser; i WAV caricati vanno ricaricati a ogni apertura.

## Prototipo Python

```
cd prototype
pip install numpy
python groovebox.py
```

## Pubblicare su Netlify

Collega il repository su Netlify ("Add new site" → "Import an existing project"): la cartella da pubblicare (`web`) è già indicata in `netlify.toml`, non serve nessun comando di build.
