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

/** A flap the brush has been over: a little grid of smaller flaps (`tiles`: nx·ny, row by row),
 *  each { ch, fg } a character on `bg` with gutters in `gap`, or null where the brush hasn't
 *  reached, which shows `base` (what the switch showed: a colour, or a piece of a card with its
 *  text). The brushed pieces' picture is drawn once and kept (by `key`); `base` is drawn under it. */
export function mosaic(tiles, nx, ny, bg, gap, key, base = null) {
  return { t: 'mosaic', tiles, nx, ny, bg: base ? base.bg : bg, ink: bg, gap, base, key: 'm' + key + (base ? base.key : ''), gk: 'M' + key };
}

/** A one-off solid flap (paint and photo cells). Not cached: these colours are unbounded. */
export function solid(bg) {
  return { t: 'blank', bg, key: 'b' + bg };
}

/** Pick an integer cell size near `target` that wastes the fewest pixels of `total`. */
function bestFit(total, target, step = 1) {
  let best = Math.max(step, Math.round(target / step) * step);
  let bestScore = Infinity;
  for (let k = Math.floor(target * 0.95); k <= Math.ceil(target * 1.05); k++) {
    if (k < 4 || k % step) continue;
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
    this.shade = '#000'; // the flip's shading colour, and its strength
    this.shadeK = 1;
    this.shades = new Map(); // gutter colour -> the shading that goes with it
  }

  /** How much longer than asked every flip takes (the crisp fall is unhurried). */
  get durScale() {
    return 1.2;
  }

  /** Change the colour of the gutters between flaps at once (on start-up).
   *  To change it in a wave, pass `gap` to flip() instead. */
  setGap(color) {
    if (color === this.gapColor) return;
    this.gapColor = color;
    for (const c of this.cells) c.gap = null;
    if (this.cells.length) this.redrawAll();
  }

  /** The flip's shading for the current gutter colour. A switch shades its flips to match its
   *  own gutter, so one that keeps its old gutter until a wave reaches it keeps its old tint too. */
  setShade(shade, k) {
    this.shade = shade;
    this.shadeK = k;
    this.shades.set(this.gapColor, { shade, k });
  }

  /** Grid geometry for a viewport, in device pixels. Pure, so layouts can try several sizes.
   *  The flaps always cover the whole screen: when they don't tile exactly, the outermost
   *  columns are cut evenly at both sides and the last row runs off the bottom edge.
   *  `fullRows` counts only the rows that are wholly visible. */
  static metrics(cssW, cssH, dpr, targetCw, ratio) {
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    // (Even sizes, so a board of half-size switches lines up with this one exactly: see subdivide.)
    const cw = bestFit(W, targetCw * dpr, 2);
    const ch = bestFit(H, cw * ratio, 2);
    const cols = Math.ceil(W / cw);
    const rows = Math.ceil(H / ch);
    const fullRows = Math.floor(H / ch);
    // (The grid is centred both ways: the part-cut rows and columns are shared between the edges.)
    const oy = -Math.floor((rows * ch - H) / 2);
    return { cssW, cssH, dpr, W, H, cw, ch, cols, rows, fullRows: Math.floor((H - oy) / ch), ox: -Math.floor((cols * cw - W) / 2), oy };
  }

  /** The same board with each switch split into k × k smaller ones, on exactly the same lines. */
  static subdivide(m, k) {
    return { ...m, cw: m.cw / k, ch: m.ch / k, cols: m.cols * k, rows: m.rows * k, fullRows: m.fullRows * k };
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
    if (this.glyphCache.size > 4000) this.glyphCache.clear(); // (the brush's pictures are many: start afresh now and then)
    c = document.createElement('canvas');
    c.width = gm.fw;
    c.height = gm.fh;
    const x = c.getContext('2d');
    if (f.t === 'mosaic') {
      // Little flaps: each a character centred on its own hinge, with fine gutters between.
      const { fw, fh } = gm;
      for (let j = 0; j < f.ny; j++) {
        for (let i = 0; i < f.nx; i++) {
          const x0 = Math.round((i * fw) / f.nx);
          const y0 = Math.round((j * fh) / f.ny);
          const w = Math.round(((i + 1) * fw) / f.nx) - x0;
          const h = Math.round(((j + 1) * fh) / f.ny) - y0;
          const t = f.tiles[j * f.nx + i];
          if (!t) continue; // (a piece the brush hasn't reached: what is under it shows)
          x.fillStyle = f.ink;
          x.fillRect(x0, y0, w, h);
          const px = Math.round(Math.min(w * 1.45, h * 0.66));
          x.font = `600 ${px}px ${MONO}`;
          x.fillStyle = t.fg;
          x.textAlign = 'center';
          x.textBaseline = 'alphabetic';
          x.fillText(t.ch, x0 + w / 2, y0 + Math.round(h / 2) + Math.round(px * 0.35));
          // Gutters the colour of the ones around (the board's, or a section's surface).
          x.fillStyle = f.gap;
          x.fillRect(x0, y0, 1, h);
          x.fillRect(x0, y0, w, 1);
          if (i < f.nx - 1) x.fillRect(x0 + w - 1, y0, 1, h);
          if (j < f.ny - 1) x.fillRect(x0, y0 + h - 1, w, 1);
          x.fillStyle = 'rgba(0,0,0,0.3)';
          x.fillRect(x0, y0 + Math.round(h / 2), w, 1); // (the hinge)
        }
      }
      this.glyphCache.set(id, c);
      return c;
    }
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

  /** What a face shows under the brush's little flaps (itself, if it isn't a brushed one). */
  static under(f) {
    return f.t === 'mosaic' ? f.base : f;
  }

  /** A flip between brushed faces over the same thing (or to and from that thing itself). */
  tiled(a) {
    if (a.from.t !== 'mosaic' && a.to.t !== 'mosaic') return false;
    const u = Board.under(a.from);
    return !!u && u === Board.under(a.to);
  }

  /** Rows [py, py+ph) of one little flap's piece of a face (columns tx…tx+tw, rows from ty), into
   *  the band [dy, dy+dh) at column dx: what is under it, then the brush's character if it has one. */
  tilePart(f, k, tx, ty, tw, py, ph, dx, dy, dh) {
    if (dh < 0.5 || ph <= 0) return;
    const ctx = this.ctx;
    const u = Board.under(f);
    if (u.t === 'slice') {
      ctx.fillStyle = u.bg || this.gapColor;
      ctx.fillRect(dx, dy, tw, dh);
      ctx.drawImage(u.src.canvas, u.sx + tx, u.sy + ty + py, tw, ph, dx, dy, tw, dh);
    } else {
      ctx.fillStyle = u.bg;
      ctx.fillRect(dx, dy, tw, dh);
    }
    if (f.t === 'mosaic' && f.tiles[k]) ctx.drawImage(this.glyphCanvas(f, this.gm), tx, ty + py, tw, ph, dx, dy, tw, dh);
  }

  /** On a bare flap, the gutter strip past the flap's right and bottom edges, beside brushed pieces. */
  brushGutters(f, x, y) {
    const ctx = this.ctx;
    const { fw, fh } = this.gm;
    ctx.fillStyle = f.gap;
    for (let j = 0; j < f.ny; j++) {
      for (let i = 0; i < f.nx; i++) {
        if (!f.tiles[j * f.nx + i]) continue;
        const tx = Math.round((i * fw) / f.nx);
        const ty = Math.round((j * fh) / f.ny);
        const tw = Math.round(((i + 1) * fw) / f.nx) - tx;
        const th = Math.round(((j + 1) * fh) / f.ny) - ty;
        if (i === f.nx - 1) ctx.fillRect(x + fw, y + ty, this.cw - fw, j === f.ny - 1 ? this.ch - ty : th);
        if (j === f.ny - 1) ctx.fillRect(x + tx, y + fh, i === f.nx - 1 ? this.cw - tx : tw, this.ch - fh);
      }
    }
  }

  /** A bare flap whose brushed pieces each fall from one face to the next while the rest stays. */
  drawTiles(s, a, now) {
    const ctx = this.ctx;
    const { fw, fh } = this.gm;
    const { x, y } = s;
    const u = Board.under(a.to);
    const ca = s.ca ?? 1;
    // What doesn't move: what the switch showed (on a section, its piece edge to edge as a bare
    // flap is, and beyond the section's right or bottom edge the gutter, as around it).
    let w = this.cw;
    let h = this.ch;
    if (u.t === 'slice') {
      w = Math.max(0, Math.min(this.cw, u.src.canvas.width - u.sx));
      h = Math.max(0, Math.min(this.ch, u.src.canvas.height - u.sy));
    }
    ctx.fillStyle = this.gapColor;
    if (w < this.cw || h < this.ch) ctx.fillRect(x, y, this.cw, this.ch);
    ctx.fillStyle = u.bg || this.gapColor;
    ctx.fillRect(x, y, w, h);
    if (u.t === 'slice' && w && h) ctx.drawImage(u.src.canvas, u.sx, u.sy, w, h, x, y, w, h);
    const p = Math.min(1, Math.max(0, (now - a.t0) / a.dur));
    const q = p ** 1.3;
    const theta = Math.PI * q * q * (3 - 2 * q);
    const sh = this.shades.get(s.gap || this.gapColor) || { shade: this.shade, k: this.shadeK };
    const k = sh.k * 1.15;
    const m = a.to.t === 'mosaic' ? a.to : a.from;
    for (let j = 0; j < m.ny; j++) {
      for (let i = 0; i < m.nx; i++) {
        const t = j * m.nx + i;
        const from = a.from.t === 'mosaic' ? a.from.tiles[t] : null;
        const to = a.to.t === 'mosaic' ? a.to.tiles[t] : null;
        const tx = Math.round((i * fw) / m.nx);
        const ty = Math.round((j * fh) / m.ny);
        const tw = Math.round(((i + 1) * fw) / m.nx) - tx;
        const th = Math.round(((j + 1) * fh) / m.ny) - ty;
        const dx = x + tx;
        const dy = y + ty;
        if (!from && !to) continue; // (untouched: the section shows)
        if (p >= 1) {
          this.tilePart(a.to, t, tx, ty, tw, 0, th, dx, dy, th);
          continue;
        }
        // The little flap's fall, as a whole switch falls.
        const thy = Math.round(th / 2);
        const tbh = th - thy;
        this.tilePart(a.to, t, tx, ty, tw, 0, thy, dx, dy, thy);
        this.tilePart(a.from, t, tx, ty, tw, thy, tbh, dx, dy + thy, tbh);
        ctx.fillStyle = sh.shade;
        if (theta < Math.PI / 2) {
          const sc = Math.cos(theta);
          const h = thy * sc;
          this.tilePart(a.from, t, tx, ty, tw, 0, thy, dx, dy + thy - h, h);
          ctx.fillStyle = sh.shade;
          ctx.globalAlpha = k * 0.5 * (1 - sc);
          ctx.fillRect(dx, dy + thy - h, tw, h);
          ctx.globalAlpha = k * 0.3 * sc;
          ctx.fillRect(dx, dy, tw, thy - h);
        } else {
          const sc = -Math.cos(theta);
          const h = tbh * sc;
          ctx.globalAlpha = k * 0.28 * (1 - sc);
          ctx.fillRect(dx, dy + thy, tw, tbh);
          ctx.globalAlpha = 1;
          this.tilePart(a.to, t, tx, ty, tw, thy, tbh, dx, dy + thy, h);
          ctx.fillStyle = sh.shade;
          ctx.globalAlpha = k * 0.4 * (1 - sc);
          ctx.fillRect(dx, dy + thy, tw, h);
        }
        ctx.globalAlpha = 1;
      }
    }
    // The switch's own gutter and corners (on the board), then black beside brushed pieces.
    if (ca > 0) {
      ctx.globalAlpha = ca;
      ctx.drawImage(this.chrome(s.gap || this.gapColor), x, y);
      ctx.globalAlpha = 1;
    }
    if (a.to.t === 'mosaic') this.brushGutters(a.to, x, y);
    else if (a.from.t === 'mosaic' && p < 0.5) this.brushGutters(a.from, x, y);
  }

  /** Draw rows [py, py+ph) of a face into the destination band [dy, dy+dh) at column x. */
  drawPart(f, gm, x, py, ph, dy, dh) {
    if (dh < 0.5 || ph <= 0) return;
    const ctx = this.ctx;
    if (f.t === 'mosaic' && f.base) {
      this.drawPart(f.base, gm, x, py, ph, dy, dh);
      ctx.drawImage(this.glyphCanvas(f, gm), 0, py, gm.fw, ph, x, dy, gm.fw, dh);
      return;
    }
    ctx.fillStyle = f.bg;
    ctx.fillRect(x, dy, gm.fw, dh);
    if (f.t === 'glyph' || f.t === 'tri' || f.t === 'mosaic') ctx.drawImage(this.glyphCanvas(f, gm), 0, py, gm.fw, ph, x, dy, gm.fw, dh);
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
    // Where the brush has been, its little flaps fall on their own and the pieces it hasn't
    // touched don't move: the switch as a whole never flips.
    if (a && this.tiled(a)) return this.drawTiles(s, a, now);
    if (!a && ca < 1) {
      // A "bare" flap: its face covers the whole cell, edges faded in by `ca`, so a grid of
      // bare flaps showing slices of a picture is that picture, seamless.
      // (A brushed flap shows what was under it, with the brush's picture on top.)
      const over = s.cur.t === 'mosaic' && s.cur.base ? s.cur : null;
      const f = over ? over.base : s.cur;
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
      else if (f.t === 'glyph' || f.t === 'tri' || f.t === 'mosaic') ctx.drawImage(this.glyphCanvas(f, gm), x, y);
      if (over) {
        ctx.drawImage(this.glyphCanvas(over, gm), x, y);
        this.brushGutters(over, x, y);
      }
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
      // How far the top flap has turned over its hinge (0 … π): the crisp fall, a firm drop that
      // eases into its landing, with the hinge and the flap's edge drawn.
      const lines = this.cw >= 12; // (the hinge and edge lines: invisible on tiny flaps)
      const q = p ** 1.3;
      const turn = q * q * (3 - 2 * q);
      const theta = Math.PI * turn;
      const sh = this.shades.get(s.gap || this.gapColor) || { shade: this.shade, k: this.shadeK };
      const shade = sh.shade;
      const k = sh.k * 1.15;
      const bh = fh - hy;
      this.drawPart(a.to, gm, x, 0, hy, y, hy);
      this.drawPart(a.from, gm, x, hy, bh, y + hy, bh);
      ctx.fillStyle = shade;
      if (theta < Math.PI / 2) {
        const sc = Math.cos(theta);
        const h = hy * sc;
        this.drawPart(a.from, gm, x, 0, hy, y + hy - h, h);
        ctx.fillStyle = shade;
        ctx.globalAlpha = k * 0.5 * (1 - sc);
        ctx.fillRect(x, y + hy - h, fw, h);
        ctx.globalAlpha = k * 0.3 * sc;
        ctx.fillRect(x, y, fw, hy - h);
        if (lines) this.edge(x, y + hy - h, fw, 1 - sc, shade);
      } else {
        const sc = -Math.cos(theta);
        const h = bh * sc;
        ctx.globalAlpha = k * 0.28 * (1 - sc);
        ctx.fillRect(x, y + hy, fw, bh);
        ctx.globalAlpha = 1;
        this.drawPart(a.to, gm, x, hy, bh, y + hy, h);
        ctx.fillStyle = shade;
        ctx.globalAlpha = k * 0.4 * (1 - sc);
        ctx.fillRect(x, y + hy, fw, h);
        if (lines) this.edge(x, y + hy + h - 1, fw, 1 - sc, shade);
      }
      if (lines) {
        // The hinge: a fine dark line across the split while the flap turns.
        ctx.fillStyle = shade;
        ctx.globalAlpha = 0.28 * sh.k;
        ctx.fillRect(x, y + hy - 0.5, fw, 1);
      }
      ctx.globalAlpha = 1;
    }
    if (ca < 1) ctx.globalAlpha = ca;
    if (ca > 0) ctx.drawImage(this.chrome(s.gap || this.gapColor), x, y);
    ctx.globalAlpha = 1;
    if (!a && s.cur.t === 'mosaic' && s.cur.base) this.brushGutters(s.cur, x, y);
  }

  /** A thin catch-light along the flap's moving edge. */
  edge(x, y, w, strength, shade) {
    const ctx = this.ctx;
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.2 * strength;
    ctx.fillRect(x, y, w, 1);
    ctx.fillStyle = shade;
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
    const k = this.durScale;
    if (steps) for (const st of steps) s.q.push(st.t ? { f: st, d: stepDur * k, w: 0 } : { f: st.f, d: stepDur * k, w: st.w || 0 });
    // `gap`: the gutter around this flap changes colour as the flip starts (theme waves).
    s.q.push({ f, d: dur * k, w: 0, then, gap: gap || pending });
    s.at = performance.now() + delay;
    this.active.add(s);
  }

  /** Make a flip in motion land within `ms`: it carries on from where it is, only faster. */
  hurry(s, ms) {
    const a = s.anim;
    if (!a) return;
    const now = performance.now();
    if (a.t0 + a.dur - now <= ms) return;
    const p = Math.min(1, Math.max(0, (now - a.t0) / a.dur));
    a.dur = ms / (1 - p);
    a.t0 = now - p * a.dur;
  }

  /** Drop the flips still waiting (one in motion carries on). */
  dropQueue(s) {
    s.q.length = 0;
  }

  tick(now) {
    // With very many flaps moving at once (a wave across a board of small switches), each flap
    // still turning is redrawn every other frame, alternate halves of the board in turn; one
    // starting or landing is always drawn at once.
    const every = this.active.size > 1500 ? 2 : 1;
    this.tickNo = (this.tickNo || 0) + 1;
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
      if (changed || (s.anim && (s.i + this.tickNo) % every === 0)) this.draw(s, now);
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
