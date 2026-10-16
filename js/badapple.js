// Bad Apple!! on the board (the Konami code: see secrets.js). Loaded only when the code is typed.
// The frames are a 1-bit stream made by tools/badapple/encode.py: each frame lists the pixels
// that changed since the last as alternating run lengths (unchanged, changed, …).

/** The decoded video, one frame at a time. */
class Frames {
  constructor(buf) {
    const v = new DataView(buf);
    if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'BAPL') throw new Error('not a Bad Apple stream');
    this.w = v.getUint16(4, true);
    this.h = v.getUint16(6, true);
    this.fps = v.getUint16(8, true);
    this.count = v.getUint32(10, true);
    this.data = new Uint8Array(buf, 14);
    this.pos = 0;
    this.index = -1; // the frame `bits` holds
    this.bits = new Uint8Array(this.w * this.h); // 1 = white
  }

  varint() {
    let n = 0;
    let shift = 0;
    let b;
    do {
      b = this.data[this.pos++];
      n |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    return n;
  }

  /** Move on one frame; false at the end. */
  next() {
    if (this.index + 1 >= this.count) return false;
    const { bits } = this;
    let at = 0;
    let changing = false;
    while (at < bits.length) {
      const run = this.varint();
      if (changing) for (let k = at; k < at + run; k++) bits[k] ^= 1;
      at += run;
      changing = !changing;
    }
    this.index++;
    return true;
  }
}

export async function loadFrames(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Frames(await res.arrayBuffer());
}

/**
 * Plays the frames on the board: the switches inside a 4:3 picture (as big as fits, centred)
 * show black or white, flipping as the picture changes; the board around it carries on as
 * usual. A switch showing the picture has `abs` set, so the background drift leaves it be.
 */
export class Player {
  constructor(board, frames, { dark, light, rippleMs = 850, onEnd }) {
    Object.assign(this, { board, frames, dark, light, rippleMs, onEnd });
    this.t0 = null;
    this.cells = null; // the grid the picture was laid on (rebuilt on resize)
    this.done = false;
  }

  /** Which pixel each switch shows (-1: outside the picture), and when the picture first reaches it. */
  layOut() {
    const b = this.board;
    const { w, h } = this.frames;
    const scale = Math.min(b.cssW / w, b.cssH / h);
    const pw = w * scale;
    const ph = h * scale;
    const px0 = (b.cssW - pw) / 2;
    const py0 = (b.cssH - ph) / 2;
    this.pix = new Int32Array(b.cells.length).fill(-1);
    this.delay = new Float32Array(b.cells.length);
    const far = Math.hypot(pw, ph) / 2 || 1;
    for (const c of b.cells) {
      const x = (c.x + b.cw / 2) / b.dpr;
      const y = (c.y + b.ch / 2) / b.dpr;
      const u = Math.floor(((x - px0) / pw) * w);
      const v = Math.floor(((y - py0) / ph) * h);
      if (u < 0 || v < 0 || u >= w || v >= h) continue;
      this.pix[c.i] = v * w + u;
      // (The first time round, the picture ripples out from the middle.)
      this.delay[c.i] = this.first ? (Math.hypot(x - b.cssW / 2, y - b.cssH / 2) / far) * this.rippleMs : 0;
    }
    this.cells = b.cells;
  }

  step(now) {
    if (this.done) return;
    if (this.t0 === null) {
      this.t0 = now;
      this.first = true;
    }
    const want = Math.floor(((now - this.t0) / 1000) * this.frames.fps);
    let ended = false;
    while (this.frames.index < want) {
      if (!this.frames.next()) {
        ended = true;
        break;
      }
    }
    if (this.cells !== this.board.cells) this.layOut();
    const { bits } = this.frames;
    for (const c of this.board.cells) {
      const p = this.pix[c.i];
      if (p < 0) continue;
      const f = bits[p] ? this.light : this.dark;
      if (c.abs === f) continue;
      c.abs = f;
      c.key = f.key;
      this.board.flip(c, f, { delay: this.first ? this.delay[c.i] : 0, dur: this.first ? 200 : 90 });
    }
    this.first = false;
    if (ended) {
      this.done = true;
      setTimeout(() => this.onEnd?.(), 1200);
    }
  }

  /** Hand the switches back to the background. */
  release() {
    this.done = true;
    for (const c of this.board.cells) {
      if (c.abs === this.dark || c.abs === this.light) {
        c.abs = null;
        c.key = null;
      }
    }
  }
}
