"""
Prototipo groovebox - fase 1
Catena: MACHINE (sintesi FM) -> SEQUENCER (p-lock, probabilità, condizioni) -> EFFETTI (delay + saturazione)
Genera un file WAV di 8 battute. 6 tracce, ognuna assegnabile a un motore
(KICK, SNARE, METAL, PERC, TONE, SAMPLE). I WAV per il motore SAMPLE vanno
nella cartella "samples" accanto a questo script.

Requisiti:  pip install numpy
Uso:        python groovebox.py
"""
import random
import wave
import numpy as np

SR = 44100          # sample rate (campioni al secondo)
BPM = 120
STEPS = 16          # step per battuta (sedicesimi)
BARS = 8            # battute da generare
SWING = 0.15        # 0 = dritto, ~0.33 = terzinato
STEP_SEC = 60 / BPM / 4
random.seed(7)      # cambia il numero per un'altra "estrazione" delle probabilità


# =====================================================================
# 1) MACHINE - motori di sintesi
# =====================================================================
def inviluppo(n, decay):
    """Inviluppo esponenziale: parte da 1 e scende a zero."""
    t = np.arange(n) / SR
    return np.exp(-t / max(decay, 1e-4))


def voce_fm(freq, ratio, indice, decay, sweep=0.0, sweep_t=0.03):
    """
    Voce FM a 2 operatori (il cuore di tutte le machine).
    freq   = frequenza della portante
    ratio  = rapporto modulante/portante (numeri non interi = suono metallico)
    indice = quantità di modulazione (più alto = più armoniche, più "sporco")
    sweep  = caduta di pitch iniziale (fondamentale per la cassa)
    """
    n = int(max(decay * 6, 0.05) * SR)
    t = np.arange(n) / SR
    f = freq * (1 + sweep * np.exp(-t / sweep_t))
    fase = 2 * np.pi * np.cumsum(f) / SR
    mod = np.sin(fase * ratio) * indice * inviluppo(n, decay * 0.4)
    return np.sin(fase + mod) * inviluppo(n, decay)


def rumore(n, decay):
    """Rumore bianco passa-alto, per snare e piatti."""
    r = np.random.uniform(-1, 1, n)
    hp = np.concatenate(([0.0], np.diff(r))) * 0.5
    return hp * inviluppo(n, decay)


def kick(p):
    return voce_fm(p["pitch"], 1.0, p["color"], p["decay"], sweep=p["sweep"])


def snare(p):
    corpo = voce_fm(p["pitch"], 1.5, p["color"], p["decay"] * 0.6)
    return 0.5 * corpo + 0.7 * rumore(len(corpo), p["decay"])


def metal(p):
    tono = voce_fm(p["pitch"], 1.414, p["color"], p["decay"])
    return 0.6 * tono + 0.4 * rumore(len(tono), p["decay"] * 0.7)


def perc(p):
    return voce_fm(p["pitch"], 2.76, p["color"], p["decay"], sweep=p["sweep"], sweep_t=0.01)


def tone(p):
    freq = 440 * 2 ** ((p["note"] - 69) / 12)   # nota MIDI -> Hz
    return voce_fm(freq, 2.0, p["color"], p["decay"])


# ---------- motore SAMPLE ----------
_cache_wav = {}


def carica_wav(percorso):
    """Legge un WAV (8/16/24/32 bit int, mono o stereo) e lo converte in mono a SR."""
    if percorso in _cache_wav:
        return _cache_wav[percorso]
    try:
        with wave.open(percorso, "rb") as f:
            canali, larg, sr = f.getnchannels(), f.getsampwidth(), f.getframerate()
            raw = f.readframes(f.getnframes())
    except FileNotFoundError:
        print(f"[SAMPLE] file non trovato: {percorso}")
        _cache_wav[percorso] = None
        return None
    except wave.Error as err:
        print(f"[SAMPLE] formato non supportato ({err}): {percorso} - esportalo come WAV 16 o 24 bit")
        _cache_wav[percorso] = None
        return None

    if larg == 1:
        x = (np.frombuffer(raw, np.uint8).astype(float) - 128) / 128
    elif larg == 2:
        x = np.frombuffer(raw, "<i2") / 32768
    elif larg == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        i = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        x = np.where(i >= 1 << 23, i - (1 << 24), i) / (1 << 23)
    else:
        x = np.frombuffer(raw, "<i4") / 2 ** 31
    x = x.reshape(-1, canali).mean(axis=1)              # stereo -> mono
    if sr != SR:                                        # adatta il sample rate
        x = np.interp(np.arange(0, len(x), sr / SR), np.arange(len(x)), x)
    _cache_wav[percorso] = x
    return x


def sample(p):
    """
    file    = percorso del WAV
    pitch   = semitoni (+12 = un'ottava sopra, più veloce)
    start   = punto di partenza 0..1
    length  = quanta parte suonare 0..1
    decay   = inviluppo in secondi (0 = suona tutto il pezzo)
    reverse = True per suonarlo al contrario
    """
    x = carica_wav(p["file"])
    if x is None:
        return np.zeros(1)
    a = int(p["start"] * len(x))
    b = a + max(int(p["length"] * len(x)), 1)
    pezzo = x[a:b]
    if p["reverse"]:
        pezzo = pezzo[::-1]
    passo = 2 ** (p["pitch"] / 12)
    out = np.interp(np.arange(0, len(pezzo), passo), np.arange(len(pezzo)), pezzo)
    if p["decay"] > 0:
        out = out * inviluppo(len(out), p["decay"])
    return sfuma(out)


MACHINE = {"KICK": kick, "SNARE": snare, "METAL": metal, "PERC": perc, "TONE": tone, "SAMPLE": sample}

# Parametri di base di ogni motore: una traccia parte da questi,
# poi "default" della traccia e i parameter lock li sovrascrivono.
DEFAULT_MOTORE = {
    "KICK":   {"pitch": 48, "color": 1.2, "decay": 0.35, "sweep": 3.0},
    "SNARE":  {"pitch": 190, "color": 1.0, "decay": 0.12},
    "METAL":  {"pitch": 620, "color": 3.5, "decay": 0.04},
    "PERC":   {"pitch": 330, "color": 2.0, "decay": 0.08, "sweep": 1.5},
    "TONE":   {"note": 36, "color": 1.5, "decay": 0.18},
    "SAMPLE": {"file": "samples/stab_01.wav", "pitch": 0, "start": 0.0, "length": 1.0,
               "decay": 0.0, "reverse": False},
}


# =====================================================================
# 2) PATTERN - qui si "programma" il groove
#    steps = {numero_step: {parameter lock}}
#    lock speciali:  "prob": 0..1        probabilità che suoni
#                    "cond": (a, b)      trig condition a:b (suona alla battuta a ogni b)
#                    "level": 0..1       volume di quello step
#
#    "machine" sceglie il motore: KICK, SNARE, METAL, PERC, TONE o SAMPLE.
#    Ogni traccia può usare qualsiasi motore: anche 6 KICK, se vuoi.
#    "level", "send" e "mute" sono il canale del mixer.
# =====================================================================
TRACCE = [
    {"machine": "KICK", "level": 1.0, "send": 0.0, "mute": False,
     "default": {},
     "steps": {0: {}, 4: {}, 8: {}, 12: {},
               14: {"prob": 0.5, "decay": 0.12, "level": 0.7}}},

    {"machine": "SNARE", "level": 0.8, "send": 0.15, "mute": False,
     "default": {},
     "steps": {4: {}, 12: {},
               15: {"cond": (4, 4), "level": 0.5, "decay": 0.06}}},   # fill solo nella 4ª battuta

    {"machine": "METAL", "level": 0.35, "send": 0.1, "mute": False,
     "default": {},
     "steps": {**{s: ({"prob": 0.7, "color": 6.0} if s % 4 == 2 else {}) for s in range(0, 16, 2)},
               11: {"decay": 0.15}}},

    {"machine": "PERC", "level": 0.4, "send": 0.25, "mute": False,
     "default": {},
     "steps": {3: {}, 7: {"pitch": 440}, 9: {}, 13: {"pitch": 260, "prob": 0.6}}},

    {"machine": "TONE", "level": 0.6, "send": 0.35, "mute": False,
     "default": {},
     "steps": {0: {}, 3: {}, 6: {"note": 39},
               10: {"note": 43, "color": 3.0},
               13: {"cond": (1, 2), "note": 48, "decay": 0.08},     # suona una battuta sì e una no
               14: {"note": 41}}},

    {"machine": "SAMPLE", "level": 0.45, "send": 0.4, "mute": False,
     "default": {"file": "samples/stab_01.wav"},
     "steps": {2: {"decay": 0.2},
               8: {"cond": (2, 2), "pitch": -5},                    # battute pari, una quarta sotto
               11: {"reverse": True, "length": 0.5, "prob": 0.5}}},
]

# Esempio: 6 cassa diverse? Basta cambiare "machine" in "KICK" su ogni traccia
# e differenziarle con "default", ad esempio {"pitch": 40, "decay": 0.6}.


# =====================================================================
# 3) SEQUENCER - posiziona i suoni nel tempo
# =====================================================================
def render():
    n_tot = int((BARS * STEPS * STEP_SEC + 3.0) * SR)   # +3 s di coda per il delay
    dry = np.zeros(n_tot)
    send = np.zeros(n_tot)

    for bar in range(BARS):
        for step in range(STEPS):
            t = (bar * STEPS + step) * STEP_SEC
            if step % 2 == 1:                 # swing sugli step dispari
                t += SWING * STEP_SEC
            inizio = int(t * SR)

            for tr in TRACCE:
                if tr.get("mute"):
                    continue
                lock = tr["steps"].get(step)
                if lock is None:
                    continue
                if random.random() > lock.get("prob", 1.0):
                    continue
                cond = lock.get("cond")
                if cond and bar % cond[1] != cond[0] - 1:
                    continue

                # motore -> impostazioni della traccia -> parameter lock dello step
                p = {**DEFAULT_MOTORE[tr["machine"]], **tr.get("default", {}), **lock}
                suono = MACHINE[tr["machine"]](p) * tr["level"] * lock.get("level", 1.0)
                fine = min(inizio + len(suono), n_tot)
                suono = suono[:fine - inizio]
                dry[inizio:fine] += suono
                send[inizio:fine] += suono * tr["send"]
    return dry, send


# =====================================================================
# 4) EFFETTI
# =====================================================================
def delay(x, tempo, feedback=0.45):
    """Delay con feedback: restituisce solo le ripetizioni (segnale wet)."""
    d = int(tempo * SR)
    y = x.copy()
    for s in range(d, len(y), d):
        e = min(s + d, len(y))
        y[s:e] += feedback * y[s - d:e - d]
    return y - x


# =====================================================================
# 5) SCATTER - stutter / re-trigger sul master
#    Ogni evento: (battuta, step, durata_in_step, tipo)   [battute contate da 0]
#    "repeat"   ripete in loop un frammento da 1/16
#    "roll"     frammenti sempre più corti: 1/8 -> 1/16 -> 1/32 -> 1/64
#    "reverse"  ripete un frammento da 1/8 suonato al contrario
#    "gate"     taglia il suono a ritmo di 1/32
#    "tapestop" rallenta fino a fermarsi, come un nastro
# =====================================================================
SCATTER = [
    (1, 12, 4, "repeat"),
    (3, 8, 8, "roll"),
    (5, 4, 4, "reverse"),
    (5, 12, 4, "gate"),
    (7, 8, 8, "tapestop"),
]


def sfuma(x, ms=2):
    """Micro-dissolvenza ai bordi per evitare click nei loop."""
    x = x.copy()
    n = min(int(ms / 1000 * SR), len(x) // 2)
    if n > 0:
        r = np.linspace(0, 1, n)
        x[:n] *= r
        x[-n:] *= r[::-1]
    return x


def ripeti(frammento, n):
    frammento = sfuma(frammento)
    volte = int(np.ceil(n / len(frammento)))
    return np.tile(frammento, volte)[:n]


def scatter(x):
    y = x.copy()
    sedicesimo = int(STEP_SEC * SR)
    for bar, step, durata, tipo in SCATTER:
        s = int((bar * STEPS + step) * STEP_SEC * SR)
        n = durata * sedicesimo
        if s + n > len(x):
            continue
        if tipo == "repeat":
            y[s:s + n] = ripeti(x[s:s + sedicesimo], n)
        elif tipo == "reverse":
            y[s:s + n] = ripeti(x[s:s + 2 * sedicesimo][::-1], n)
        elif tipo == "roll":
            lunghezze = [2 * sedicesimo, sedicesimo, sedicesimo // 2, sedicesimo // 4]
            tratto = n // 4
            for i, L in enumerate(lunghezze):
                a = s + i * tratto
                b = s + n if i == 3 else a + tratto
                y[a:b] = ripeti(x[s:s + L], b - a)
        elif tipo == "gate":
            periodo = sedicesimo // 2
            maschera = ((np.arange(n) % periodo) < periodo // 2).astype(float)
            maschera = np.convolve(maschera, np.ones(64) / 64, mode="same")
            y[s:s + n] = x[s:s + n] * maschera
        elif tipo == "tapestop":
            velocita = np.linspace(1, 0, n)
            posizione = np.cumsum(velocita)
            y[s:s + n] = np.interp(posizione, np.arange(n), x[s:s + n])
    return y


def master(mix, drive=1.8):
    mix = np.tanh(mix * drive) / np.tanh(drive)   # saturazione morbida
    return mix / np.max(np.abs(mix)) * 0.9


def salva_wav(nome, x):
    dati = (x * 32767).astype(np.int16)
    with wave.open(nome, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(dati.tobytes())


if __name__ == "__main__":
    dry, send = render()
    wet = delay(send, tempo=3 * STEP_SEC)          # delay a 3/16
    mix = scatter(dry + 0.6 * wet)                 # scatter prima della saturazione
    salva_wav("groove.wav", master(mix))
    print("Fatto: groove.wav")
