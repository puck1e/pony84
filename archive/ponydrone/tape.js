// PonyDrone · visualizzazione: il nastro con i rocchetti e il pad XY del motore.
// Nessun LFO "finto": ogni movimento legge la telemetria del worklet (velocità, wow, flutter,
// eventi, posizione nel buffer) e la interpola. Il disegno si ferma da solo in background (rAF).

const css = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb);

function fit(cv, ctx) {
  const d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return [w, h];
}

export class TapeView {
  constructor(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d');
    this.tm = { vel: 0, wow: 0, fl: 0, ev: false, pos: 0, wpos: 0, len: 0, mode: 'freeze', ts: 0 };
    this.ovw = new Float32Array(512);
    this.v = 0; this.ang = 0; this.wow = 0; this.fl = 0; this.jerk = 0; this.pos = 0; this.ph = 0; this.flPh = 0;
    this.colors(); this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }
  colors() {
    this.c = { fg: css('--cream', '#ece4cf'), mute: css('--muted', '#a99f8a'), acc: css('--orange', '#e07b26'),
      pack: css('--line', '#4a453e'), rec: css('--led', '#ff3b2f'), bg: css('--panel', '#2d2a26') };
  }
  feed(m) {
    this.tm = m;
    if (m.ev) this.jerk = 1;
    if (m.ovw) this.ovw = m.ovw;
  }
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const t = this.tm, k = 1 - Math.exp(-dt * 10);
    this.v += (t.vel - this.v) * (1 - Math.exp(-dt * 6));        // inerzia dei rocchetti
    this.wow += (t.wow - this.wow) * k; this.fl += (t.fl - this.fl) * (1 - Math.exp(-dt * 30));
    let dp = t.pos - this.pos; if (dp > 0.5) dp -= 1; if (dp < -0.5) dp += 1;
    this.pos = (this.pos + dp * k + 1) % 1;
    this.jerk *= Math.pow(0.03, dt);
    this.ang += this.v * dt * 2.4;
    this.ph += this.v * dt * 5;
    this.flPh += dt * 40;
    this.draw(now / 1000);
    requestAnimationFrame(this.frame);
  }
  draw(time) {
    const ctx = this.ctx, [W, H] = fit(this.cv, ctx), c = this.c, t = this.tm;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, R = Math.min(H * 0.36, W * 0.2), y = R + 10;
    const lx = cx - W * 0.29, rx = cx + W * 0.29;
    const fill = t.len > 0 ? this.pos : 0.5;
    const hub = R * 0.32, rl = hub + (R - hub) * (1 - fill) * 0.95, rr = hub + (R - hub) * fill * 0.95;
    const jit = this.jerk * 2.5;
    this.reel(lx + (Math.random() - 0.5) * jit, y, R, rl, hub, this.ang * (R / Math.max(rl, 1)) * 0.5);
    this.reel(rx + (Math.random() - 0.5) * jit, y, R, rr, hub, this.ang * (R / Math.max(rr, 1)) * 0.5);

    // guide e testina
    const gy = H - 16, g1 = cx - W * 0.2, g2 = cx + W * 0.2;
    ctx.strokeStyle = c.fg; ctx.lineWidth = 1.5;
    for (const gx of [g1, g2]) { ctx.beginPath(); ctx.arc(gx, gy, 5, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = t.mode === 'rec' || t.mode === 'dub' ? c.rec : c.mute;
    ctx.fillRect(cx - 7, gy + 5, 14, 5);

    // nastro: dai rocchetti alle guide, poi teso (e mosso da wow, flutter, eventi) tra le guide
    const amp = Math.abs(this.wow) * 9 + Math.abs(this.fl) * 2.2 + this.jerk * 9;
    ctx.strokeStyle = c.acc; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx - rl * 0.2, y + rl); ctx.lineTo(g1 - 4, gy - 5);
    const pts = [];
    for (let x = g1; x <= g2; x += 3) {
      const e = Math.sin((x - g1) / (g2 - g1) * Math.PI);
      const yy = gy - 5 + e * (amp * Math.sin(x * 0.045 - this.ph) * (0.6 + 0.4 * Math.sin(time * 1.7))
        + Math.abs(this.fl) * 1.6 * Math.sin(x * 0.3 + this.flPh)
        + (this.jerk > 0.05 ? (Math.random() - 0.5) * this.jerk * 7 : 0));
      ctx.lineTo(x, yy); pts.push(yy);
    }
    ctx.lineTo(rx + rr * 0.2, y + rr);
    ctx.stroke();

    // dentro il nastro: la forma d'onda del materiale che passa sulla testina
    if (t.len > 0) {
      const ov = this.ovw, n = ov.length, win = Math.max(0.04, Math.min(0.5, 3 / Math.max(t.len, 0.1)));
      ctx.fillStyle = c.fg; ctx.globalAlpha = 0.75;
      let i = 0;
      for (let x = g1 + 3; x <= g2 - 3; x += 3, i++) {
        const f = ((this.pos + ((x - cx) / (g2 - g1)) * win) % 1 + 1) % 1;
        const fi = f * (n - 1), a = fi | 0, b = Math.min(n - 1, a + 1);
        const v = ov[a] + (ov[b] - ov[a]) * (fi - a);
        const h = Math.min(24, 1.5 + Math.sqrt(v) * 34);   // radice: si vede anche il materiale piano
        const yy = pts[Math.min(pts.length - 1, i + 1)] ?? gy - 5;
        ctx.fillRect(x - 0.75, yy - h - 3, 1.5, h);
      }
      ctx.globalAlpha = 1;
    }

    // testo: stato e tempo
    ctx.fillStyle = c.mute; ctx.font = '600 11px ' + css('--mono', 'monospace'); ctx.textAlign = 'center';
    const label = t.len <= 0 ? 'NASTRO VUOTO' :
      (t.mode === 'rec' ? '● REC ' : t.mode === 'dub' ? '● OVERDUB ' : '') + t.len.toFixed(1) + ' s' +
      (Math.abs(this.v) < 0.02 ? ' · FERMO' : this.v < 0 ? ' · ◀' : '');
    ctx.fillText(label, cx, 14);
  }
  reel(x, y, R, pack, hub, a) {
    const ctx = this.ctx, c = this.c;
    ctx.strokeStyle = c.fg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = c.pack; ctx.beginPath(); ctx.arc(x, y, pack, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.bg; ctx.beginPath(); ctx.arc(x, y, hub, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, hub, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const b = a + i * Math.PI * 2 / 3;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(b) * hub * 0.35, y + Math.sin(b) * hub * 0.35);
      ctx.lineTo(x + Math.cos(b) * hub * 0.95, y + Math.sin(b) * hub * 0.95); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.stroke();
  }
}

// Pad XY: i grani come punti (x = posizione nel buffer, y = altezza, dimensione = inviluppo),
// la croce è il punto delle due macro assegnate. Toccando si muovono insieme.
export class PadView {
  constructor(cv, onMove) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.onMove = onMove;
    this.g = new Float32Array(0); this.x = 0.5; this.y = 0.5; this.lx = 'X'; this.ly = 'Y';
    this.flash = 0; this.last = performance.now();
    this.colors();
    cv.addEventListener('pointerdown', (e) => this.down(e));
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }
  colors() {
    this.c = { fg: css('--cream', '#ece4cf'), mute: css('--muted', '#a99f8a'), acc: css('--orange', '#e07b26'),
      chaos: css('--red', '#c9372c'), line: css('--line', '#4a453e') };
  }
  feed(m) { this.g = m.g; if (m.ev) this.flash = 1; }
  set(x, y, lx, ly) { this.x = x; this.y = y; this.lx = lx; this.ly = ly; }
  down(e) {
    e.preventDefault();
    const cv = this.cv, id = e.pointerId;
    try { cv.setPointerCapture(id); } catch (err) { /* ok */ }
    const at = (ev) => {
      const r = cv.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
      this.onMove(x, y);
    };
    at(e);
    const move = (ev) => { if (ev.pointerId === id) at(ev); };
    const end = (ev) => {
      if (ev.pointerId !== id) return;
      cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', end); cv.removeEventListener('pointercancel', end);
    };
    cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.flash *= Math.pow(0.01, dt);
    const ctx = this.ctx, [W, H] = fit(this.cv, ctx), c = this.c;
    ctx.clearRect(0, 0, W, H);
    // griglia leggera
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    // grani: y = ottava (-1 … +1 sull'altezza), i grani al contrario nel colore del CAOS
    const g = this.g;
    for (let i = 0; i + 2 < g.length; i += 3) {
      const x = g[i] * W, e = g[i + 1], r = g[i + 2];
      const oct = Math.log2(Math.max(0.25, Math.min(4, Math.abs(r) || 1)));
      const yy = H / 2 - oct * H * 0.38;
      ctx.globalAlpha = 0.25 + 0.75 * e;
      ctx.fillStyle = r < 0 ? c.chaos : c.fg;
      ctx.beginPath(); ctx.arc(x, yy, 1.5 + e * 4.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // croce delle macro
    const px = this.x * W, py = (1 - this.y) * H;
    ctx.strokeStyle = c.acc; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - 16, py); ctx.lineTo(px - 12, py); ctx.moveTo(px + 12, py); ctx.lineTo(px + 16, py);
    ctx.moveTo(px, py - 16); ctx.lineTo(px, py - 12); ctx.moveTo(px, py + 12); ctx.lineTo(px, py + 16); ctx.stroke();
    // etichette degli assi
    ctx.fillStyle = c.mute; ctx.font = '600 10px ' + css('--display', 'sans-serif');
    ctx.textAlign = 'right'; ctx.fillText(this.lx + ' →', W - 6, H - 6);
    ctx.save(); ctx.translate(12, 6); ctx.rotate(Math.PI / 2); ctx.textAlign = 'left'; ctx.fillText('← ' + this.ly, 0, 0); ctx.restore();
    // bordo che lampeggia a ogni evento di CAOS
    if (this.flash > 0.02) { ctx.strokeStyle = c.chaos; ctx.globalAlpha = this.flash; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, W - 3, H - 3); ctx.globalAlpha = 1; }
    requestAnimationFrame(this.frame);
  }
}
