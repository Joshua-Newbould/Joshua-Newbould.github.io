// The moving background, sampled down to one flat colour per flap; the board flips flaps whose
// colour has drifted.
//
//   0  silk     paint folded into soft bands of pigment, lightly lit (the default)
//   1  contour  calm terraces of flat colour over slowly shifting terrain
//   2  drift    a few large, soft glows wandering and blending
//
// With a real GPU a WebGL shader renders it at 2×2 samples per flap. Without one (software
// WebGL, no WebGL, or a GPU too slow to keep up) the same field is computed in JavaScript at
// one sample per flap, which costs a few milliseconds every half second. `lite` says which.

const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uCell;   // CSS pixels per sample
uniform vec2 uSize;   // board size in CSS pixels
uniform float uT;
uniform float uSeed;
uniform vec3 uPig[6];
uniform float uSpec;   // strength of the sheen
uniform float uRelief; // how strongly the lighting shades the colour (0 = flat)
uniform int uMode;

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
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = M * p; a *= 0.47; }
  return s;
}
// Smooth, large-scale version for the folding flow field.
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * noise(p); p = M * p; a *= 0.45; }
  return s;
}
vec3 pig(float i) {
  i = mod(i, 6.0);
  vec3 c = uPig[0];
  for (int k = 1; k < 6; k++) if (i >= float(k)) c = uPig[k];
  return c;
}
// A smooth walk through the palette: whole numbers land on each pigment.
vec3 ramp(float v) {
  float i = floor(v);
  return mix(pig(i), pig(i + 1.0), smoothstep(0.0, 1.0, fract(v)));
}

// The field that the colour follows; h is its height, for the sheen.
vec3 field(vec2 p, float t, out float h) {
  if (uMode == 1) {
    float n = fbm(p * 1.25 + vec2(t * 0.35, -t * 0.22));
    float v = n * 6.5 + 2.5 + uSeed;
    float i = floor(v);
    h = i * 0.08;
    return mix(pig(i), pig(i + 1.0), smoothstep(0.82, 1.0, fract(v)));
  }
  if (uMode == 2) {
    vec3 col = pig(5.0) * 0.25;
    float wsum = 0.25;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float a = t * (1.4 + fk * 0.3) + fk * 1.9 + uSeed;
      vec2 c = vec2(sin(a) * 1.0, cos(a * 0.8 + fk * 2.3) * 0.55);
      float w = exp(-dot(p - c, p - c) * 3.2);
      col += pig(fk) * w;
      wsum += w;
    }
    h = 0.0;
    return col / wsum;
  }
  // Silk: paint folded by a twice-warped flow field into soft bands of pigment, with a light
  // ridge where bands meet (between the old thick paint and plain smooth gradients).
  p += vec2(0.12, 0.04) * t;
  vec2 q = vec2(fbm3(p * 0.9 + vec2(0.3 * sin(t * 0.5), 0.27 * cos(t * 0.37))),
                fbm3(p * 0.9 + vec2(5.2, 1.3) + vec2(0.3 * cos(t * 0.43), 0.33 * sin(t * 0.31))));
  vec2 r = vec2(fbm3(p + 3.2 * q + vec2(1.7, 9.2) + 0.2 * t), fbm3(p + 3.2 * q + vec2(8.3, 2.8) - 0.17 * t));
  float f = fbm3(p + 3.0 * r);
  float v = 5.0 * f + 4.5 * r.x + 2.5 * q.y + uSeed;
  float bi = floor(v), bf = fract(v);
  vec3 c = mix(pig(bi), pig(bi + 1.0), smoothstep(0.45, 0.95, bf));
  float ridge = smoothstep(0.0, 0.3, bf) * (1.0 - smoothstep(0.7, 1.0, bf));
  h = 0.3 * ridge + 0.1 * length(r);
  return c * (0.95 + 0.05 * ridge);
}

void main() {
  vec2 css = gl_FragCoord.xy * uCell;
  vec2 p = (css - 0.5 * uSize) * (0.95 / uSize.y);
  float h0, hx, hy;
  vec3 c = field(p, uT, h0);
  if (uRelief > 0.0 && uMode != 2) {
    float e = 0.02;
    field(p + vec2(e, 0.0), uT, hx);
    field(p + vec2(0.0, e), uT, hy);
    vec3 n = normalize(vec3((h0 - hx) / e * 0.06, (h0 - hy) / e * 0.06, 1.0));
    vec3 L = normalize(vec3(-0.5, 0.62, 0.72));
    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 30.0);
    c = c * mix(1.0, 0.72 + 0.36 * diff, uRelief) + vec3(uSpec) * spec;
  }
  gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
}`;

const SS = 2; // samples per flap along each axis (GPU)

const hexToVec = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// ---------------------------------------------------------------------------
// The same field in JavaScript (for machines without a usable GPU).

const fract = (x) => x - Math.floor(x);
function noise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  // Gradient at a lattice point, as the shader's hash2.
  const g = (px, py, dx, dy) => {
    const gx = -1 + 2 * fract(Math.sin(px * 127.1 + py * 311.7) * 43758.5453123);
    const gy = -1 + 2 * fract(Math.sin(px * 269.5 + py * 183.3) * 43758.5453123);
    return gx * dx + gy * dy;
  };
  const n00 = g(ix, iy, fx, fy);
  const n10 = g(ix + 1, iy, fx - 1, fy);
  const n01 = g(ix, iy + 1, fx, fy - 1);
  const n11 = g(ix + 1, iy + 1, fx - 1, fy - 1);
  const a = n00 + (n10 - n00) * ux;
  const b = n01 + (n11 - n01) * ux;
  return a + (b - a) * uy;
}
function fbmN(x, y, octaves, gain) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < octaves; i++) {
    s += a * noise(x, y);
    // GLSL's mat2(1.6, 1.2, -1.2, 1.6) * p (column-major).
    const nx = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
    x = nx;
    a *= gain;
  }
  return s;
}
const fbm = (x, y) => fbmN(x, y, 4, 0.47);
const fbm3 = (x, y) => fbmN(x, y, 3, 0.45);
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class Paint {
  constructor() {
    this.seed = Math.random() * 6;
    this.mode = 0;
    this.canvas = document.createElement('canvas');
    this.gl = null;
    try {
      this.initGL();
    } catch (err) {
      console.warn('WebGL paint unavailable; drawing the background on the CPU.', err);
      this.gl = null;
    }
    this.lite = !this.gl; // no usable GPU: the page lightens its load (see main.js)
  }

  initGL() {
    const gl = this.canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
    if (!gl) return;
    // Software-emulated WebGL (SwiftShader, llvmpipe, Microsoft's basic renderer) is slower
    // than the JavaScript field: treat it as no GPU.
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
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n) => gl.getUniformLocation(prog, n);
    this.u = { cell: u('uCell'), size: u('uSize'), t: u('uT'), seed: u('uSeed'), pig: u('uPig'), spec: u('uSpec'), relief: u('uRelief'), mode: u('uMode') };
    // If the GPU drops the context, carry on in JavaScript.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.dropGL();
    });
    this.gl = gl;
  }

  /** Give up on the GPU (lost, or too slow): from now on the field is computed in JavaScript. */
  dropGL() {
    this.gl = null;
    if (!this.lite) {
      this.lite = true;
      this.onLite?.();
    }
  }

  resize(board) {
    this.cols = board.cols;
    this.rows = board.rows;
    this.cwCss = board.cw / board.dpr;
    this.chCss = board.ch / board.dpr;
    this.w = this.cols * SS;
    this.h = this.rows * SS;
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.pixels = new Uint8Array(this.w * this.h * 4);
    if (this.gl) this.gl.viewport(0, 0, this.w, this.h);
  }

  /** The background at time `t` in a scheme's pigments: one RGB triple per flap (row-major, top row first). */
  frame(t, scheme) {
    const { cols, rows } = this;
    const rgb = new Uint8Array(cols * rows * 3);
    if (!this.gl) {
      this.cpu(rgb, t, scheme);
      return { rgb };
    }
    const gl = this.gl;
    gl.uniform2f(this.u.cell, this.cwCss / SS, this.chCss / SS);
    gl.uniform2f(this.u.size, cols * this.cwCss, rows * this.chCss);
    gl.uniform1f(this.u.t, t);
    gl.uniform1f(this.u.seed, this.seed);
    gl.uniform3fv(this.u.pig, new Float32Array(scheme.pigments.flatMap(hexToVec)));
    gl.uniform1f(this.u.spec, scheme.spec ?? 0.1);
    gl.uniform1f(this.u.relief, scheme.relief ?? 0.35);
    gl.uniform1i(this.u.mode, this.mode);
    const t0 = performance.now();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    // A GPU this slow would stutter the board: switch to JavaScript after a few slow frames.
    this.slow = performance.now() - t0 > 40 ? (this.slow || 0) + 1 : 0;
    if (this.slow > 3) this.dropGL();
    const px = this.pixels;
    const n = SS * SS;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < SS; sy++) {
          // WebGL rows run bottom-up.
          let k = (((rows - 1 - row) * SS + sy) * this.w + col * SS) * 4;
          for (let sx = 0; sx < SS; sx++, k += 4) {
            r += px[k];
            g += px[k + 1];
            b += px[k + 2];
          }
        }
        const o = (row * cols + col) * 3;
        rgb[o] = r / n;
        rgb[o + 1] = g / n;
        rgb[o + 2] = b / n;
      }
    }
    return { rgb };
  }

  /** The shader's field, in JavaScript, at one sample per flap. */
  cpu(rgb, t, scheme) {
    const pig = scheme.pigments.map(hexToVec);
    const pg = (i) => pig[((Math.floor(i) % 6) + 6) % 6];
    const mix3 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    const seed = this.seed;
    const mode = this.mode;
    const field = (x, y) => {
      if (mode === 1) {
        const v = fbm(x * 1.25 + t * 0.35, y * 1.25 - t * 0.22) * 6.5 + 2.5 + seed;
        const i = Math.floor(v);
        return { c: mix3(pg(i), pg(i + 1), smooth(0.82, 1, v - i)), h: i * 0.08 };
      }
      if (mode === 2) {
        const c = pig[5].map((v) => v * 0.25);
        let wsum = 0.25;
        for (let k = 0; k < 4; k++) {
          const a = t * (1.4 + k * 0.3) + k * 1.9 + seed;
          const dx = x - Math.sin(a);
          const dy = y - Math.cos(a * 0.8 + k * 2.3) * 0.55;
          const w = Math.exp(-(dx * dx + dy * dy) * 3.2);
          for (let n = 0; n < 3; n++) c[n] += pig[k][n] * w;
          wsum += w;
        }
        return { c: c.map((v) => v / wsum), h: 0 };
      }
      x += 0.12 * t;
      y += 0.04 * t;
      const qx = fbm3(x * 0.9 + 0.3 * Math.sin(t * 0.5), y * 0.9 + 0.27 * Math.cos(t * 0.37));
      const qy = fbm3(x * 0.9 + 5.2 + 0.3 * Math.cos(t * 0.43), y * 0.9 + 1.3 + 0.33 * Math.sin(t * 0.31));
      const rx = fbm3(x + 3.2 * qx + 1.7 + 0.2 * t, y + 3.2 * qy + 9.2 + 0.2 * t);
      const ry = fbm3(x + 3.2 * qx + 8.3 - 0.17 * t, y + 3.2 * qy + 2.8 - 0.17 * t);
      const f = fbm3(x + 3.0 * rx, y + 3.0 * ry);
      const v = 5.0 * f + 4.5 * rx + 2.5 * qy + seed;
      const i = Math.floor(v);
      const bf = v - i;
      const ridge = smooth(0, 0.3, bf) * (1 - smooth(0.7, 1, bf));
      const c = mix3(pg(i), pg(i + 1), smooth(0.45, 0.95, bf)).map((u) => u * (0.95 + 0.05 * ridge));
      return { c, h: 0.3 * ridge + 0.1 * Math.hypot(rx, ry) };
    };
    const { cols, rows } = this;
    // (No lighting here: it needs two more samples per flap, too costly without a GPU.)
    const W = cols * this.cwCss;
    const H = rows * this.chCss || 1;
    const k = 0.95 / H;
    // The pattern is smooth and large: on a big board, compute every second switch each way and
    // fill in between (a quarter of the work).
    const step = cols * rows > 500 ? 2 : 1;
    const on = (n, last) => n % step === 0 || n === last;
    for (let row = 0; row < rows; row++) {
      if (!on(row, rows - 1)) continue;
      // Same coordinates as the shader (whose y runs bottom-up).
      const y = ((rows - row - 0.5) * this.chCss - H / 2) * k;
      for (let col = 0; col < cols; col++) {
        if (!on(col, cols - 1)) continue;
        const x = ((col + 0.5) * this.cwCss - W / 2) * k;
        const { c } = field(x, y);
        const o = (row * cols + col) * 3;
        for (let n = 0; n < 3; n++) rgb[o + n] = Math.min(1, c[n]) * 255;
      }
    }
    if (step > 1) {
      // Fill in: along the computed rows first, then down the columns between them.
      const lerp = (o, a, b, t) => {
        for (let n = 0; n < 3; n++) rgb[o + n] = rgb[a + n] + (rgb[b + n] - rgb[a + n]) * t;
      };
      for (let row = 0; row < rows; row++) {
        if (!on(row, rows - 1)) continue;
        for (let col = 1; col < cols - 1; col += 2) {
          if (on(col, cols - 1)) continue;
          lerp((row * cols + col) * 3, (row * cols + col - 1) * 3, (row * cols + col + 1) * 3, 0.5);
        }
      }
      for (let row = 1; row < rows - 1; row++) {
        if (on(row, rows - 1)) continue;
        for (let col = 0; col < cols; col++) lerp((row * cols + col) * 3, ((row - 1) * cols + col) * 3, ((row + 1) * cols + col) * 3, 0.5);
      }
    }
  }
}
