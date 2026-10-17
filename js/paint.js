// The moving background: paint folded into soft bands of pigment, lightly lit, sampled down to
// one flat colour per flap; the board flips flaps whose colour has drifted.
//
// The pattern itself doesn't depend on the colours. So it is worked out once (where the paint is,
// band by band, and how the light falls on it), and any scheme's colours follow from that with a
// little arithmetic: a page, theme or palette change costs no new pattern.
//
// With a real GPU (WebGL2) a shader works the pattern out at 2×2 samples per flap and it is read
// back without waiting (the frame never stalls on the GPU): the board always uses the latest one
// to arrive, at most a few frames old. Without one (software WebGL, no WebGL2, a lost context) the
// same pattern is computed in JavaScript, at one sample per flap and without the lighting, a few
// rows a frame. `lite` says which.

const VS = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uCell;   // CSS pixels per sample
uniform vec2 uSize;   // board size in CSS pixels
uniform float uT;
uniform float uSeed;
out vec4 o;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash2(i + vec2(1.0)), f - vec2(1.0)), u.x), u.y);
}
const mat2 M = mat2(1.6, 1.2, -1.2, 1.6);
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * noise(p); p = M * p; a *= 0.45; }
  return s;
}
// Paint folded by a twice-warped flow field: v is where in the bands of pigment a point is (whole
// numbers on each pigment), h its height, for the light.
float field(vec2 p, float t, out float h) {
  p += vec2(0.12, 0.04) * t;
  vec2 q = vec2(fbm3(p * 0.9 + vec2(0.3 * sin(t * 0.5), 0.27 * cos(t * 0.37))),
                fbm3(p * 0.9 + vec2(5.2, 1.3) + vec2(0.3 * cos(t * 0.43), 0.33 * sin(t * 0.31))));
  vec2 r = vec2(fbm3(p + 3.2 * q + vec2(1.7, 9.2) + 0.2 * t), fbm3(p + 3.2 * q + vec2(8.3, 2.8) - 0.17 * t));
  float v = 5.0 * fbm3(p + 3.0 * r) + 4.5 * r.x + 2.5 * q.y + uSeed;
  float bf = fract(v);
  h = 0.3 * smoothstep(0.0, 0.3, bf) * (1.0 - smoothstep(0.7, 1.0, bf)) + 0.1 * length(r);
  return v;
}

void main() {
  vec2 css = gl_FragCoord.xy * uCell;
  vec2 p = (css - 0.5 * uSize) * (0.95 / uSize.y);
  float h0, hx, hy;
  float v = field(p, uT, h0);
  float e = 0.02;
  field(p + vec2(e, 0.0), uT, hx);
  field(p + vec2(0.0, e), uT, hy);
  vec3 n = normalize(vec3((h0 - hx) / e * 0.06, (h0 - hy) / e * 0.06, 1.0));
  vec3 L = normalize(vec3(-0.5, 0.62, 0.72));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 30.0);
  // Out: v (mod 6, in 16 bits), the light's shading (around 1) and its sheen.
  float q = floor(mod(v, 6.0) / 6.0 * 65535.0 + 0.5);
  o = vec4(floor(q / 256.0) / 255.0, mod(q, 256.0) / 255.0, (mix(1.0, 0.72 + 0.36 * diff, ${0.22}) - 0.9) / 0.15, spec);
}`;

const hexToVec = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// The same pattern in JavaScript (for machines without a usable GPU).

const fract = (x) => x - Math.floor(x);
function noise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  // Gradient at a lattice point, as the shader's hash2.
  const g = (px, py, dx, dy) => (-1 + 2 * fract(Math.sin(px * 127.1 + py * 311.7) * 43758.5453123)) * dx + (-1 + 2 * fract(Math.sin(px * 269.5 + py * 183.3) * 43758.5453123)) * dy;
  const a = g(ix, iy, fx, fy);
  const b = g(ix + 1, iy, fx - 1, fy);
  const c = g(ix, iy + 1, fx, fy - 1);
  const d = g(ix + 1, iy + 1, fx - 1, fy - 1);
  const top = a + (b - a) * ux;
  return top + (c + (d - c) * ux - top) * uy;
}
function fbm3(x, y) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < 3; i++) {
    s += a * noise(x, y);
    // GLSL's mat2(1.6, 1.2, -1.2, 1.6) * p (column-major).
    const nx = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
    x = nx;
    a *= 0.45;
  }
  return s;
}
function fieldAt(x, y, t, seed) {
  x += 0.12 * t;
  y += 0.04 * t;
  const qx = fbm3(x * 0.9 + 0.3 * Math.sin(t * 0.5), y * 0.9 + 0.27 * Math.cos(t * 0.37));
  const qy = fbm3(x * 0.9 + 5.2 + 0.3 * Math.cos(t * 0.43), y * 0.9 + 1.3 + 0.33 * Math.sin(t * 0.31));
  const rx = fbm3(x + 3.2 * qx + 1.7 + 0.2 * t, y + 3.2 * qy + 9.2 + 0.2 * t);
  const ry = fbm3(x + 3.2 * qx + 8.3 - 0.17 * t, y + 3.2 * qy + 2.8 - 0.17 * t);
  return 5 * fbm3(x + 3 * rx, y + 3 * ry) + 4.5 * rx + 2.5 * qy + seed;
}

/** One pattern: `v` per sample (row by row, top first), and on the GPU the light's shading `L`
 *  and sheen `S`; `k` samples a side per switch. */
let fieldSeq = 0;
const newField = (t, cols, rows, k, lit) => ({ id: ++fieldSeq, t, cols, rows, k, v: new Float32Array(cols * rows), L: lit ? new Float32Array(cols * rows) : null, S: lit ? new Float32Array(cols * rows) : null, cache: new Map() });

export class Paint {
  constructor() {
    this.seed = Math.random() * 6;
    this.gl = null;
    try {
      this.initGL();
    } catch (err) {
      console.warn('WebGL paint unavailable; drawing the background on the CPU.', err);
      this.gl = null;
    }
    this.lite = !this.gl; // no usable GPU: the page lightens its load (see main.js)
    this.field = null; // the latest pattern
    this.past = []; // earlier ones, about half a second apart
  }

  initGL() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: true });
    if (!gl) return;
    // Software-emulated WebGL (SwiftShader, llvmpipe, Microsoft's basic renderer) is slower
    // than the JavaScript pattern: treat it as no GPU.
    // (Firefox names the real renderer plainly and warns about the debug extension; Chrome only
    // through the extension.)
    let renderer = String(gl.getParameter(gl.RENDERER));
    if (/^webkit webgl$/i.test(renderer)) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    }
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer) && !/[?&]gpu\b/.test(location.search)) return;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n) => gl.getUniformLocation(prog, n);
    this.u = { cell: u('uCell'), size: u('uSize'), t: u('uT'), seed: u('uSeed') };
    this.fbo = gl.createFramebuffer();
    this.tex = gl.createTexture();
    this.pbo = gl.createBuffer();
    // If the GPU drops the context, carry on in JavaScript.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.dropGL();
    });
    this.gl = gl;
  }

  /** Give up on the GPU (lost): from now on the pattern is computed in JavaScript. */
  dropGL() {
    this.gl = null;
    this.pending = null;
    this.g = null; // (the board is rebuilt for JavaScript's samples: see onLite)
    if (!this.lite) {
      this.lite = true;
      this.onLite?.();
    }
  }

  /** Follow the board's grid (the pattern at time `t` if it needs a new one). The GPU samples a
   *  normal switch 2×2, a half-size one (ASCII mode) once: the same points, so turning ASCII on or
   *  off keeps the pattern. */
  resize(board, small, t) {
    const k = this.gl && !small ? 2 : 1;
    const g = { cols: board.cols * k, rows: board.rows * k, cw: board.cw / board.dpr / k, ch: board.ch / board.dpr / k, k, W: (board.cols * board.cw) / board.dpr, H: (board.rows * board.ch) / board.dpr };
    this.plain = !!small; // (small switches show the paint without its light, as they always have)
    const same = this.g && ['cols', 'rows', 'cw', 'ch'].every((n) => this.g[n] === g[n]);
    this.g = g;
    if (same) {
      // (Same samples, another number to a switch: the patterns carry over.)
      for (const f of [this.field, ...this.past]) if (f) (f.k = k), f.cache.clear(), f.blocks?.clear();
      return;
    }
    this.field = null;
    this.past = [];
    this.pending = null;
    this.work = null;
    if (this.gl) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, g.cols, g.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, g.cols * g.rows * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.viewport(0, 0, g.cols, g.rows);
    }
    this.now(t);
  }

  /** Keep the pattern moving (every frame, with the background's time `t`): a new one is asked of
   *  the GPU every `every` ms and taken when it arrives, or computed a few rows a frame. */
  tick(now, t, every) {
    if (!this.g) return;
    if (this.gl) {
      try {
        if (this.pending) this.collect();
        else if (now - this.askedAt >= every || !(this.askedAt <= now)) this.ask(t, now);
      } catch (err) {
        console.warn('WebGL paint failed; drawing the background on the CPU.', err);
        this.dropGL();
      }
      return;
    }
    if (!this.work && now - (this.askedAt || 0) >= every) {
      this.askedAt = now;
      this.work = this.compute(t);
    }
    // (A few milliseconds' worth a frame.)
    const until = performance.now() + 3;
    while (this.work && performance.now() < until) if (this.work.next().done) this.work = null;
  }

  /** A pattern for time `t` at once (a new grid has none yet). */
  now(t) {
    if (this.gl) {
      this.draw(t);
      const gl = this.gl;
      const px = new Uint8Array(this.g.cols * this.g.rows * 4);
      gl.readPixels(0, 0, this.g.cols, this.g.rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
      this.take(this.decode(px, t));
    } else {
      const w = this.compute(t);
      while (!w.next().done);
    }
  }

  draw(t) {
    const { gl, g, u } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.uniform2f(u.cell, g.cw, g.ch);
    gl.uniform2f(u.size, g.W, g.H);
    gl.uniform1f(u.t, t);
    gl.uniform1f(u.seed, this.seed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Ask the GPU for the pattern at `t`, to be read back once it is done (never waited for). */
  ask(t, now) {
    const gl = this.gl;
    this.askedAt = now;
    this.draw(t);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, this.g.cols, this.g.rows, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.pending = { t, g: this.g, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) };
    gl.flush();
  }

  collect() {
    const gl = this.gl;
    const p = this.pending;
    if (p.g !== this.g) return void (this.pending = null); // (asked for another grid)
    if (gl.getSyncParameter(p.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return;
    gl.deleteSync(p.sync);
    this.pending = null;
    const px = new Uint8Array(this.g.cols * this.g.rows * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.take(this.decode(px, p.t));
  }

  /** The GPU's pixels as a pattern (its rows run bottom-up). */
  decode(px, t) {
    const { cols, rows, k } = this.g;
    const f = newField(t, cols, rows, k, true);
    for (let y = 0; y < rows; y++) {
      for (let x = 0, s = (rows - 1 - y) * cols * 4, d = y * cols; x < cols; x++, s += 4, d++) {
        f.v[d] = ((px[s] * 256 + px[s + 1]) / 65535) * 6;
        f.L[d] = 0.9 + (px[s + 2] / 255) * 0.15;
        f.S[d] = px[s + 3] / 255;
      }
    }
    return f;
  }

  take(f) {
    const last = this.past[this.past.length - 1];
    if (this.field && (!last || this.field.t - last.t >= 0.015)) {
      this.past.push(this.field);
      if (this.past.length > 8) this.past.shift();
    }
    this.field = f;
  }

  /** The pattern at `t` in JavaScript, at one sample per switch, a row at a time. (On a big board
   *  every second switch each way is computed and those between filled in: a quarter of the work.) */
  *compute(t) {
    const { cols, rows, cw, ch, W, H } = this.g;
    const f = newField(t, cols, rows, 1, false);
    const v = f.v;
    const kk = 0.95 / H;
    const step = cols * rows > 500 ? 2 : 1; // (not coarser: ASCII mode turns the interpolation lattice into a visible pattern)
    const on = (n, last) => n % step === 0 || n === last;
    for (let row = 0; row < rows; row++) {
      if (!on(row, rows - 1)) continue;
      // Same coordinates as the shader (whose y runs bottom-up).
      const y = ((rows - row - 0.5) * ch - H / 2) * kk;
      for (let col = 0; col < cols; col++) if (on(col, cols - 1)) v[row * cols + col] = fieldAt(((col + 0.5) * cw - W / 2) * kk, y, t, this.seed);
      yield;
    }
    if (step > 1) {
      for (let row = 0; row < rows; row++) {
        if (!on(row, rows - 1)) continue;
        for (let col = 1; col < cols - 1; col += 2) if (!on(col, cols - 1)) v[row * cols + col] = (v[row * cols + col - 1] + v[row * cols + col + 1]) / 2;
      }
      for (let row = 1; row < rows - 1; row++) {
        if (on(row, rows - 1)) continue;
        for (let col = 0; col < cols; col++) v[row * cols + col] = (v[(row - 1) * cols + col] + v[(row + 1) * cols + col]) / 2;
      }
    }
    if (this.g.cols === cols && this.g.rows === rows) this.take(f);
  }

  /** The background in a scheme's pigments: one RGB triple per switch (row by row, top first), from
   *  the latest pattern, or (`ago`) one about three seconds older. `blocks`: on a board of small
   *  switches, one per 2×2 of them, as a board of normal switches shows it (with its light). The
   *  same object for the same pattern and scheme. */
  frame(scheme, ago = false, blocks = false) {
    let f = this.field;
    if (ago) f = this.past.findLast((p) => p.t <= this.field.t - 0.1) || this.past[0] || f;
    const cache = blocks ? (f.blocks ||= new Map()) : f.cache;
    let out = cache.get(scheme);
    if (out) return out;
    out = { rgb: blocks ? this.colours(f, scheme, f.k * 2, !!f.L) : this.colours(f, scheme) };
    if (cache.size > 8) cache.clear();
    cache.set(scheme, out);
    return out;
  }

  colours(f, scheme, k = f.k, lit = f.L && !this.plain) {
    const pig = scheme.pigments.map(hexToVec).flat();
    const spec = scheme.spec ?? 0.1;
    const cols = f.cols / k;
    const rows = f.rows / k;
    const n = k * k;
    const rgb = new Uint8Array(cols * rows * 3);
    const c = [0, 0, 0];
    const sample = (s) => {
      // (As the shader drew it: a smooth step from one pigment to the next, a faint ridge where
      // bands meet, then the light; each sample rounded to 8 bits.)
      let x = f.v[s] % 6;
      if (x < 0) x += 6;
      const i = Math.floor(x);
      const bf = x - i;
      const m = smooth(0.45, 0.95, bf);
      const ridge = smooth(0, 0.3, bf) * (1 - smooth(0.7, 1, bf));
      const a = i * 3;
      const b = ((i + 1) % 6) * 3;
      const sh = (0.95 + 0.05 * ridge) * (lit ? f.L[s] : 1);
      const add = lit ? spec * f.S[s] : 0;
      for (let ch = 0; ch < 3; ch++) c[ch] = Math.round(Math.min(1, (pig[a + ch] + (pig[b + ch] - pig[a + ch]) * m) * sh + add) * 255);
    };
    for (let row = 0, o = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++, o += 3) {
        if (n === 1) {
          sample(row * f.cols + col);
          rgb[o] = c[0];
          rgb[o + 1] = c[1];
          rgb[o + 2] = c[2];
          continue;
        }
        let r = 0;
        let g = 0;
        let bl = 0;
        for (let sy = 0; sy < k; sy++) {
          for (let sx = 0; sx < k; sx++) {
            sample((row * k + sy) * f.cols + col * k + sx);
            r += c[0];
            g += c[1];
            bl += c[2];
          }
        }
        rgb[o] = r / n;
        rgb[o + 1] = g / n;
        rgb[o + 2] = bl / n;
      }
    }
    return rgb;
  }
}
