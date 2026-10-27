// PonyDrone · grafo audio: worklet → compressore (limiter) → uscita, microfono, export WAV.
// Il lavoro campione per campione sta tutto in worklets/drone-processor.js.

export const PARAMS = ['attivita', 'ripeti', 'forma', 'tempo', 'caos', 'mix', 'spazio', 'livello',
  's1a', 's1b', 's1c', 's2a', 's2b', 's2c', 's3a', 's3b', 's3c', 's4a', 's4b', 's4c'];

export class Engine {
  constructor() {
    this.ctx = null; this.node = null; this.comp = null; this.rec = null;
    this.mic = null; this.micSrc = null;
    this.onTele = null; this.onMode = null; this.onPanic = null;
    this.dumps = new Map(); this.dumpId = 0;
    this.recChunks = null; this.recFrames = 0;
  }

  async start(initial) {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    try { await this.build(initial); }
    catch (e) {   // a metà strada: si butta tutto, il prossimo tocco riparte da zero
      if (this.ctx) this.ctx.close().catch(() => {});
      this.ctx = null; this.node = null; this.comp = null;
      throw e;
    }
  }
  async build(initial) {
    // 'playback': buffer più grandi = meno crackle sui telefoni; per un drone la latenza non conta
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    ctx.resume();   // subito, ancora dentro il tocco dell'utente (Safari è severo)
    if (!ctx.audioWorklet) throw new Error('worklet');
    await ctx.audioWorklet.addModule(new URL('./worklets/drone-processor.js', import.meta.url));
    const parameterData = {};
    for (const k of PARAMS) if (initial && initial[k] != null) parameterData[k] = initial[k];
    this.node = new AudioWorkletNode(ctx, 'ponydrone', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers', parameterData
    });
    // limiter: il worklet ha già DC blocker e soft clip, qui si tengono a bada i picchi rimasti
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -4; comp.knee.value = 4; comp.ratio.value = 12;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    this.node.connect(comp); comp.connect(ctx.destination);
    this.comp = comp;
    this.node.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'tm') { if (this.onTele) this.onTele(m); }
      else if (m.t === 'mode') { if (this.onMode) this.onMode(m); }
      else if (m.t === 'dump') {   // il nastro arriva a pezzi da mezzo secondo
        const r = this.dumps.get(m.id); if (!r) return;
        if (!r.L) { r.L = new Float32Array(m.total); r.R = new Float32Array(m.total); }
        r.L.set(m.L, m.at); r.R.set(m.R, m.at);
        if (m.last) { this.dumps.delete(m.id); r.done({ L: r.L, R: r.R, sr: m.sr }); }
      }
      else if (m.t === 'panic') { if (this.onPanic) this.onPanic(); }
    };
    if (ctx.state !== 'running') await ctx.resume();
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  post(m) { if (this.node) this.node.port.postMessage(m); }
  set(name, v) {
    if (!this.node) return;
    const p = this.node.parameters.get(name);
    if (p) p.setValueAtTime(v, this.ctx.currentTime);
  }

  // ---------------------------------------------------------------- sorgente
  async decode(arrayBuffer) { return this.ctx.decodeAudioData(arrayBuffer); }
  load(audioBuffer) {
    const L = audioBuffer.getChannelData(0).slice();
    const R = (audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : audioBuffer.getChannelData(0)).slice();
    this.node.port.postMessage({ t: 'load', L, R }, [L.buffer, R.buffer]);
  }
  dump() {   // copia del buffer del worklet (per salvarlo come WAV)
    return new Promise((res) => {
      const id = ++this.dumpId;
      this.dumps.set(id, { done: res, L: null, R: null });
      this.post({ t: 'dump', id });
      setTimeout(() => { if (this.dumps.has(id)) { this.dumps.delete(id); res(null); } }, 8000);
    });
  }

  async micOn() {
    if (this.micSrc) return true;
    // niente cancellazione d'eco, soppressione del rumore e guadagno automatico:
    // distruggerebbero code e rumori, cioè il materiale dell'ambient
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } }
    });
    this.mic = stream;
    this.micSrc = this.ctx.createMediaStreamSource(stream);
    this.micSrc.connect(this.node);
    this.post({ t: 'mic', v: true });
    return true;
  }
  micOff() {
    if (this.micSrc) { this.micSrc.disconnect(); this.micSrc = null; }
    if (this.mic) { this.mic.getTracks().forEach((t) => t.stop()); this.mic = null; }
    this.post({ t: 'mic', v: false });
  }
  get micActive() { return !!this.micSrc; }

  // ---------------------------------------------------------------- export WAV (uscita dopo il limiter)
  async recStart() {
    if (!this.rec) {
      this.rec = new AudioWorkletNode(this.ctx, 'ponydrone-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      const mute = this.ctx.createGain(); mute.gain.value = 0;
      this.comp.connect(this.rec); this.rec.connect(mute); mute.connect(this.ctx.destination);   // ascolta, non suona
      this.rec.port.onmessage = (e) => { if (!this.recChunks) return; this.recChunks.push(e.data); this.recFrames += e.data.length / 2; };
    }
    this.recChunks = []; this.recFrames = 0;
    this.rec.port.postMessage({ on: true });
  }
  recStop() {
    if (!this.rec || !this.recChunks) return null;
    this.rec.port.postMessage({ on: false });
    const blob = this.recFrames ? wavFromChunks(this.recChunks, this.recFrames, this.ctx.sampleRate) : null;
    this.recChunks = null;
    return blob;
  }
  get recSeconds() { return this.recChunks && this.ctx ? this.recFrames / this.ctx.sampleRate : 0; }
}

// WAV PCM 16 bit stereo da blocchi Int16 interlacciati (stesso encoder di PONY84)
export function wavFromChunks(chunks, frames, sr) {
  const buf = new ArrayBuffer(44 + frames * 4), v = new DataView(buf);
  header(v, frames, sr);
  const out = new Int16Array(buf, 44); let o = 0;
  for (const c of chunks) { out.set(c.subarray(0, Math.min(c.length, out.length - o)), o); o += c.length; if (o >= out.length) break; }
  return new Blob([buf], { type: 'audio/wav' });
}
// WAV PCM 16 bit stereo da due canali Float32
export function wavFromFloat(L, R, sr) {
  const frames = L.length, buf = new ArrayBuffer(44 + frames * 4), v = new DataView(buf);
  header(v, frames, sr);
  const out = new Int16Array(buf, 44);
  for (let i = 0, j = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
    out[j++] = l < 0 ? l * 32768 : l * 32767; out[j++] = r < 0 ? r * 32768 : r * 32767;
  }
  return buf;
}
function header(v, frames, sr) {
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + frames * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, frames * 4, true);
}
