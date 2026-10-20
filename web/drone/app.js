// PonyDrone · stato, interfaccia e salvataggio.
// Il suono vive in audio.js + worklets/drone-processor.js; qui si decidono valori e si disegna.
import { Engine, wavFromFloat } from './audio.js';
import { TapeView, PadView } from './tape.js';

/* global VERSION */
const SCENE_VER = 1;
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const eng = new Engine();

// ===================================================================
// DEFINIZIONI
// ===================================================================
const ALGOS = ['GRANI', 'GLITCH'];
const VARIANTS = [
  ['A · NUVOLA: grani vicini alla testina, intonati', 'B · OTTAVE: grani un\'ottava sopra e sotto', 'C · QUINTE: quinte e ottave, effetto organo', 'D · ROVESCIO: grani al contrario, nuvola larga'],
  ['A · STUTTER: il pezzo appena passato si ripete', 'B · RATCHET: ripetizioni sempre più fitte', 'C · SHUFFLE: blocchi rimescolati a griglia', 'D · NASTRO ROTTO: tape stop, accelerazioni, ottave']
];
// pad XY: le due macro più espressive per ciascun algoritmo
const XY = [['attivita', 'forma'], ['attivita', 'caos']];
const DIV_GRANI = ['1/64', '1/32', '1/16', '1/8', '1/4', '1/2', '1/1'];
const DIV_GLITCH = ['1/32', '1/16', '1/8', '1/4', '1/2'];

const ms = (s) => (s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(s < 10 ? 2 : 1).replace('.', ',') + ' s');
const hz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1).replace('.', ',') + 'k' : Math.round(f) + ' Hz');
const pct = (v) => String(Math.round(v));

const MACROS = [
  { k: 'attivita', label: 'ATTIVITÀ', def: 45 },
  { k: 'ripeti', label: 'RIPETI', def: 30 },
  { k: 'forma', label: 'FORMA', def: 60, fmt: (v) => (v < 15 ? 'CLICK' : v > 85 ? 'PAD' : pct(v)) },
  { k: 'tempo', label: 'TEMPO', def: 45, fmt: (v) => fmtTempo(v) },
  { k: 'caos', label: 'CAOS', def: 15, cls: 'chaos' }
];
function fmtTempo(v) {
  const t = v / 100;
  if (S.sync) { const d = S.algo === 0 ? DIV_GRANI : DIV_GLITCH; return d[Math.round(t * (d.length - 1))]; }
  return ms(S.algo === 0 ? 0.02 * Math.pow(100, t) : 0.015 * Math.pow(66, t));
}

// le formule dei display rispecchiano quelle del worklet
const FX_DEFS = {
  tape: { name: 'TAPE', knobs: ['WOW', 'FLUTTER', 'USURA'], def: [30, 15, 20], fmt: [pct, pct, pct], info: 'wow, flutter e usura del nastro' },
  vhs: { name: 'VHS', knobs: ['TRACKING', 'DROPOUT', 'BANDA'], def: [25, 10, 30], fmt: [pct, pct, pct], info: 'deriva, buchi di segnale, banda stretta' },
  filtro: {
    name: 'FILTRO', knobs: ['TAGLIO', 'RISON.', 'TIPO'], def: [100, 10, 0], info: 'passa basso, passa banda, passa alto',
    fmt: [(v) => hz(30 * Math.pow(600, v / 100)), (v) => 'Q ' + (0.5 * Math.pow(36, v / 100)).toFixed(1).replace('.', ','), (v) => (v < 100 / 3 ? 'LP' : v < 200 / 3 ? 'BP' : 'HP')]
  },
  bitcrush: {
    name: 'BITCRUSH', knobs: ['BIT', 'RATE', 'MIX'], def: [40, 20, 100], info: 'meno bit, meno campioni',
    fmt: [(v) => Math.round(16 - 14 * v / 100) + ' bit', (v) => '÷' + Math.round(1 + 39 * Math.pow(v / 100, 2)), pct]
  }
};

function defaultScene() {
  return {
    ver: SCENE_VER, algo: 0, variant: 0,
    macro: Object.fromEntries(MACROS.map((m) => [m.k, m.def])),
    space: { spazio: 40, mix: 70, livello: 80 },
    slots: [
      { fx: 'tape', byp: false, p: FX_DEFS.tape.def.slice() },
      { fx: 'vhs', byp: false, p: FX_DEFS.vhs.def.slice() },
      { fx: 'filtro', byp: false, p: FX_DEFS.filtro.def.slice() }
    ],
    sel: 0, sync: false, bpm: 90, monitor: false, expMin: 2,
    source: { name: '' }
  };
}

// ===================================================================
// FORMATO DELLA SCENA E MIGRAZIONI
// Come in PONY84: upgradeScene applica i passi in ordine (STEPS[0] = upgradeTo2, …).
// Ogni cambio di scala di una manopola va accompagnato da un passo che ricalcola i valori.
// ===================================================================
const STEPS = [];
function upgradeScene(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('formato');
  const v = Number(raw.ver) || 1;
  if (v > SCENE_VER) throw new Error('futura');
  let s = raw;
  for (let i = v; i < SCENE_VER; i++) s = STEPS[i - 1](s);
  return sanitize(s);
}
function sanitize(s) {
  const d = defaultScene(), n = (x, def, a = 0, b = 100) => (Number.isFinite(+x) ? clamp(+x, a, b) : def);
  const out = d;
  out.algo = s.algo === 1 ? 1 : 0;
  out.variant = n(s.variant, 0, 0, 3) | 0;
  for (const m of MACROS) out.macro[m.k] = n(s.macro && s.macro[m.k], m.def);
  for (const k of ['spazio', 'mix', 'livello']) out.space[k] = n(s.space && s.space[k], d.space[k]);
  if (Array.isArray(s.slots) && s.slots.length >= 3) {
    out.slots = s.slots.slice(0, 4).map((sl) => {
      const fx = sl && FX_DEFS[sl.fx] ? sl.fx : null;
      const def = fx ? FX_DEFS[fx].def : [50, 50, 50];
      return { fx, byp: !!(sl && sl.byp), p: [0, 1, 2].map((i) => n(sl && sl.p && sl.p[i], def[i])) };
    });
  }
  out.sel = n(s.sel, 0, 0, out.slots.length - 1) | 0;
  out.sync = !!s.sync; out.monitor = !!s.monitor;
  out.bpm = n(s.bpm, 90, 30, 240);
  out.expMin = [1, 2, 5, 10].includes(s.expMin) ? s.expMin : 2;
  out.source = { name: s.source && typeof s.source.name === 'string' ? s.source.name.slice(0, 40) : '' };
  out.ver = SCENE_VER;
  return out;
}

let S = defaultScene();
try { const raw = localStorage.getItem('ponydrone-scene'); if (raw) S = upgradeScene(JSON.parse(raw)); } catch (e) { S = defaultScene(); }
const live = { playing: false, mode: 'freeze', len: 0, gfreeze: false, exp: false, wake: null };
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem('ponydrone-scene', JSON.stringify(S)); } catch (e) { /* pieno: pazienza */ } }, 400);
}

// ===================================================================
// MOTORE ↔ STATO
// ===================================================================
function engineParams() {
  const p = { ...S.macro, ...S.space };
  S.slots.forEach((sl, i) => ['a', 'b', 'c'].forEach((k, j) => { p['s' + (i + 1) + k] = sl.p[j]; }));
  return p;
}
function pushAll() {
  const p = engineParams();
  for (const k in p) eng.set(k, p[k]);
  eng.post({ t: 'algo', v: S.algo }); eng.post({ t: 'variant', v: S.variant });
  eng.post({ t: 'sync', v: S.sync }); eng.post({ t: 'bpm', v: S.bpm }); eng.post({ t: 'monitor', v: S.monitor });
  for (let i = 0; i < 4; i++) {
    const sl = S.slots[i];
    eng.post({ t: 'slot', i, fx: sl ? sl.fx : null });
    eng.post({ t: 'byp', i, v: sl ? sl.byp : false });
  }
}

// ===================================================================
// MANOPOLE: trascinamento verticale, doppio tocco = valore di default, frecce da tastiera
// ===================================================================
const knobs = [];
function makeKnob(host, spec) {
  const el = document.createElement('div');
  el.className = 'knob' + (spec.cls ? ' ' + spec.cls : '');
  el.tabIndex = 0; el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '100');
  el.innerHTML = '<div class="cap"><div class="rot"><i></i></div></div><span class="lbl"></span><span class="val"></span>';
  host.appendChild(el);
  const k = { el, spec };
  knobs.push(k);
  let lastDown = 0, moved = false;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); el.focus({ preventScroll: true });
    const now = performance.now();
    if (now - lastDown < 320 && !moved) { setK(k, spec.def()); lastDown = 0; return; }
    lastDown = now; moved = false;
    const id = e.pointerId, y0 = e.clientY, v0 = spec.get();
    try { el.setPointerCapture(id); } catch (err) { /* ok */ }
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (Math.abs(ev.clientY - y0) > 3) moved = true;
      setK(k, clamp(v0 + (y0 - ev.clientY) * (ev.shiftKey ? 0.15 : 0.55)));
    };
    const end = (ev) => {
      if (ev.pointerId !== id) return;
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step }[e.key];
    if (d) { e.preventDefault(); setK(k, clamp(spec.get() + d)); }
    else if (e.key === 'Home') { e.preventDefault(); setK(k, 0); }
    else if (e.key === 'End') { e.preventDefault(); setK(k, 100); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setK(k, spec.def()); }
  });
  drawKnob(k);
  return k;
}
function setK(k, v) {
  v = Math.round(v * 10) / 10;
  if (v === k.spec.get()) return;
  k.spec.set(v); drawKnob(k);
  if (k.spec.after) k.spec.after();
  save();
}
function drawKnob(k) {
  const v = k.spec.get(), lbl = k.spec.label(), txt = k.spec.fmt ? k.spec.fmt(v) : pct(v);
  k.el.querySelector('.rot').style.transform = 'rotate(' + (-135 + v / 100 * 270) + 'deg)';
  k.el.querySelector('.lbl').textContent = lbl;
  k.el.querySelector('.val').textContent = txt;
  k.el.setAttribute('aria-label', lbl); k.el.setAttribute('aria-valuenow', String(Math.round(v))); k.el.setAttribute('aria-valuetext', txt);
}
const redrawKnobs = () => knobs.forEach(drawKnob);

// macro del motore
const macroK = {};
for (const m of MACROS) {
  macroK[m.k] = makeKnob($('macroKnobs'), {
    label: () => m.label, cls: m.cls, def: () => m.def,
    get: () => S.macro[m.k], set: (v) => { S.macro[m.k] = v; eng.set(m.k, v); },
    fmt: m.fmt, after: () => drawPadXY()
  });
}
// pedale selezionato
const pedK = [0, 1, 2].map((j) => makeKnob($('pedKnobs'), {
  label: () => { const sl = S.slots[S.sel]; return sl && sl.fx ? FX_DEFS[sl.fx].knobs[j] : '—'; },
  def: () => { const sl = S.slots[S.sel]; return sl && sl.fx ? FX_DEFS[sl.fx].def[j] : 50; },
  get: () => { const sl = S.slots[S.sel]; return sl ? sl.p[j] : 0; },
  set: (v) => { const sl = S.slots[S.sel]; if (!sl || !sl.fx) return; sl.p[j] = v; eng.set('s' + (S.sel + 1) + 'abc'[j], v); },
  fmt: (v) => { const sl = S.slots[S.sel]; return sl && sl.fx ? FX_DEFS[sl.fx].fmt[j](v) : '—'; }
}));
// spazio e uscita
const spaceDefs = { spazio: ['SPAZIO', 40, (v) => (v < 1 ? 'OFF' : (2 + 18 * v / 100).toFixed(0) + ' s')], mix: ['MIX', 70, (v) => (v < 1 ? 'DRY' : v > 99 ? 'WET' : pct(v))], livello: ['LIVELLO', 80, pct] };
for (const k of Object.keys(spaceDefs)) {
  const [label, def, fmt] = spaceDefs[k];
  makeKnob($('k' + k[0].toUpperCase() + k.slice(1)), { label: () => label, def: () => def, get: () => S.space[k], set: (v) => { S.space[k] = v; eng.set(k, v); }, fmt });
}

// ===================================================================
// MOTORE: algoritmo, variante, pad XY
// ===================================================================
const pad = new PadView($('pad'), (x, y) => {
  const [kx, ky] = XY[S.algo];
  setK(macroK[kx], x * 100); setK(macroK[ky], y * 100);
});
function drawPadXY() {
  const [kx, ky] = XY[S.algo];
  pad.set(S.macro[kx] / 100, S.macro[ky] / 100, MACROS.find((m) => m.k === kx).label, MACROS.find((m) => m.k === ky).label);
  for (const m of MACROS) macroK[m.k].el.classList.toggle('xy', m.k === kx || m.k === ky);
}
function drawEngine() {
  document.querySelectorAll('[data-algo]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.algo === S.algo)));
  document.querySelectorAll('[data-var]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.var === S.variant)));
  $('varInfo').textContent = ALGOS[S.algo] + ' ' + VARIANTS[S.algo][S.variant];
  drawPadXY(); drawKnob(macroK.tempo);
}
$('algoSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-algo]'); if (!b) return;
  S.algo = +b.dataset.algo; eng.post({ t: 'algo', v: S.algo }); drawEngine(); save();
});
$('varSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-var]'); if (!b) return;
  S.variant = +b.dataset.var; eng.post({ t: 'variant', v: S.variant }); drawEngine(); save();
});

// ===================================================================
// PEDALIERA: tocco = seleziona, doppio tocco = bypass, pressione lunga = cambia effetto, + = slot in più
// ===================================================================
function drawPedals() {
  const host = $('pedals');
  host.innerHTML = '';
  S.slots.forEach((sl, i) => {
    const b = document.createElement('button');
    b.className = 'pedal' + (sl.fx ? (sl.byp ? '' : ' on') : ' empty');
    b.dataset.i = i;
    b.setAttribute('aria-current', String(i === S.sel));
    b.setAttribute('aria-label', 'Slot ' + (i + 1) + ': ' + (sl.fx ? FX_DEFS[sl.fx].name + (sl.byp ? ', in bypass' : ', attivo') : 'vuoto'));
    b.innerHTML = sl.fx ? '<span>' + FX_DEFS[sl.fx].name + '</span><span class="led" aria-hidden="true"></span>' : '<span>—</span>';
    pedalGestures(b, i);
    host.appendChild(b);
  });
  if (S.slots.length < 4) {
    const add = document.createElement('button');
    add.className = 'pedal add'; add.textContent = '+'; add.setAttribute('aria-label', 'Aggiungi uno slot');
    add.addEventListener('click', () => { S.slots.push({ fx: null, byp: false, p: [50, 50, 50] }); S.sel = S.slots.length - 1; drawPedals(); openFx(); save(); });
    host.appendChild(add);
  }
  const sl = S.slots[S.sel];
  $('pedName').textContent = sl && sl.fx ? FX_DEFS[sl.fx].name + (sl.byp ? ' · BYPASS' : '') : 'SLOT ' + (S.sel + 1) + ' VUOTO';
  $('bypBtn').setAttribute('aria-pressed', String(!!(sl && sl.byp)));
  $('bypBtn').hidden = !(sl && sl.fx);
  $('chgBtn').textContent = sl && sl.fx ? 'CAMBIA' : 'SCEGLI';
  pedK.forEach((k) => { drawKnob(k); k.el.style.visibility = sl && sl.fx ? '' : 'hidden'; });
}
let lastTap = { i: -1, t: 0 };
function pedalGestures(b, i) {
  let timer = 0, long = false;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); long = false;
    timer = setTimeout(() => { long = true; S.sel = i; drawPedals(); openFx(); }, 500);
  });
  const cancel = () => clearTimeout(timer);
  b.addEventListener('pointerleave', cancel); b.addEventListener('pointercancel', cancel);
  b.addEventListener('pointerup', () => {
    clearTimeout(timer);
    if (long) return;
    const now = performance.now();
    if (lastTap.i === i && now - lastTap.t < 320) { toggleBypass(i); lastTap = { i: -1, t: 0 }; return; }
    lastTap = { i, t: now };
    selectPedal(i);
  });
  b.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPedal(i); }
    else if (e.key === 'b' || e.key === 'B') toggleBypass(i);
  });
}
function selectPedal(i) { S.sel = i; drawPedals(); save(); if (!S.slots[i].fx) openFx(); else document.querySelector('.pedal[data-i="' + i + '"]').focus(); }
function toggleBypass(i) {
  const sl = S.slots[i]; if (!sl.fx) return;
  sl.byp = !sl.byp; S.sel = i; eng.post({ t: 'byp', i, v: sl.byp }); drawPedals(); save();
}
$('bypBtn').addEventListener('click', () => toggleBypass(S.sel));
$('chgBtn').addEventListener('click', () => openFx());
function openFx() {
  const i = S.sel, list = $('fxList');
  $('fxTitle').textContent = 'SLOT ' + (i + 1);
  list.innerHTML = '';
  for (const k of Object.keys(FX_DEFS)) {
    const d = FX_DEFS[k], b = document.createElement('button');
    b.className = 'hw'; b.setAttribute('aria-pressed', String(S.slots[i].fx === k));
    b.innerHTML = '<span>' + d.name + '</span><small>' + d.info.toUpperCase() + '</small>';
    b.addEventListener('click', () => setFx(i, k));
    list.appendChild(b);
  }
  const none = document.createElement('button');
  none.className = 'hw'; none.innerHTML = '<span>VUOTO</span><small>NESSUN EFFETTO</small>';
  none.addEventListener('click', () => setFx(i, null));
  list.appendChild(none);
  if (i === 3) {
    const rm = document.createElement('button');
    rm.className = 'hw'; rm.innerHTML = '<span>TOGLI LO SLOT</span><small>TORNA A 3 PEDALI</small>';
    rm.addEventListener('click', () => { S.slots.pop(); S.sel = 2; eng.post({ t: 'slot', i: 3, fx: null }); closeSheets(); drawPedals(); save(); });
    list.appendChild(rm);
  }
  openSheet('fxSheet');
}
function setFx(i, fx) {
  const sl = S.slots[i];
  if (sl.fx !== fx) { sl.fx = fx; sl.byp = false; sl.p = fx ? FX_DEFS[fx].def.slice() : [50, 50, 50]; }
  sl.p.forEach((v, j) => eng.set('s' + (i + 1) + 'abc'[j], v));
  eng.post({ t: 'slot', i, fx }); eng.post({ t: 'byp', i, v: sl.byp });
  closeSheets(); drawPedals(); save();
}

// ===================================================================
// SORGENTE: WAV, microfono, REC / OVERDUB / FREEZE
// ===================================================================
function drawSource() {
  $('micBtn').setAttribute('aria-pressed', String(eng.micActive));
  $('recBtn').setAttribute('aria-pressed', String(live.mode === 'rec'));
  $('dubBtn').setAttribute('aria-pressed', String(live.mode === 'dub'));
  $('frzBtn').setAttribute('aria-pressed', String(live.mode === 'freeze'));
  const parts = [];
  if (S.source.name) parts.push(S.source.name);
  if (live.len > 0) parts.push(live.len.toFixed(1).replace('.', ',') + ' s');
  if (eng.micActive) parts.push('MIC ACCESO');
  $('srcInfo').textContent = parts.join(' · ') || 'Carica un WAV o registra dal MIC';
}
$('wavBtn').addEventListener('click', () => $('fileIn').click());
$('fileIn').addEventListener('change', async () => {
  const f = $('fileIn').files && $('fileIn').files[0];
  $('fileIn').value = '';
  if (!f) return;
  await loadAudio(await f.arrayBuffer(), f.name);
});
async function loadAudio(data, name, quiet) {
  if (!(await ensureAudio())) return false;
  let buf;
  try { buf = await eng.decode(data.slice(0)); }
  catch (e) { toast('FILE NON LETTO: usa WAV, MP3, OGG o FLAC. Il nastro resta com\'era.'); return false; }
  eng.load(buf);
  S.source.name = cleanName(name);
  live.len = Math.min(45, buf.duration);
  save(); drawSource();
  if (!quiet && buf.duration > 45) toast('Il nastro tiene 45 s: ho preso l\'inizio del file.');
  // si salva come WAV (al massimo 45 s), così resta anche chiudendo PonyDrone
  const n = Math.min(buf.length, Math.ceil(45 * buf.sampleRate));
  const L = buf.getChannelData(0).subarray(0, n), R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).subarray(0, n);
  audioPut({ name: S.source.name, wav: wavFromFloat(L, R, buf.sampleRate) });
  if (!quiet && !live.playing) setPlay(true);
  return true;
}
const cleanName = (n) => String(n || 'AUDIO').replace(/\.[a-z0-9]+$/i, '').toUpperCase().slice(0, 24);

$('micBtn').addEventListener('click', async () => {
  if (!(await ensureAudio())) return;
  if (eng.micActive) {
    eng.micOff();
    if (live.mode !== 'freeze') setMode('freeze');
  } else await micOn();
  drawSource();
});
async function micOn() {
  try { await eng.micOn(); }
  catch (e) { toast('MICROFONO NON DISPONIBILE: controlla i permessi del browser. Puoi sempre caricare un WAV.'); return false; }
  eng.post({ t: 'monitor', v: S.monitor });
  if (!localStorage.getItem('ponydrone-cuffie')) {
    toast('Con il microfono usa le cuffie: dalle casse il suono rientra e fischia.');
    try { localStorage.setItem('ponydrone-cuffie', '1'); } catch (e) { /* ok */ }
  }
  drawSource();
  return true;
}
$('recBtn').addEventListener('click', async () => {
  if (!(await ensureAudio())) return;
  if (live.mode === 'rec') { setMode('freeze'); return; }
  if (!eng.micActive && !(await micOn())) return;
  S.source.name = 'MIC ' + new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  setMode('rec');
  if (!live.playing) setPlay(true);
});
$('dubBtn').addEventListener('click', async () => {
  if (!(await ensureAudio())) return;
  if (live.mode === 'dub') { setMode('freeze'); return; }
  if (live.len < 0.25) { toast('OVERDUB suona sopra un nastro che c\'è già: prima carica o registra qualcosa.'); return; }
  if (!eng.micActive && !(await micOn())) return;
  setMode('dub');
});
$('frzBtn').addEventListener('click', () => setMode('freeze'));
function setMode(m) { eng.post({ t: 'mode', v: m }); }
eng.onMode = async (m) => {
  const was = live.mode;
  live.mode = m.mode; live.len = m.len;
  drawSource();
  if ((was === 'rec' || was === 'dub') && m.mode === 'freeze' && m.len > 0) {   // ripresa finita: si salva il nastro
    const d = await eng.dump();
    if (d && d.L.length) audioPut({ name: S.source.name || 'MIC', wav: wavFromFloat(d.L, d.R, d.sr) });
    save();
  }
};

// ===================================================================
// TRASPORTO, FREEZE GLOBALE
// ===================================================================
function setPlay(on) {
  live.playing = on;
  eng.post({ t: 'play', v: on });
  const b = $('playBtn');
  b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '■ STOP' : '▶ PLAY';
  keepAwake(on);
}
$('playBtn').addEventListener('click', async () => { if (await ensureAudio()) setPlay(!live.playing); });
$('gfrzBtn').addEventListener('click', () => {
  live.gfreeze = !live.gfreeze;
  eng.post({ t: 'gfreeze', v: live.gfreeze });
  if (live.gfreeze && live.mode !== 'freeze') setMode('freeze');
  $('gfrzBtn').setAttribute('aria-pressed', String(live.gfreeze));
});
async function keepAwake(on) {
  try {
    if (on && !live.wake && navigator.wakeLock) live.wake = await navigator.wakeLock.request('screen');
    else if (!on && live.wake) { await live.wake.release(); live.wake = null; }
  } catch (e) { live.wake = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && live.playing) { live.wake = null; keepAwake(true); } });
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  if (e.target !== document.body && e.target !== document.documentElement) return;
  if (!$('menu').hidden || !$('fxSheet').hidden) return;
  e.preventDefault(); if (eng.running) setPlay(!live.playing);
});

// ===================================================================
// TELEMETRIA → nastro, pad, CAOS
// ===================================================================
const tape = new TapeView($('tape'));
let blinkT = 0;
eng.onTele = (m) => {
  tape.feed(m); pad.feed(m);
  if (m.mode !== live.mode || Math.abs(m.len - live.len) > 0.05) { live.mode = m.mode; live.len = m.len; drawSource(); }
  if (m.ev) {
    const el = macroK.caos.el;
    el.classList.add('blink'); clearTimeout(blinkT); blinkT = setTimeout(() => el.classList.remove('blink'), 120);
  }
  live.load = m.load;
};
eng.onPanic = () => toast('Il feedback è esploso: ho azzerato le code. Abbassa RIPETI o SPAZIO.');

// ===================================================================
// AUDIO: accensione, sospensione (autoplay, iOS)
// ===================================================================
let starting = null;
async function ensureAudio() {
  if (eng.running) return true;
  if (!starting) starting = (async () => {
    try {
      const fresh = !eng.ctx;
      await eng.start(engineParams());
      if (fresh) {
        pushAll();
        eng.ctx.onstatechange = () => { if (eng.ctx.state !== 'running' && eng.ctx.state !== 'closed') showPower('Tocca per riattivare l\'audio'); };
        await restoreAudio();
      }
      $('power').hidden = true;
      return true;
    } catch (e) {
      showPower(e && e.message === 'worklet' ? 'Questo browser non ha AudioWorklet: usa Chrome, Firefox o Safari aggiornati.' : 'L\'audio non parte: riprova.');
      return false;
    } finally { starting = null; }
  })();
  return starting;
}
function showPower(note) { $('powerNote').textContent = note; $('power').hidden = false; }
$('powerBtn').addEventListener('click', () => ensureAudio());

// ===================================================================
// ARCHIVIO NEL BROWSER (IndexedDB): il nastro resta anche chiudendo PonyDrone
// ===================================================================
function openDb(name, store) {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
}
async function idb(name, store, mode, fn) {
  const db = await openDb(name, store);
  if (!db) return null;
  return new Promise((res) => {
    try {
      const tx = db.transaction(store, mode), rq = fn(tx.objectStore(store));
      tx.oncomplete = () => { res(rq ? rq.result : null); db.close(); };
      tx.onerror = tx.onabort = () => { res(null); db.close(); };
    } catch (e) { res(null); db.close(); }
  });
}
const audioPut = (rec) => idb('ponydrone', 'audio', 'readwrite', (s) => s.put(rec, 'src'));
const audioGet = () => idb('ponydrone', 'audio', 'readonly', (s) => s.get('src'));
const audioClear = () => idb('ponydrone', 'audio', 'readwrite', (s) => s.delete('src'));
async function restoreAudio() {
  const rec = await audioGet();
  if (!rec || !rec.wav) return;
  try { const buf = await eng.decode(rec.wav.slice(0)); eng.load(buf); live.len = Math.min(45, buf.duration); S.source.name = rec.name || S.source.name; drawSource(); }
  catch (e) { /* archivio rovinato: nastro vuoto */ }
}

// ===================================================================
// MENU: scena, export, tempo, microfono
// ===================================================================
function openSheet(id) { $(id).hidden = false; const f = $(id).querySelector('button'); if (f) f.focus(); }
function closeSheets() { $('menu').hidden = true; $('fxSheet').hidden = true; }
document.querySelectorAll('.sheet').forEach((sh) => sh.addEventListener('click', (e) => { if (e.target === sh || e.target.closest('[data-close]')) closeSheets(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });
$('menuBtn').addEventListener('click', () => { drawMenu(); openSheet('menu'); });
function drawMenu() {
  $('syncBtn').setAttribute('aria-pressed', String(S.sync));
  $('monBtn').setAttribute('aria-pressed', String(S.monitor));
  $('bpmVal').textContent = String(S.bpm).replace('.', ',');
  document.querySelectorAll('[data-min]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.min === S.expMin)));
  $('expBtn').setAttribute('aria-pressed', String(live.exp));
  $('expBtn').textContent = live.exp ? '■ FERMA E SALVA' : '● REGISTRA L\'USCITA';
  const cpu = live.load ? ' · CPU ' + Math.round(live.load * 100) + '%' : '';
  $('verLine').innerHTML = 'PonyDrone v' + VERSION + cpu + ' · © 2026 Fabio Anghilante · Sad Pony Girl<br><a href="/crediti/" target="_blank" rel="noopener">Crediti e licenze</a> · licenza MIT';
}
$('syncBtn').addEventListener('click', () => { S.sync = !S.sync; eng.post({ t: 'sync', v: S.sync }); drawMenu(); drawKnob(macroK.tempo); save(); });
$('monBtn').addEventListener('click', () => { S.monitor = !S.monitor; eng.post({ t: 'monitor', v: S.monitor }); drawMenu(); save(); });
document.querySelectorAll('[data-bpm]').forEach((b) => b.addEventListener('click', () => {
  S.bpm = clamp(Math.round(S.bpm) + Number(b.dataset.bpm), 30, 240); eng.post({ t: 'bpm', v: S.bpm }); drawMenu(); drawKnob(macroK.tempo); save();
}));
$('durSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-min]'); if (!b) return; S.expMin = +b.dataset.min; drawMenu(); save(); });

// export WAV
let expTimer = 0;
$('expBtn').addEventListener('click', async () => {
  if (live.exp) { expStop(); return; }
  if (!(await ensureAudio())) return;
  await eng.recStart();
  live.exp = true; drawMenu();
  if (!live.playing) setPlay(true);
  const tick = () => {
    if (!live.exp) return;
    const s = eng.recSeconds, mm = Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    $('recBadge').hidden = false; $('recBadge').textContent = '● ' + mm;
    if (s >= S.expMin * 60) { expStop(); return; }
    expTimer = setTimeout(tick, 250);
  };
  tick();
});
function expStop() {
  clearTimeout(expTimer);
  live.exp = false; $('recBadge').hidden = true;
  const blob = eng.recStop();
  drawMenu();
  if (!blob) { toast('Niente da salvare.'); return; }
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  download(blob, 'ponydrone-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.wav');
  toast('WAV salvato nella cartella Download.');
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// scena su file
async function saveScene(withAudio) {
  const out = { app: 'PonyDrone', ver: SCENE_VER, saved: new Date().toISOString(), scene: S };
  if (withAudio) {
    const rec = await audioGet();
    if (rec && rec.wav) out.audio = { name: rec.name, wav: await toBase64(rec.wav) };
  }
  const name = (S.source.name ? S.source.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'scena') + '.ponydrone';
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), 'ponydrone-' + name);
}
function toBase64(buf) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(new Blob([buf])); });
}
$('saveBtn').addEventListener('click', () => saveScene(false));
$('saveAudioBtn').addEventListener('click', () => saveScene(true));
$('openBtn').addEventListener('click', () => $('sceneIn').click());
$('sceneIn').addEventListener('change', async () => {
  const f = $('sceneIn').files && $('sceneIn').files[0];
  $('sceneIn').value = '';
  if (!f) return;
  let file, scene;
  try { file = JSON.parse(await f.text()); } catch (e) { toast('FILE NON LETTO: non è una scena .ponydrone.'); return; }
  if (!file || file.app !== 'PonyDrone') { toast('FILE NON LETTO: non è una scena .ponydrone.'); return; }
  try { scene = upgradeScene({ ...(file.scene || {}), ver: file.ver }); }
  catch (e) {
    toast(e.message === 'futura' ? 'Questa scena viene da una versione più nuova di PonyDrone: aggiorna l\'app (ricarica la pagina) e riprova.' : 'FILE NON LETTO: scena rovinata.');
    return;   // niente caricamenti a metà
  }
  S = scene; applyScene(); save(); closeSheets();
  if (file.audio && file.audio.wav) {
    try { const data = await (await fetch('data:audio/wav;base64,' + file.audio.wav)).arrayBuffer(); await loadAudio(data, file.audio.name, true); }
    catch (e) { toast('Scena aperta, ma l\'audio dentro il file è rovinato.'); }
  }
});
$('newBtn').addEventListener('click', async () => {
  if (!confirm('Nuova scena: manopole e pedali tornano ai valori di partenza e il nastro si svuota. Procedo?')) return;
  S = defaultScene(); applyScene(); save(); closeSheets();
  eng.post({ t: 'clear' }); live.len = 0; audioClear(); drawSource();
});
function applyScene() {
  if (eng.node) pushAll();
  drawEngine(); drawPedals(); redrawKnobs(); drawMenu(); drawSource();
}

// ===================================================================
// MESSAGGI
// ===================================================================
let toastT = 0;
function toast(txt, action, fn) {
  $('toastTxt').textContent = txt;
  const b = $('toastBtn');
  b.hidden = !action;
  if (action) { b.textContent = action; b.onclick = () => { $('toast').hidden = true; fn(); }; }
  $('toast').hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { $('toast').hidden = true; }, action ? 9000 : 5000);
}

// pelle condivisa con PONY84: se la cambi là, cambia anche qui
window.addEventListener('storage', (e) => {
  if (e.key !== 'pony84-skin') return;
  if (e.newValue === 'spg') document.documentElement.dataset.skin = 'spg'; else delete document.documentElement.dataset.skin;
  tape.colors(); pad.colors();
});

applyScene();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* senza offline */ }));
}
