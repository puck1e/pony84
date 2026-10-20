// PonyDrone · motore audio (AudioWorklet)
// Un solo processor fa tutto quello che lavora campione per campione:
// SORGENTE (buffer circolare 45 s) → MOTORE (GRANI / GLITCH + eco di RIPETI) → PEDALIERA (4 slot)
// → SPAZIO (riverbero FDN con freeze) → MIX dry/wet → DC blocker → soft clip → LIVELLO.
// Regola: niente allocazioni dentro process(). Tutti gli array nascono nel costruttore;
// l'unica eccezione sono i messaggi verso il main thread (telemetria, ~50 al secondo).

const NG = 32;              // grani simultanei al massimo
const OVW = 512;            // colonne della forma d'onda del buffer
const CAP_S = 45;           // secondi di buffer
const TELE_EVERY = 8;       // blocchi tra due messaggi di telemetria (~21 ms a 48 kHz)
const DL = 4096;            // delay line dei pedali (potenza di 2): 85 ms a 48 kHz, 42 ms a 96 kHz
const DLM = DL - 1;
const FX = { none: 0, tape: 1, vhs: 2, filtro: 3, bitcrush: 4 };

// divisioni in battiti (TEMPO sincronizzato)
const DIV_GRANI = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4];    // 1/64 … 1/1 di nota
const DIV_GLITCH = [1 / 8, 1 / 4, 1 / 2, 1, 2];              // 1/32 … 1/2 di nota

let seed = 0x2545f491;
function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
const bip = () => rnd() * 2 - 1;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
function p2(n) { let x = 1; while (x < n) x <<= 1; return x; }

// rumore lento: un valore casuale nuovo ogni `hold` campioni, raggiunto con un filtro a un polo (S&H filtrato)
class SlowNoise {
  constructor() { this.v = 0; this.t = 0; this.c = 0; }
  next(holdS, glideS, sr) {
    if (--this.c <= 0) { this.t = bip(); this.c = Math.max(1, Math.round(holdS * sr * (0.6 + 0.8 * rnd()))); }
    this.v += (this.t - this.v) * (1 / (glideS * sr + 1));
    return this.v;
  }
  reset() { this.v = 0; this.t = 0; this.c = 0; }
}

class Slot {
  constructor(sr) {
    this.type = FX.none; this.byp = false; this.mix = 1;   // mix: 1 = attivo, 0 = bypass (dissolvenza di 10 ms)
    this.dL = new Float32Array(DL); this.dR = new Float32Array(DL); this.w = 0;
    this.n1 = new SlowNoise(); this.n2 = new SlowNoise(); this.n3 = new SlowNoise();
    this.ph1 = 0; this.ph2 = 0;
    this.s = new Float64Array(12);   // stati dei filtri
    this.drop = 0; this.dropG = 1; this.dropT = 1;
    this.hold = 0; this.holdL = 0; this.holdR = 0;
    this.fc = 1000;
    this.sa = -1; this.sb = 0; this.sc = 0;   // manopole lisciate
    this.tele1 = 0; this.tele2 = 0;
    this.sr = sr;
  }
  clear() {
    this.dL.fill(0); this.dR.fill(0); this.s.fill(0);
    this.n1.reset(); this.n2.reset(); this.n3.reset();
    this.drop = 0; this.dropG = 1; this.dropT = 1; this.hold = 0; this.holdL = 0; this.holdR = 0;
    this.tele1 = 0; this.tele2 = 0;
  }
}

class PonyDrone extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const p = (name, def) => ({ name, defaultValue: def, minValue: 0, maxValue: 100, automationRate: 'k-rate' });
    const out = [p('attivita', 45), p('ripeti', 30), p('forma', 60), p('tempo', 45), p('caos', 15),
      p('mix', 70), p('spazio', 40), p('livello', 80)];
    for (let s = 1; s <= 4; s++) for (const k of 'abc') out.push(p('s' + s + k, 30));
    return out;
  }

  constructor(options) {
    super();
    const sr = sampleRate;
    this.sr = sr;
    this.cap = Math.ceil(CAP_S * sr);
    this.bL = new Float32Array(this.cap); this.bR = new Float32Array(this.cap);
    this.len = 0;          // campioni validi nel buffer
    this.w = 0;            // testina di scrittura
    this.d = 0;            // testina di lettura (dry e centro del motore)
    this.mode = 'freeze';  // 'rec' | 'dub' | 'freeze'
    this.micOn = false; this.monitor = false;

    this.algo = 0; this.variant = 0;   // 0 = GRANI, 1 = GLITCH
    this.playing = false; this.ts = 0; // velocità del nastro (tape stop / tape start)
    this.gfreeze = false;
    this.sync = false; this.bpm = 90;

    // grani (struttura di array)
    this.gOn = new Uint8Array(NG); this.gPos = new Float64Array(NG); this.gRate = new Float32Array(NG);
    this.gRamp = new Float32Array(NG); this.gLen = new Float32Array(NG); this.gT = new Float32Array(NG);
    this.gGL = new Float32Array(NG); this.gGR = new Float32Array(NG); this.gFade = new Float32Array(NG);
    this.gEnv = new Float32Array(NG); this.gAge = new Uint32Array(NG);
    this.maxG = NG; this.age = 0;
    this.env = new Float32Array(1025); this.envForma = -1;
    this.timer = 0;            // GRANI: campioni (di nastro) al prossimo grano
    this.segLeft = 0;          // GLITCH: campioni al prossimo segmento
    this.stutter = 0; this.lastStart = 0; this.lastRate = 1; this.lastLen = 0; this.lastRamp = 1; this.ratchet = false;

    // eco di RIPETI
    this.eN = p2(Math.ceil(2.6 * sr)); this.eM = this.eN - 1;
    this.eL = new Float32Array(this.eN); this.eR = new Float32Array(this.eN); this.ew = 0;
    this.eTime = 0.3 * sr; this.eLp = new Float64Array(2);

    // blocchi di lavoro
    this.xL = new Float32Array(128); this.xR = new Float32Array(128);   // motore → pedali
    this.yL = new Float32Array(128); this.yR = new Float32Array(128);   // dry

    this.slots = [new Slot(sr), new Slot(sr), new Slot(sr), new Slot(sr)];

    // riverbero FDN a 8 linee
    const ms = [37.3, 43.9, 51.7, 61.1, 67.9, 79.3, 89.7, 101.9];
    this.rLen = ms.map((m) => Math.round(m * 1.4 * sr / 1000));
    this.rN = this.rLen.map((n) => p2(n + Math.ceil(0.002 * sr) + 4));
    this.rBuf = this.rN.map((n) => new Float32Array(n));
    this.rW = new Int32Array(8); this.rLp = new Float64Array(8); this.rG = new Float64Array(8);
    this.rY = new Float64Array(8);
    const ap = [4.7, 6.3, 9.1, 11.3];
    this.aLen = ap.map((m) => Math.round(m * sr / 1000));
    this.aBuf = this.aLen.map((n) => new Float32Array(n * 2));   // L e R in metà diverse
    this.aW = new Int32Array(4);
    this.rPh = 0; this.rIn = 1; this.rT60 = -1; this.rFrozen = false;

    // uscita
    this.dc = new Float64Array(4);
    this.sm = new Float64Array(16);   // valori lisciati dei parametri
    this.smInit = false;

    // telemetria
    this.ovw = new Float32Array(OVW); this.ovCol = 0; this.ovLen = 0;
    this.tg = new Float32Array(NG * 3);
    this.block = 0; this.ev = 0; this.evFlag = 0;
    this.loadAcc = 0; this.loadT0 = Date.now(); this.load = 0; this.ovwEvery = 0;

    this.pend = []; this.duck = 1;   // cambi discreti in attesa: si applicano a uscita abbassata
    this.dumpId = 0; this.dumpPos = -1;
    this.pn = ['attivita', 'ripeti', 'forma', 'tempo', 'caos', 'mix', 'spazio', 'livello'];
    this.sn = [1, 2, 3, 4].map((i) => ['s' + i + 'a', 's' + i + 'b', 's' + i + 'c']);
    this.tgt = new Float64Array(8);
    this.port.onmessage = (e) => this.msg(e.data);
    // stato iniziale opzionale: gli stessi messaggi della porta, applicati prima del primo blocco
    const init = options && options.processorOptions && options.processorOptions.init;
    if (Array.isArray(init)) for (const m of init) this.apply(m);
  }

  // ---------------------------------------------------------------- messaggi
  msg(m) {
    if (this.pend.length) { this.pend.push(m); return; }   // c'è già qualcosa in attesa: si resta in ordine
    // questi cambiano il suono di colpo: aspettano che l'uscita sia abbassata (vedi process)
    if (m.t === 'load' || m.t === 'clear' || m.t === 'algo' || (m.t === 'mode' && m.v === 'rec') ||
      (m.t === 'slot' && this.slots[m.i].type !== (FX[m.fx] || FX.none))) { this.pend.push(m); return; }
    this.apply(m);
  }
  apply(m) {
    switch (m.t) {
      case 'load': {   // audio già decodificato alla frequenza del contesto
        const n = Math.min(this.cap, m.L.length);
        this.bL.set(m.L.subarray(0, n)); this.bR.set((m.R || m.L).subarray(0, n));
        this.len = n; this.w = 0; this.d = 0; this.mode = 'freeze';
        this.resetEngine(); this.ovCol = 0; this.ovLen = 0; this.ovw.fill(0);
        this.port.postMessage({ t: 'mode', mode: this.mode, len: this.len / this.sr });
        break;
      }
      case 'clear': this.len = 0; this.w = 0; this.d = 0; this.resetEngine(); this.ovw.fill(0); break;
      case 'mode': this.setMode(m.v); break;
      case 'mic': this.micOn = !!m.v; break;
      case 'monitor': this.monitor = !!m.v; break;
      case 'algo': this.algo = m.v | 0; this.resetEngine(); break;
      case 'variant': this.variant = m.v | 0; break;
      case 'play': this.playing = !!m.v; break;
      case 'gfreeze': this.gfreeze = !!m.v; break;
      case 'sync': this.sync = !!m.v; break;
      case 'bpm': this.bpm = Math.max(20, Math.min(300, +m.v || 90)); break;
      case 'slot': {
        const s = this.slots[m.i];
        const ty = FX[m.fx] || FX.none;
        if (s.type !== ty) { s.type = ty; s.clear(); }
        break;
      }
      case 'byp': this.slots[m.i].byp = !!m.v; break;
      case 'dump': this.dumpId = m.id; this.dumpPos = 0; this.dumpLen = this.len; break;   // copia a pezzi, vedi dumpStep
      case 'panic': this.panic(); break;
    }
  }
  setMode(v) {
    if (v === 'rec') {   // nuova ripresa: il buffer riparte da zero
      this.len = 0; this.w = 0; this.d = 0; this.resetEngine(); this.ovw.fill(0);
    } else if (v === 'dub') {
      if (this.len < this.sr * 0.25) return;
    } else if (v === 'freeze' && this.mode === 'rec') {
      if (this.len < this.sr * 0.1) this.len = 0;   // ripresa troppo corta: buffer vuoto
      this.d = this.len === this.cap ? this.w : 0;  // buffer pieno e girato: il loop parte dal materiale più vecchio
    }
    this.mode = v;
    this.port.postMessage({ t: 'mode', mode: this.mode, len: this.len / this.sr });
  }
  resetEngine() {
    this.gOn.fill(0); this.timer = 0; this.segLeft = 0; this.stutter = 0;
  }
  panic() {
    this.eL.fill(0); this.eR.fill(0); this.eLp.fill(0);
    for (const b of this.rBuf) b.fill(0);
    for (const b of this.aBuf) b.fill(0);
    this.rLp.fill(0); this.dc.fill(0);
    for (const s of this.slots) s.clear();
    this.resetEngine();
  }

  // ---------------------------------------------------------------- utilità
  rd(buf, x) {   // lettura interpolata, x già dentro [0, len)
    const len = this.len;
    let i = x | 0; const f = x - i;
    if (i >= len) i -= len;
    let j = i + 1; if (j >= len) j = 0;
    return buf[i] + (buf[j] - buf[i]) * f;
  }
  wrap(x) { const len = this.len; x %= len; return x < 0 ? x + len : x; }
  launch(pos, rate, lenS, pan, gain, fade, ramp) {
    let k = -1;
    for (let i = 0; i < this.maxG; i++) if (!this.gOn[i]) { k = i; break; }
    if (k < 0) {   // nessuno slot libero: il GLITCH ruba il grano più vecchio, i GRANI rinunciano
      if (this.algo !== 1) return;
      let old = 0;
      for (let i = 1; i < this.maxG; i++) if (this.gAge[i] < this.gAge[old]) old = i;
      k = old;
    }
    const a = (pan + 1) * Math.PI / 4;
    this.gOn[k] = 1; this.gPos[k] = this.wrap(pos); this.gRate[k] = rate; this.gRamp[k] = ramp;
    this.gLen[k] = Math.max(16, lenS); this.gT[k] = 0;
    this.gGL[k] = Math.cos(a) * 1.414 * gain; this.gGR[k] = Math.sin(a) * 1.414 * gain;
    this.gFade[k] = fade; this.gEnv[k] = 0; this.gAge[k] = ++this.age;
  }
  buildEnv(forma) {   // FORMA: 0 = click (attacco istantaneo, coda corta), 100 = pad (campana larga)
    const f = forma / 100, A = 0.004 + 0.496 * f, pw = 1 + 5 * (1 - f) * (1 - f);
    const e = this.env;
    for (let i = 0; i <= 1024; i++) {
      const x = i / 1024;
      let v;
      if (x < A) { const s = Math.sin(Math.PI / 2 * x / A); v = s * s; }
      else { const c = Math.cos(Math.PI / 2 * (x - A) / (1 - A)); v = Math.pow(c * c, pw); }
      e[i] = v;
    }
    this.envForma = forma;
  }
  beat() { return 60 / this.bpm; }

  // ---------------------------------------------------------------- MOTORE: GRANI
  schedGrani(att, rip, forma, tempo, caos) {
    const sr = this.sr;
    const gps = 1.5 * Math.pow(60, att);    // 1,5 … 90 grani al secondo
    let dur;
    if (this.sync) dur = this.beat() * DIV_GRANI[Math.round(tempo * (DIV_GRANI.length - 1))];
    else dur = 0.02 * Math.pow(100, tempo);  // 20 ms … 2 s
    dur = Math.min(dur, Math.max(0.02, this.len / sr * 0.5));
    const overlap = Math.max(1, gps * dur);
    const gain = 1 / Math.sqrt(Math.min(overlap, this.maxG));
    const v = this.variant;
    let rate = 1;
    if (v === 0) rate = Math.pow(2, bip() * 4 / 1200);
    else if (v === 1) { const r = rnd(); rate = r < 0.5 ? 1 : r < 0.8 ? 2 : 0.5; }
    else if (v === 2) { const r = rnd(); rate = r < 0.4 ? 1 : r < 0.65 ? 1.5 : r < 0.85 ? 2 : 0.75; }
    else rate = (rnd() < 0.75 ? -1 : 1) * Math.pow(2, bip() * 15 / 1200);
    const spreadS = [0.12, 0.3, 0.2, 0.6][v] * (0.4 + 1.2 * caos);
    let spread = spreadS * sr, jump = false;
    // CAOS: eventi casuali sul singolo grano
    if (rnd() < caos * 0.5) {
      const r = rnd();
      if (r < 0.34) rate = -rate;
      else if (r < 0.67) rate *= rnd() < 0.5 ? 2 : 0.5;
      else jump = true;
      this.ev++;
    }
    if (caos > 0) rate *= Math.pow(2, bip() * caos * 30 / 1200);
    const lenS = dur * sr;
    let pos;
    if (jump) pos = rnd() * this.len;
    else if (this.mode === 'rec') {
      pos = this.w - 64 - rnd() * spread - (rate > 0 ? lenS * rate : 0);
    } else pos = this.d - rnd() * spread;
    const pan = bip() * (0.25 + 0.6 * Math.min(1, caos + (v === 0 ? 0.4 : 0.2)));
    this.launch(pos, rate, lenS, pan, gain, 0, 1);
    this.timer += sr / gps * (0.4 + 1.2 * rnd());
  }

  // ---------------------------------------------------------------- MOTORE: GLITCH
  schedGlitch(att, rip, forma, tempo, caos) {
    const sr = this.sr, v = this.variant;
    let L;
    if (this.sync) L = this.beat() * DIV_GLITCH[Math.round(tempo * (DIV_GLITCH.length - 1))] * sr;
    else L = 0.015 * Math.pow(66, tempo) * sr;   // 15 ms … 1 s
    L = Math.max(sr * 0.01, Math.min(L, this.len * 0.5));
    let start, rate = 1, ramp = 1, gap = false, segLen = L;
    if (this.stutter > 0) {
      this.stutter--;
      start = this.lastStart; rate = this.lastRate; ramp = this.lastRamp;
      if (this.ratchet) { segLen = Math.max(sr * 0.012, this.lastLen * 0.5); } else segLen = this.lastLen;
    } else {
      start = this.d; this.ratchet = false;
      if (rnd() < att * 0.85) {   // ATTIVITÀ: probabilità di un evento sul segmento
        const r = rnd();
        const reps = 1 + Math.round(rip * 7);
        if (v === 0) { if (r < 0.7) this.stutter = reps; else if (r < 0.85) start = Math.floor(rnd() * this.len / L) * L; else rate = -1; }
        else if (v === 1) { if (r < 0.7) { this.stutter = reps; this.ratchet = true; } else start = Math.floor(rnd() * this.len / L) * L; }
        else if (v === 2) { if (r < 0.6) start = Math.floor(rnd() * this.len / L) * L; else if (r < 0.8) rate = -1; else this.stutter = reps; }
        else { if (r < 0.5) ramp = rnd() < 0.7 ? Math.pow(0.02, 1 / L) : Math.pow(4, 1 / L); else if (r < 0.75) rate = rnd() < 0.5 ? 2 : 0.5; else rate = -1; }
        if (ramp > 1) rate *= 0.25;   // speed-up: parte lento e accelera fino a ×1
      }
      // CAOS: eventi casuali estremi, indipendenti
      if (rnd() < caos * 0.35) { gap = true; this.ev++; }
      if (rnd() < caos * 0.5) { rate *= rnd() < 0.5 ? 2 : 0.5; this.ev++; }
      if (rnd() < caos * 0.4) { rate = -rate; this.ev++; }
      if (rnd() < caos * 0.4) { start = rnd() * this.len; this.ev++; }
      this.lastStart = start; this.lastRate = rate; this.lastRamp = ramp; this.lastLen = segLen;
    }
    const rec = this.mode === 'rec';
    if (rec && rate > 1) start -= segLen * (rate - 1);
    // il reverse finisce dove il segmento normale inizia; in REC parte dal materiale più nuovo (davanti c'è solo la testina)
    if (rate < 0 && !rec) start += segLen * Math.abs(rate);
    const fade = 32 + forma * 0.45 * segLen;
    if (!gap) this.launch(start, rate, segLen + fade, v === 2 ? bip() * caos * 0.5 : 0, 0.9, fade, ramp);
    this.segLeft += segLen;
  }

  // ---------------------------------------------------------------- PEDALI
  pedal(s, a, b, c, xL, xR, n) {
    const sr = this.sr, ty = s.type, st = s.s;
    const target = s.byp ? 0 : 1, mstep = 1 / (0.01 * sr);
    if (s.mix <= 0.0001 && target === 0) return;   // in bypass pieno: niente calcoli
    // costanti del blocco (le manopole sono già lisciate a monte)
    const TWO_PI = 2 * Math.PI;
    const dr = 1 + 4 * c, nrm = 1 / Math.pow(dr, 0.6);
    const kTape = 1 - Math.exp(-TWO_PI * 16000 * Math.pow(2500 / 16000, c) / sr);
    const kh = 1 - Math.exp(-TWO_PI * (40 + 360 * c) / sr);
    const kl = 1 - Math.exp(-TWO_PI * 14000 * Math.pow(2200 / 14000, c) / sr);
    const kRes = 1 / (0.5 * Math.pow(36, b)), fMode = c < 1 / 3 ? 0 : c < 2 / 3 ? 1 : 2;
    const qB = Math.pow(2, 15 - 14 * a), hInc = 1 / (1 + 39 * b * b);
    for (let i = 0; i < n; i++) {
      const inL = xL[i], inR = xR[i];
      let oL = inL, oR = inR;
      {
        if (ty === FX.tape) {
          // WOW: LFO lento (0,3–1,2 Hz) + rumore filtrato, FLUTTER: 6–12 Hz, USURA: saturazione + perdita di alti
          s.ph1 += (0.3 + 0.9 * a) / sr; if (s.ph1 >= 1) s.ph1 -= 1;
          s.ph2 += (6 + 6 * b) / sr; if (s.ph2 >= 1) s.ph2 -= 1;
          const wow = Math.sin(2 * Math.PI * s.ph1) * 0.6 + s.n1.next(0.35, 0.25, sr) * 0.5;
          const fl = Math.sin(2 * Math.PI * s.ph2) * 0.8 + s.n2.next(0.03, 0.01, sr) * 0.3;
          s.tele1 = a * wow; s.tele2 = b * fl;
          const D = sr * (0.002 + 0.0045 * a * (1 + 0.95 * wow) + 0.0004 * b * (1 + fl));
          s.dL[s.w] = inL; s.dR[s.w] = inR;
          let rp = s.w - D; if (rp < 0) rp += DL;
          const ri = rp | 0, f = rp - ri, rj = (ri + 1) & DLM;
          let yL = s.dL[ri] + (s.dL[rj] - s.dL[ri]) * f, yR = s.dR[ri] + (s.dR[rj] - s.dR[ri]) * f;
          s.w = (s.w + 1) & DLM;
          yL = Math.tanh(dr * yL + 0.04 * c) * nrm; yR = Math.tanh(dr * yR + 0.04 * c) * nrm;
          st[0] += (yL - st[0]) * kTape; st[1] += (yR - st[1]) * kTape;
          st[2] += (st[0] - st[2]) * kTape; st[3] += (st[1] - st[3]) * kTape;
          const hiss = c * c * 0.004;
          oL = st[2] + bip() * hiss; oR = st[3] + bip() * hiss;
        } else if (ty === FX.vhs) {
          // TRACKING: deriva lenta e indipendente tra L e R, DROPOUT: buchi di segnale, BANDA: banda stretta + rumore
          const nL = s.n1.next(1.2, 0.7, sr), nR = s.n2.next(1.2, 0.7, sr), jt = s.n3.next(0.02, 0.006, sr);
          s.tele1 = a * nL; s.tele2 = a * jt;
          const DLs = sr * (0.002 + 0.005 * a * (1 + nL) + 0.0002 * a * jt);
          const DRs = sr * (0.002 + 0.005 * a * (1 + nR) + 0.0002 * a * jt);
          s.dL[s.w] = inL; s.dR[s.w] = inR;
          let rpl = s.w - DLs; if (rpl < 0) rpl += DL;
          let rpr = s.w - DRs; if (rpr < 0) rpr += DL;
          const il = rpl | 0, fl2 = rpl - il, jl = (il + 1) & DLM;
          const ir = rpr | 0, fr = rpr - ir, jr = (ir + 1) & DLM;
          let yL = s.dL[il] + (s.dL[jl] - s.dL[il]) * fl2, yR = s.dR[ir] + (s.dR[jr] - s.dR[ir]) * fr;
          s.w = (s.w + 1) & DLM;
          // dropout
          if (s.drop > 0) { if (--s.drop === 0) s.dropT = 1; }
          else if (rnd() < b * 3 / sr) { s.drop = Math.round(sr * (0.02 + 0.13 * rnd())); s.dropT = 0.05 + 0.35 * rnd(); }
          s.dropG += (s.dropT - s.dropG) * (1 / (0.003 * sr));
          const burst = (1 - s.dropG) * 0.02 * bip();
          yL = yL * s.dropG + burst; yR = yR * s.dropG + burst;
          // banda
          st[0] += (yL - st[0]) * kh; st[1] += (yR - st[1]) * kh;
          yL -= st[0]; yR -= st[1];
          st[2] += (yL - st[2]) * kl; st[3] += (yR - st[3]) * kl;
          st[4] += (st[2] - st[4]) * kl; st[5] += (st[3] - st[5]) * kl;
          const mid = (st[4] + st[5]) * 0.5, side = (st[4] - st[5]) * 0.5 * (1 - 0.5 * c);
          const hiss = c * 0.006 * bip();
          st[6] += (hiss - st[6]) * 0.3;
          oL = mid + side + st[6]; oR = mid - side + st[6];
        } else if (ty === FX.filtro) {
          // SVF a trapezi (Simper): TAGLIO 30 Hz–18 kHz, RISONANZA Q 0,5–18, TIPO LP/BP/HP
          const fcT = 30 * Math.pow(600, a);
          s.fc += (fcT - s.fc) * 0.002;
          const g = Math.tan(Math.PI * Math.min(s.fc, sr * 0.45) / sr);
          const k = kRes, mode = fMode;
          const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
          for (let ch = 0; ch < 2; ch++) {
            const x = ch ? inR : inL, o = ch * 2;
            const v3 = x - st[o + 1], v1 = a1 * st[o] + a2 * v3, v2 = st[o + 1] + a2 * st[o] + a3 * v3;
            st[o] = 2 * v1 - st[o]; st[o + 1] = 2 * v2 - st[o + 1];
            const y = mode === 0 ? v2 : mode === 1 ? v1 * k * 1.4 : x - k * v1 - v2;
            if (ch) oR = y; else oL = y;
          }
        } else if (ty === FX.bitcrush) {
          // BIT 16→2, RATE ÷1→÷40 (sample & hold), MIX
          const q = qB;
          s.hold += hInc;
          if (s.hold >= 1) { s.hold -= 1; s.holdL = inL; s.holdR = inR; }
          const cL = Math.round(s.holdL * q) / q, cR = Math.round(s.holdR * q) / q;
          oL = inL + (cL - inL) * c; oR = inR + (cR - inR) * c;
        }
      }
      if (s.mix !== target) s.mix = target > s.mix ? Math.min(target, s.mix + mstep) : Math.max(target, s.mix - mstep);
      xL[i] = inL + (oL - inL) * s.mix; xR[i] = inR + (oR - inR) * s.mix;
    }
  }

  // ---------------------------------------------------------------- SPAZIO (FDN)
  reverb(sp, xL, xR, n, outL, outR, wetG0, wetG1) {
    const sr = this.sr, frozen = this.gfreeze;
    const T = 2 + 18 * sp;
    if (T !== this.rT60 || frozen !== this.rFrozen) {
      for (let i = 0; i < 8; i++) this.rG[i] = frozen ? 1 : Math.pow(10, -3 * this.rLen[i] / (T * sr));
      this.rT60 = T; this.rFrozen = frozen;
    }
    const send = Math.pow(sp, 0.7);
    const kDamp = frozen ? 1 : 1 - Math.exp(-2 * Math.PI * 5500 / sr);
    const inT = frozen ? 0 : 1, inStep = 1 / (0.05 * sr);
    const modD = 0.0006 * sr, phInc = 0.21 / sr;
    const rb = this.rBuf, rN = this.rN, rW = this.rW, rLen = this.rLen, rG = this.rG, rLp = this.rLp, y = this.rY;
    for (let i = 0; i < n; i++) {
      if (this.rIn !== inT) this.rIn = inT > this.rIn ? Math.min(1, this.rIn + inStep) : Math.max(0, this.rIn - inStep);
      let iL = xL[i] * send * this.rIn, iR = xR[i] * send * this.rIn;
      // diffusione: 2 allpass per canale
      for (let a = 0; a < 4; a++) {
        const N = this.aLen[a], buf = this.aBuf[a], w = this.aW[a];
        // ogni allpass tiene L nella prima metà dell'array e R nella seconda
        if (a < 2) {
          const dl = buf[w], v = iL + 0.6 * dl; buf[w] = v; iL = dl - 0.6 * v;
          const dr = buf[N + w], u = iR + 0.6 * dr; buf[N + w] = u; iR = dr - 0.6 * u;
        } else {
          const dl = buf[w], v = iL + 0.5 * dl; buf[w] = v; iL = dl - 0.5 * v;
          const dr = buf[N + w], u = iR + 0.5 * dr; buf[N + w] = u; iR = dr - 0.5 * u;
        }
        this.aW[a] = w + 1 >= N ? 0 : w + 1;
      }
      this.rPh += phInc; if (this.rPh >= 1) this.rPh -= 1;
      const m0 = Math.sin(2 * Math.PI * this.rPh), m1 = Math.sin(2 * Math.PI * (this.rPh * 1.31 + 0.25));
      let sum = 0;
      for (let l = 0; l < 8; l++) {
        const N = rN[l], buf = rb[l];
        let dly = rLen[l];
        if (l === 0) dly += modD * (1 + m0); else if (l === 5) dly += modD * (1 + m1);
        let rp = rW[l] - dly; if (rp < 0) rp += N;
        const ri = rp | 0, f = rp - ri, rj = (ri + 1) & (N - 1);
        let v = buf[ri] + (buf[rj] - buf[ri]) * f;
        rLp[l] += (v - rLp[l]) * kDamp; v = rLp[l];
        y[l] = v; sum += v;
      }
      sum *= 0.25;   // Householder: y - 2/N · somma
      let oL = 0, oR = 0;
      for (let l = 0; l < 8; l++) {
        const v = y[l];
        const inj = (l & 1) ? iR : iL;
        this.rBuf[l][rW[l]] = (v - sum) * rG[l] + inj;
        rW[l] = (rW[l] + 1) & (rN[l] - 1);
        if (l & 1) oR += (l & 2) ? -v : v; else oL += (l & 2) ? -v : v;
      }
      const wg = wetG0 + (wetG1 - wetG0) * (i / n);
      outL[i] += oL * 0.45 * wg; outR[i] += oR * 0.45 * wg;
    }
  }

  // ---------------------------------------------------------------- process
  process(inputs, outputs, params) {
    const t0 = Date.now();
    const out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length;
    const inp = inputs[0], iL = inp && inp[0], iR = inp && (inp[1] || inp[0]);
    const sr = this.sr, sm = this.sm;
    const tgt = this.tgt, pn = this.pn;
    for (let i = 0; i < 8; i++) tgt[i] = params[pn[i]][0];
    if (this.pend.length && this.duck <= 0) { for (const m of this.pend) this.apply(m); this.pend.length = 0; }
    if (!this.smInit) { for (let i = 0; i < 8; i++) sm[i] = tgt[i]; this.smInit = true; }
    const prevMix = sm[5], prevLiv = sm[7], prevSp = sm[6];
    const kS = 1 - Math.exp(-n / (0.03 * sr));
    for (let i = 0; i < 8; i++) sm[i] += (tgt[i] - sm[i]) * kS;
    const att = sm[0] / 100, rip = sm[1] / 100, forma = sm[2] / 100, tempo = sm[3] / 100, caos = sm[4] / 100;
    if (this.algo === 0 && Math.abs(sm[2] - this.envForma) > 0.5) this.buildEnv(sm[2]);

    // ---- SORGENTE: scrittura
    const writing = (this.mode === 'rec' || this.mode === 'dub') && this.micOn && iL;
    if (writing) {
      for (let i = 0; i < n; i++) {
        if (this.mode === 'rec') {
          this.bL[this.w] = iL[i]; this.bR[this.w] = iR[i];
          if (++this.w >= this.cap) this.w = 0;
          if (this.len < this.cap) this.len++;
        } else {
          if (this.ts <= 0) break;   // nastro fermo: niente sovraincisione
          if (i === 0) this.w = Math.floor(this.d) % this.len;   // si sovraincide dove si sta ascoltando
          this.bL[this.w] = this.bL[this.w] * 0.65 + iL[i] * 0.8; this.bR[this.w] = this.bR[this.w] * 0.65 + iR[i] * 0.8;
          if (++this.w >= this.len) this.w = 0;
        }
      }
    }

    const xL = this.xL, xR = this.xR, yL = this.yL, yR = this.yR;
    xL.fill(0); xR.fill(0); yL.fill(0); yR.fill(0);

    // ---- MOTORE + dry
    const has = this.len > sr * 0.05;
    const live = writing && this.mode === 'rec';
    let velAcc = 0, velW = 0;
    if (has) {
      const tsT = this.playing ? 1 : 0, up = 1 / (0.3 * sr), down = 1 / (0.9 * sr);
      const dryOk = !(live && !this.monitor);
      for (let i = 0; i < n; i++) {
        if (this.ts !== tsT) this.ts = tsT > this.ts ? Math.min(1, this.ts + up) : Math.max(0, this.ts - down);
        const ts = this.ts;
        if (ts <= 0) continue;
        const fg = ts < 0.125 ? ts * 8 : 1;
        // dry: testina a velocità di nastro (in ripresa segue la scrittura: è il monitor)
        if (live) { const p = this.w - n + i; this.d = p < 0 ? p + this.len : p; }   // monitor: il campione appena scritto
        if (this.d >= this.len) this.d = 0;
        if (dryOk) { yL[i] = this.rd(this.bL, this.d) * fg; yR[i] = this.rd(this.bR, this.d) * fg; }
        if (!live) { this.d += ts; if (this.d >= this.len) this.d -= this.len; }
        // scheduler
        if (this.algo === 0) { this.timer -= ts; while (this.timer <= 0) this.schedGrani(att, rip, forma, tempo, caos); }
        else { this.segLeft -= ts; while (this.segLeft <= 0) this.schedGlitch(att, rip, forma, tempo, caos); }
        // grani attivi
        let sL = 0, sR = 0;
        for (let g = 0; g < this.maxG; g++) {
          if (!this.gOn[g]) continue;
          const len = this.gLen[g], t = this.gT[g];
          let e;
          const fd = this.gFade[g];
          if (fd > 0) e = Math.min(1, t / fd, (len - t) / fd);
          else { const x = t / len * 1024, xi = x | 0; e = this.env[xi] + (this.env[xi + 1] - this.env[xi]) * (x - xi); }
          const p = this.gPos[g];
          const vL = this.rd(this.bL, p), vR = this.rd(this.bR, p);
          sL += vL * e * this.gGL[g]; sR += vR * e * this.gGR[g];
          let r = this.gRate[g];
          if (this.gRamp[g] !== 1) { r *= this.gRamp[g]; this.gRate[g] = r; }
          let np = p + r * ts; if (np >= this.len) np -= this.len; else if (np < 0) np += this.len;
          this.gPos[g] = np;
          const nt = t + ts; this.gT[g] = nt; this.gEnv[g] = e;
          if (nt >= len) this.gOn[g] = 0;
          if (i === 0) { velAcc += r * e; velW += e; }
        }
        xL[i] = sL * fg; xR[i] = sR * fg;
      }
    } else if (this.ts > 0 && !this.playing) this.ts = 0;

    // ---- RIPETI: eco in feedback (tempo legato a TEMPO, lisciato: cambia come un nastro)
    {
      let et;
      if (this.algo === 0) et = this.sync ? this.beat() * 0.75 : 0.06 + 1.6 * tempo * tempo;
      else et = this.sync ? this.beat() * 0.5 : 0.04 + 1.2 * tempo * tempo;
      et = Math.min(2.4, et) * sr;
      const fb = rip * (this.algo === 0 ? 0.9 : 0.6), wet = Math.min(1, rip * 2.5);
      const kT = 1 / (0.35 * sr), kL = 1 - Math.exp(-2 * Math.PI * 6000 / sr);
      if (wet > 0.001 || fb > 0.001) {
        for (let i = 0; i < n; i++) {
          this.eTime += (et - this.eTime) * kT;
          let rp = this.ew - this.eTime; if (rp < 0) rp += this.eN;
          const ri = rp | 0, f = rp - ri, rj = (ri + 1) & this.eM;
          const dL = this.eL[ri] + (this.eL[rj] - this.eL[ri]) * f, dR = this.eR[ri] + (this.eR[rj] - this.eR[ri]) * f;
          this.eLp[0] += (dL - this.eLp[0]) * kL; this.eLp[1] += (dR - this.eLp[1]) * kL;
          // incrocio leggero L↔R: le ripetizioni si allargano
          this.eL[this.ew] = Math.tanh(xL[i] + fb * (0.8 * this.eLp[0] + 0.2 * this.eLp[1]));
          this.eR[this.ew] = Math.tanh(xR[i] + fb * (0.8 * this.eLp[1] + 0.2 * this.eLp[0]));
          this.ew = (this.ew + 1) & this.eM;
          xL[i] += dL * wet; xR[i] += dR * wet;
        }
      } else {
        for (let i = 0; i < n; i++) { this.eL[this.ew] = 0; this.eR[this.ew] = 0; this.ew = (this.ew + 1) & this.eM; }
      }
    }

    // ---- PEDALIERA
    for (let s = 0; s < 4; s++) {
      const sl = this.slots[s];
      if (sl.type === FX.none) continue;
      const nm = this.sn[s], a = params[nm[0]][0] / 100, b = params[nm[1]][0] / 100, c = params[nm[2]][0] / 100;
      if (sl.sa < 0) { sl.sa = a; sl.sb = b; sl.sc = c; }
      sl.sa += (a - sl.sa) * kS; sl.sb += (b - sl.sb) * kS; sl.sc += (c - sl.sc) * kS;
      this.pedal(sl, sl.sa, sl.sb, sl.sc, xL, xR, n);
    }

    // ---- MIX dry/wet + SPAZIO
    const m0 = prevMix / 100 * Math.PI / 2, m1 = sm[5] / 100 * Math.PI / 2;
    const dg0 = Math.cos(m0), dg1 = Math.cos(m1), wg0 = Math.sin(m0), wg1 = Math.sin(m1);
    const sp0 = prevSp / 100, sp1 = sm[6] / 100;
    const dkT = this.pend.length ? 0 : 1, dkS = 1 / (0.004 * sr);
    for (let i = 0; i < n; i++) {
      if (this.duck !== dkT) this.duck = dkT > this.duck ? Math.min(1, this.duck + dkS) : Math.max(0, this.duck - dkS);
      xL[i] *= this.duck; xR[i] *= this.duck; yL[i] *= this.duck; yR[i] *= this.duck;
      const fr = i / n, dg = dg0 + (dg1 - dg0) * fr, wg = wg0 + (wg1 - wg0) * fr, sp = sp0 + (sp1 - sp0) * fr;
      const direct = 1 - 0.35 * sp;
      oL[i] = yL[i] * dg + xL[i] * wg * direct;
      if (out[1]) oR[i] = yR[i] * dg + xR[i] * wg * direct;
    }
    this.reverb(sp1, xL, xR, n, oL, out[1] ? oR : yR, wg0, wg1);

    // ---- uscita: DC blocker, soft clip, LIVELLO
    const lv0 = Math.pow(prevLiv / 100, 2), lv1 = Math.pow(sm[7] / 100, 2);
    const dc = this.dc;
    let sum = 0;
    for (let ch = 0; ch < (out[1] ? 2 : 1); ch++) {
      const o = ch ? oR : oL, b = ch * 2;
      for (let i = 0; i < n; i++) {
        const x = o[i];
        const yv = x - dc[b] + 0.9975 * dc[b + 1];
        dc[b] = x; dc[b + 1] = yv;
        const ax = Math.abs(yv);
        let s = ax < 0.7 ? yv : (yv > 0 ? 1 : -1) * (0.7 + 0.3 * Math.tanh((ax - 0.7) / 0.3));
        s *= lv0 + (lv1 - lv0) * (i / n);
        o[i] = s; sum += s;
      }
    }
    if (!Number.isFinite(sum)) {   // feedback esploso: si azzera tutto, la macchina resta suonabile
      this.panic(); oL.fill(0); if (out[1]) oR.fill(0);
      this.port.postMessage({ t: 'panic' });
    }

    // ---- telemetria e copia del nastro
    this.ovStep();
    this.dumpStep();
    this.loadAcc += Date.now() - t0;
    if (++this.block % TELE_EVERY === 0) this.telemetry(velAcc, velW);
    return true;
  }

  dumpStep() {   // mezzo secondo per blocco, trasferito: niente picchi di lavoro sul thread audio
    if (this.dumpPos < 0) return;
    const n = Math.min(this.dumpLen, this.len), a = this.dumpPos, b = Math.min(n, a + (this.sr >> 1));
    const L = this.bL.slice(a, b), R = this.bR.slice(a, b), last = b >= n;
    this.port.postMessage({ t: 'dump', id: this.dumpId, L, R, at: a, total: n, last, sr: this.sr }, [L.buffer, R.buffer]);
    this.dumpPos = last ? -1 : b;
  }
  ovStep() {   // aggiorna qualche colonna della forma d'onda per blocco: un giro completo in ~1 s anche a 45 s
    const len = this.len;
    if (len < 2) return;
    const spc = len / OVW;
    let cols = Math.min(OVW, Math.max(1, Math.floor(4096 / spc)));
    while (cols-- > 0) {
      const c = this.ovCol, a = Math.floor(c * spc), b = Math.min(len, Math.floor((c + 1) * spc));
      let mx = 0;
      const st = Math.max(1, Math.floor((b - a) / 256));   // al massimo 256 letture per colonna
      for (let i = a; i < b; i += st) { const v = Math.abs(this.bL[i]) + Math.abs(this.bR[i]); if (v > mx) mx = v; }
      this.ovw[c] = mx * 0.5;
      this.ovCol = (c + 1) % OVW;
    }
  }

  telemetry(velAcc, velW) {
    // velocità media dei grani pesata sull'inviluppo: guida i rocchetti (segno = verso)
    let vel = velW > 0.05 ? velAcc / velW : 1;
    vel = Math.max(-2, Math.min(2, vel)) * this.ts;
    let wow = 0, fl = 0;
    for (const s of this.slots) {
      if (s.byp || s.type === FX.none) continue;
      if (s.type === FX.tape) { wow = s.tele1; fl = s.tele2; break; }
      if (s.type === FX.vhs && wow === 0) { wow = s.tele1; fl = s.tele2; }
    }
    let k = 0, cnt = 0;
    const len = this.len || 1;
    for (let g = 0; g < NG; g++) {
      if (!this.gOn[g]) continue;
      this.tg[k++] = this.gPos[g] / len; this.tg[k++] = this.gEnv[g]; this.tg[k++] = this.gRate[g];
      cnt++;
    }
    const elapsed = Date.now() - this.loadT0;
    if (elapsed >= 1000) {
      this.load = this.loadAcc / elapsed;
      this.loadAcc = 0; this.loadT0 = Date.now();
      // CPU in sovraccarico: meno grani invece di crackle; recupera piano
      if (this.load > 0.6 && this.maxG > 8) this.maxG -= 4;
      else if (this.load < 0.3 && this.maxG < NG) this.maxG += 2;
    }
    const ev = this.ev !== this.evFlag; this.evFlag = this.ev;
    const msg = {
      t: 'tm', vel, wow, fl, ev, pos: this.len ? this.d / this.len : 0, wpos: this.len ? this.w / this.len : 0,
      len: this.len / this.sr, mode: this.mode, ts: this.ts, load: this.load, maxG: this.maxG,
      n: cnt, g: this.tg.slice(0, k)
    };
    if (++this.ovwEvery % 12 === 0) msg.ovw = this.ovw.slice();
    this.port.postMessage(msg);
  }
}
registerProcessor('ponydrone', PonyDrone);

// Registratore dell'uscita (stesso schema di PONY84): manda blocchi PCM 16 bit stereo al main thread.
class PonyRec extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = !!e.data.on; }; }
  process(ins) {
    const inp = ins[0];
    if (this.on && inp && inp[0]) {
      const L = inp[0], R = inp[1] || L, n = L.length, out = new Int16Array(n * 2);
      for (let i = 0, j = 0; i < n; i++) {
        const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
        out[j++] = l < 0 ? l * 32768 : l * 32767; out[j++] = r < 0 ? r * 32768 : r * 32767;
      }
      this.port.postMessage(out, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('ponydrone-rec', PonyRec);
