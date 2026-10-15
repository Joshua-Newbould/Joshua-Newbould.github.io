// The moving background. A WebGL shader renders it at a couple of samples per flap; each render is
// averaged down to one flat colour per flap, and the board flips flaps whose colour has drifted.
//
//   0  silk     broad, softly warped colour fields with a gentle sheen (the default)
//   1  contour  calm terraces of flat colour over slowly shifting terrain
//   2  drift    a few large, soft glows wandering and blending

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
    // Contour: a few flat terraces over slowly shifting terrain.
    float n = fbm(p * 1.25 + vec2(t * 0.35, -t * 0.22));
    float v = n * 6.5 + 2.5 + uSeed;
    float i = floor(v);
    h = i * 0.08;
    // Flat terraces with a narrow soft edge between them.
    return mix(pig(i), pig(i + 1.0), smoothstep(0.82, 1.0, fract(v)));
  }
  if (uMode == 2) {
    // Drift: a few large glows wandering and blending.
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
  // Silk: one broad, soft warp; colours blend smoothly, no hard edges.
  vec2 q = vec2(fbm(p * 0.7 + vec2(0.0, t * 0.5)), fbm(p * 0.7 + vec2(5.2, 1.3) - vec2(t * 0.4, 0.0)));
  float f = fbm(p * 0.75 + 1.8 * q + vec2(t * 0.15, -t * 0.12));
  h = f;
  return ramp(f * 5.0 + q.x * 2.6 + uSeed);
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

const SS = 2; // samples per flap along each axis

const hexToVec = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export class Paint {
  constructor() {
    this.seed = Math.random() * 6;
    this.mode = 0;
    this.canvas = document.createElement('canvas');
    this.gl = null;
    try {
      this.initGL();
    } catch (err) {
      console.warn('WebGL paint unavailable, using fallback.', err);
      this.gl = null;
    }
  }

  initGL() {
    // Refuse software-emulated WebGL: the CPU fallback is far cheaper there.
    const gl = this.canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
    if (!gl) return;
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
    // If the GPU drops the context, carry on with the CPU fallback.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.gl = null;
    });
    this.gl = gl;
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
      this.fallback(rgb, t, scheme);
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
    // A GPU this slow would stutter the board: switch to the CPU fallback after a few slow frames.
    this.slow = performance.now() - t0 > 40 ? (this.slow || 0) + 1 : 0;
    if (this.slow > 3) this.gl = null;
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

  /** No WebGL: cheap stand-ins for each mode, blending through the same pigments. */
  fallback(rgb, t, scheme) {
    const pig = scheme.pigments.map((h) => hexToVec(h).map((v) => v * 255));
    const at = (i) => pig[((i % 6) + 6) % 6];
    const { cols, rows } = this;
    const H = rows * this.chCss || 1;
    const W = cols * this.cwCss;
    // Drift: a few glows wandering (as in the shader).
    const glows = [0, 1, 2, 3].map((k) => {
      const a = t * (1.4 + k * 0.3) + k * 1.9 + this.seed;
      return [Math.sin(a), Math.cos(a * 0.8 + k * 2.3) * 0.55];
    });
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const o = (row * cols + col) * 3;
        if (this.mode === 2) {
          const px = ((col + 0.5) * this.cwCss - W / 2) * (0.95 / H);
          const py = (H / 2 - (row + 0.5) * this.chCss) * (0.95 / H);
          let wsum = 0.25;
          const c = pig[5].map((v) => v * 0.25);
          glows.forEach(([gx, gy], k) => {
            const w = Math.exp(-((px - gx) ** 2 + (py - gy) ** 2) * 3.2);
            for (let n = 0; n < 3; n++) c[n] += pig[k][n] * w;
            wsum += w;
          });
          for (let n = 0; n < 3; n++) rgb[o + n] = c[n] / wsum;
          continue;
        }
        const x = (col * this.cwCss) / 420;
        const y = (row * this.chCss) / 420;
        const v = (Math.sin(x * 1.1 + t * 1.5 + Math.sin(y * 1.3 - t)) + Math.sin(y * 0.9 - t * 1.2 + Math.sin(x * 0.7 + t * 0.6)) + 2) * 1.5 + this.seed;
        const i = Math.floor(v);
        let f = v - i;
        // Contour: flat terraces with a narrow soft edge; silk: a smooth blend.
        f = this.mode === 1 ? Math.max(0, (f - 0.82) / 0.18) : f;
        const a = at(i);
        const b = at(i + 1);
        for (let k = 0; k < 3; k++) rgb[o + k] = a[k] + (b[k] - a[k]) * f * f * (3 - 2 * f);
      }
    }
  }
}
