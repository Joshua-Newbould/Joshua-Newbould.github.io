// The board: a fixed grid of identical split-flap cells drawn on a single canvas.
// Every face is a flat colour, a character on a flat colour, or — for giant
// titles only — a crisp slice of a larger piece of type on a flat colour.
// Changing a face never swaps pixels directly — the flap physically flips to it.


const blanks = new Map();
const glyphs = new Map();

/** A plain coloured flap. */
export function blank(bg) {
  let f = blanks.get(bg);
  if (!f) blanks.set(bg, (f = { t: 'blank', bg, key: 'b' + bg }));
  return f;
}

/** A flap carrying one character. Spaces collapse to blanks so they compare equal. */
export function glyph(ch, fg, bg, w = 500) {
  if (ch === ' ' || ch === ' ') return blank(bg);
  const key = 'g' + ch + '|' + fg + '|' + bg + '|' + w;
  let f = glyphs.get(key);
  // `gk` identifies the bitmap, which never contains the background.
  if (!f) glyphs.set(key, (f = { t: 'glyph', ch, fg, bg, w, key, gk: ch + '|' + fg + '|' + w }));
  return f;
}

/** A flap cut along its diagonal: `fg` on one side, `bg` on the other — the rounded
 *  corners of giant titles. `code`: 1 = cut top-left, 2 = top-right, 3 = bottom-left, 4 = bottom-right. */
export function tri(code, fg, bg) {
  const key = 't' + code + '|' + fg + '|' + bg;
  let f = glyphs.get(key);
  if (!f) glyphs.set(key, (f = { t: 'tri', code, fg, bg, key, gk: 'T' + code + '|' + fg }));
  return f;
}

/** Wrap a canvas so slices of it can be referenced (and compared) by id. */
let sourceSeq = 0;
export function source(canvas) {
  return { id: ++sourceSeq, canvas };
}

/** One flap-sized window onto a piece of giant type. With `bg` null the flap's
 *  colour comes from the paint beneath it (resolved later); otherwise it is fixed. */
export function slice(src, sx, sy, bg = null) {
  return { t: 'slice', src, sx, sy, bg, key: 's' + src.id + ':' + sx + ':' + sy + (bg || '') };
}

/** A one-off solid flap (paint and photo cells). Not cached: these colours are unbounded. */
export function solid(bg) {
  return { t: 'blank', bg, key: 'b' + bg };
}

/** Pick an integer cell size near `target` that wastes the fewest pixels of `total`. */
function bestFit(total, target) {
  let best = Math.round(target);
  let bestScore = Infinity;
  for (let k = Math.floor(target * 0.95); k <= Math.ceil(target * 1.05); k++) {
    if (k < 4) continue;
    // Leftover pixels only become a thin centred border, so stay close to the target.
    const score = ((total % k) / k) * 0.6 + (Math.abs(k - target) / target) * 10;
    if (score < bestScore) { bestScore = score; best = k; }
  }
  return best;
}

const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export class Board {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cells = [];
    this.active = new Set();
    this.glyphCache = new Map();
    this.chromes = new Map();
    this.gapColor = '#050506';
  }

  /** Change the colour of the gutters between flaps at once (on start-up).
   *  To change it in a wave, pass `gap` to flip() instead. */
  setGap(color) {
    if (color === this.gapColor) return;
    this.gapColor = color;
    for (const c of this.cells) c.gap = null;
    if (this.cells.length) this.redrawAll();
  }

  /** Grid geometry for a viewport, in device pixels. Pure, so layouts can try several sizes.
   *  The flaps always cover the whole screen: when they don't tile exactly, the outermost
   *  columns are cut evenly at both sides and the last row runs off the bottom edge.
   *  `fullRows` counts only the rows that are wholly visible. */
  static metrics(cssW, cssH, dpr, targetCw, ratio) {
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    const cw = bestFit(W, targetCw * dpr);
    const ch = bestFit(H, cw * ratio);
    const cols = Math.ceil(W / cw);
    const rows = Math.ceil(H / ch);
    const fullRows = Math.floor(H / ch);
    return { cssW, cssH, dpr, W, H, cw, ch, cols, rows, fullRows, ox: -Math.floor((cols * cw - W) / 2), oy: 0 };
  }

  configure(m, fill) {
    Object.assign(this, m);
    const { W, H, cssW, cssH, dpr, cw, ch, cols, rows, ox, oy } = m;
    this.gap = Math.max(1, Math.round(dpr));
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.glyphCache.clear();
    this.chromes.clear();
    this.active.clear();
    this.gm = this.geom(cw, ch);
    const n = cols * rows;
    this.cells = new Array(n);
    for (let i = 0; i < n; i++) {
      this.cells[i] = {
        i, x: ox + (i % cols) * cw, y: oy + ((i / cols) | 0) * ch,
        cur: fill, q: [], anim: null, at: 0, abs: fill, key: fill.key,
        r: 0, g: 0, b: 0, shown: 0, splash: 0, held: false,
      };
    }
    this.redrawAll();
  }

  /** Geometry of a flap occupying a w×h device-pixel slot. */
  geom(w, h) {
    const fw = w - this.gap;
    const fh = h - this.gap;
    const hy = Math.round(fh / 2);
    const fontPx = Math.round(Math.min(w * 1.45, h * 0.66));
    return { w, h, fw, fh, hy, fontPx };
  }

  /** Static overlay giving a flap its physical shape: gutter, rounded corners and a faint hinge seam.
   *  Faces stay one flat colour. */
  chrome(gapColor) {
    const { w, h, fw, fh, hy } = this.gm;
    const id = gapColor;
    let c = this.chromes.get(id);
    if (c) return c;
    const { gap, dpr } = this;
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,0.11)';
    x.fillRect(0, hy, fw, 1);
    x.fillStyle = gapColor;
    x.fillRect(fw, 0, gap, h);
    x.fillRect(0, fh, w, gap);
    // Rounded flap corners: fill everything outside a rounded rect.
    const r = Math.max(1, Math.round(dpr * 1.6));
    x.beginPath();
    x.rect(0, 0, fw, fh);
    x.moveTo(r, 0);
    x.arcTo(0, 0, 0, r, r);
    x.arcTo(0, fh, r, fh, r);
    x.arcTo(fw, fh, fw, fh - r, r);
    x.arcTo(fw, 0, fw - r, 0, r);
    x.closePath();
    x.fill('evenodd');
    this.chromes.set(id, c);
    return c;
  }

  glyphCanvas(f, gm) {
    const id = f.gk;
    let c = this.glyphCache.get(id);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = gm.fw;
    c.height = gm.fh;
    const x = c.getContext('2d');
    if (f.t === 'tri') {
      const { fw, fh } = gm;
      const corners = { 1: [[fw, 0], [fw, fh], [0, fh]], 2: [[0, 0], [fw, fh], [0, fh]], 3: [[0, 0], [fw, 0], [fw, fh]], 4: [[0, 0], [fw, 0], [0, fh]] }[f.code];
      x.fillStyle = f.fg;
      x.beginPath();
      corners.forEach(([px, py], k) => (k ? x.lineTo(px, py) : x.moveTo(px, py)));
      x.fill();
      this.glyphCache.set(id, c);
      return c;
    }
    x.font = `${f.w} ${gm.fontPx}px ${MONO}`;
    x.fillStyle = f.fg;
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    // Centre capitals on the hinge, as on a real split-flap.
    x.fillText(f.ch, gm.fw / 2, gm.hy + Math.round(gm.fontPx * 0.35));
    this.glyphCache.set(id, c);
    return c;
  }

  /** Draw rows [py, py+ph) of a face into the destination band [dy, dy+dh) at column x. */
  drawPart(f, gm, x, py, ph, dy, dh) {
    if (dh < 0.5 || ph <= 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = f.bg;
    ctx.fillRect(x, dy, gm.fw, dh);
    if (f.t === 'glyph' || f.t === 'tri') ctx.drawImage(this.glyphCanvas(f, gm), 0, py, gm.fw, ph, x, dy, gm.fw, dh);
    else if (f.t === 'slice') ctx.drawImage(f.src.canvas, f.sx, f.sy + py, gm.fw, ph, x, dy, gm.fw, dh);
  }

  /** Draw a cell: static, or mid-flip. */
  draw(s, now) {
    const gm = this.gm;
    const { fh, fw, hy } = gm;
    const { x, y } = s;
    const ctx = this.ctx;
    const a = s.anim;
    const ca = s.ca ?? 1; // how much of the flap's edges (gutter, corners, hinge) show
    if (!a && ca < 1) {
      // A "bare" flap: its face covers the whole cell, edges faded in by `ca`, so a grid of
      // bare flaps showing slices of a picture is that picture, seamless.
      const f = s.cur;
      // Only the part of the cell the picture covers takes its colour; beyond a card's right or
      // bottom edge the gutter shows, exactly as around the real card.
      let w = this.cw;
      let h = this.ch;
      if (f.t === 'slice') {
        w = Math.max(0, Math.min(this.cw, f.src.canvas.width - f.sx));
        h = Math.max(0, Math.min(this.ch, f.src.canvas.height - f.sy));
      }
      ctx.fillStyle = this.gapColor;
      if (w < this.cw || h < this.ch) ctx.fillRect(x, y, this.cw, this.ch);
      ctx.fillStyle = f.bg || this.gapColor;
      ctx.fillRect(x, y, w, h);
      if (f.t === 'slice') ctx.drawImage(f.src.canvas, f.sx, f.sy, w, h, x, y, w, h);
      else if (f.t === 'glyph' || f.t === 'tri') ctx.drawImage(this.glyphCanvas(f, gm), x, y);
      if (ca > 0) {
        ctx.globalAlpha = ca;
        ctx.drawImage(this.chrome(s.gap || this.gapColor), x, y);
        ctx.globalAlpha = 1;
      }
      return;
    }
    if (!a) {
      this.drawPart(s.cur, gm, x, 0, fh, y, fh);
    } else {
      if (ca < 1) {
        // Edges fading as it falls: the gutter strips take the face it is landing on, so the
        // flap settles seamlessly into its neighbours.
        const f = a.to;
        ctx.fillStyle = f.bg || this.gapColor;
        ctx.fillRect(x, y, this.cw, this.ch);
        if (f.t === 'slice') {
          const w = Math.max(0, Math.min(this.cw, f.src.canvas.width - f.sx));
          const h = Math.max(0, Math.min(this.ch, f.src.canvas.height - f.sy));
          if (w && h) ctx.drawImage(f.src.canvas, f.sx, f.sy, w, h, x, y, w, h);
        }
      }
      const p = Math.min(1, Math.max(0, (now - a.t0) / a.dur));
      // Gravity: the flap starts slowly and accelerates as it falls.
      const theta = Math.PI * (p * p * 0.55 + p * 0.45);
      const bh = fh - hy;
      this.drawPart(a.to, gm, x, 0, hy, y, hy);
      this.drawPart(a.from, gm, x, hy, bh, y + hy, bh);
      ctx.fillStyle = '#000';
      if (theta < Math.PI / 2) {
        const sc = Math.cos(theta);
        const h = hy * sc;
        this.drawPart(a.from, gm, x, 0, hy, y + hy - h, h);
        ctx.fillStyle = '#000';
        ctx.globalAlpha = 0.5 * (1 - sc);
        ctx.fillRect(x, y + hy - h, fw, h);
        ctx.globalAlpha = 0.3 * sc;
        ctx.fillRect(x, y, fw, hy - h);
      } else {
        const sc = -Math.cos(theta);
        const h = bh * sc;
        ctx.globalAlpha = 0.28 * (1 - sc);
        ctx.fillRect(x, y + hy, fw, bh);
        ctx.globalAlpha = 1;
        this.drawPart(a.to, gm, x, hy, bh, y + hy, h);
        ctx.fillStyle = '#000';
        ctx.globalAlpha = 0.4 * (1 - sc);
        ctx.fillRect(x, y + hy, fw, h);
      }
      ctx.globalAlpha = 1;
    }
    if (ca < 1) ctx.globalAlpha = ca;
    if (ca > 0) ctx.drawImage(this.chrome(s.gap || this.gapColor), x, y);
    ctx.globalAlpha = 1;
  }

  redrawAll() {
    this.ctx.fillStyle = this.gapColor;
    this.ctx.fillRect(0, 0, this.W, this.H);
    const now = performance.now();
    for (const c of this.cells) this.draw(c, now);
  }

  busy(s) {
    if (typeof s === 'number') s = this.cells[s];
    return !!s.anim || s.q.length > 0;
  }

  /** Show a face immediately, without a flip. */
  set(s, f) {
    if (typeof s === 'number') s = this.cells[s];
    s.cur = f;
    s.anim = null;
    const pending = s.q.reduce((g, n) => n.gap || g, null);
    if (pending) s.gap = pending;
    s.q.length = 0;
    this.active.delete(s);
    this.draw(s, 0);
  }

  /** Flip to `f`, optionally via intermediate faces (like a real flap cycling its drum).
   *  A step may be a face, or { f, w } to wait `w` ms before flipping to it.
   *  `then` runs once `f` has landed. A flip already in motion finishes first;
   *  anything still queued is replaced. */
  flip(s, f, { delay = 0, dur = 140, steps = null, stepDur = 70, then = null, gap = null, edgesIn = 0, edgesOut = 0 } = {}) {
    if (typeof s === 'number') s = this.cells[s];
    // A gutter change still queued (a theme wave not yet here) carries over to the new flip.
    const pending = s.q.reduce((g, n) => n.gap || g, null);
    s.q.length = 0;
    // Edge fades tied to the flip itself: edges reach full strength on the very frame the flip
    // starts (fading in over `edgesIn` ms before it), and finish fading just before it lands.
    s.eIn = edgesIn;
    s.eOut = edgesOut;
    s.eFrom = s.ca ?? 1;
    if (edgesIn) s.caAnim = null;
    if (steps) for (const st of steps) s.q.push(st.t ? { f: st, d: stepDur, w: 0 } : { f: st.f, d: stepDur, w: st.w || 0 });
    // `gap`: the gutter around this flap changes colour as the flip starts (theme waves).
    s.q.push({ f, d: dur, w: 0, then, gap: gap || pending });
    s.at = performance.now() + delay;
    this.active.add(s);
  }

  tick(now) {
    for (const s of this.active) {
      let changed = false;
      if (s.anim && now >= s.anim.t0 + s.anim.dur) {
        const done = s.anim;
        s.cur = done.to;
        s.anim = null;
        changed = true;
        if (s.q.length) s.at = Math.max(s.at, now + s.q[0].w);
        if (done.then) {
          done.then();
          if (!this.active.has(s)) continue;
        }
      }
      if (!s.anim && s.q.length && s.eIn) {
        if (now < s.at) {
          const p = Math.max(0, 1 - (s.at - now) / s.eIn);
          const ca = s.eFrom + (1 - s.eFrom) * p;
          if (ca !== s.ca) {
            s.ca = ca;
            changed = true;
          }
        } else {
          s.ca = 1;
          s.eIn = 0;
        }
      }
      if (!s.anim && s.q.length && now >= s.at) {
        const n = s.q.shift();
        s.anim = { from: s.cur, to: n.f, t0: now, dur: n.d, then: n.then };
        if (n.gap) s.gap = n.gap;
        // The last flip: its edges fade while it falls, gone just before it lands.
        if (!s.q.length && s.eOut) {
          s.caAnim = { t0: now + Math.max(0, n.d - s.eOut - 15), dur: s.eOut, from: null, to: 0 };
          s.eOut = 0;
        }
        changed = true;
      }
      const fd = s.caAnim;
      if (fd && now >= fd.t0) {
        if (fd.from === null) fd.from = s.ca ?? 1;
        const p = Math.min(1, (now - fd.t0) / fd.dur);
        s.ca = fd.from + (fd.to - fd.from) * p * p * (3 - 2 * p);
        if (p >= 1) s.caAnim = null;
        changed = true;
      }
      if (s.anim || changed) this.draw(s, now);
      if (!s.anim && !s.q.length && !s.caAnim) this.active.delete(s);
    }
  }

  /** Fade a flap's edges (gutter, corners, hinge) to `to` (0 = bare, 1 = a normal switch). */
  fadeEdges(s, to, { delay = 0, dur = 200 } = {}) {
    if (typeof s === 'number') s = this.cells[s];
    // `from` is read when the fade starts, in case another fade was still running.
    s.caAnim = { t0: performance.now() + delay, dur, from: null, to };
    this.active.add(s);
  }

  /** Set a flap's edge visibility at once. */
  setEdges(s, ca) {
    if (typeof s === 'number') s = this.cells[s];
    s.ca = ca;
    s.caAnim = null;
    s.eIn = 0;
    s.eOut = 0;
    this.draw(s, performance.now());
  }

  /** Grid cell under a CSS-pixel point, or -1. */
  cellAt(cssX, cssY) {
    const col = Math.floor((cssX * this.dpr - this.ox) / this.cw);
    const row = Math.floor((cssY * this.dpr - this.oy) / this.ch);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1;
    return row * this.cols + col;
  }
}
