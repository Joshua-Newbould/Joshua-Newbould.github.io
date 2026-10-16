// WebGL2 renderer for the split-flap Board (prototype).
// The Board model (cells, queues, tick, faces) is unchanged; draw(s) only marks a cell dirty and
// render(now) re-encodes dirty cells into an instance buffer and draws the whole board in one
// instanced draw call. The fragment shader replays Board.draw()/drawTiles() per pixel: every
// Canvas2D fill and drawImage is an "over" with analytic vertical coverage, blended in
// sRGB-encoded values and rounded to 8 bits after each step, as the 2D canvas does.
import { Board } from './board.js';

const STRIDE = 28; // int32 slots per cell
const MAX_SRC = 8; // source canvases bound at once (texture units 2..9)
const A = 2048; // atlas size (as Board.glyph)
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in ivec4 aC0; layout(location=1) in vec4 aC1; layout(location=2) in ivec4 aC2;
layout(location=3) in ivec4 aF0; layout(location=4) in ivec4 aF1; layout(location=5) in ivec4 aT0; layout(location=6) in ivec4 aT1;
uniform vec2 uSize; uniform vec2 uCell;
flat out ivec4 vC0; flat out vec4 vC1; flat out ivec4 vC2; flat out ivec4 vF0; flat out ivec4 vF1; flat out ivec4 vT0; flat out ivec4 vT1;
void main(){
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 p = vec2(aC0.xy) + corner * uCell; // device pixels, y down
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
  vC0 = aC0; vC1 = aC1; vC2 = aC2; vF0 = aF0; vF1 = aF1; vT0 = aT0; vT1 = aT1;
}`;

const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DArray;
flat in ivec4 vC0; flat in vec4 vC1; flat in ivec4 vC2; flat in ivec4 vF0; flat in ivec4 vF1; flat in ivec4 vT0; flat in ivec4 vT1;
uniform vec2 uSize; uniform float uNow; uniform int uFlap; uniform bool uFine; uniform bool uStrict;
uniform float uCw, uCh, uFw, uFh, uHy; uniform vec3 uGap;
uniform sampler2D uChrome; uniform sampler2DArray uAtlas;
uniform sampler2D uS0, uS1, uS2, uS3, uS4, uS5, uS6, uS7; uniform vec2 uSrcSize[8];
out vec4 oColor;

const float PI = 3.141592653589793;
vec3 dst; float X, Y; // this pixel, relative to the cell's top-left (integer)

struct Face { int uk; bool mos; bool mbase; int nx; int ny; int mask; vec3 bg; bool bgNull; int ul; ivec2 up; int ml; ivec2 mp; vec3 bgap; };
vec3 rgb(int c){ return vec3(float((c >> 16) & 255), float((c >> 8) & 255), float(c & 255)) / 255.0; }
Face face(ivec4 a, ivec4 b){
  Face f; f.uk = a.x & 3; f.mos = (a.x & 4) != 0; f.nx = (a.x >> 3) & 7; f.ny = (a.x >> 6) & 7; f.mask = (a.x >> 9) & 65535; f.mbase = (a.x & (1 << 25)) != 0;
  f.bgNull = a.y < 0; f.bg = f.bgNull ? uGap : rgb(a.y); f.ul = a.z; f.up = ivec2(a.w, b.x); f.ml = b.y; f.mp = ivec2(b.z & 65535, b.z >> 16); f.bgap = rgb(b.w);
  return f;
}
float q(float v){ return floor(v * 255.0 + 0.5) / 255.0; }
vec3 q(vec3 v){ return floor(v * 255.0 + 0.5) / 255.0; }
vec4 q(vec4 v){ return floor(v * 255.0 + 0.5) / 255.0; }
// Canvas2D fillRect/drawImage over the current pixel: colour c at alpha a (already times coverage).
uniform int uRound;
void fill(vec3 c, float a){
  if (a <= 0.0) return;
  a = min(a, 1.0);
  if (uRound >= 1) a = q(a); // (the canvas keeps alpha in 8 bits)
  dst = q(mix(dst, c, a));
}
void over(vec4 p, float a){
  if (a <= 0.0 || p.a <= 0.0) return;
  if (uRound >= 1) { a = q(a); if (a < 1.0) p = q(p * a); a = 1.0; } // (source scaled to 8 bits first)
  dst = q(p.rgb * a + dst * (1.0 - p.a * a));
}
float cov(float y0, float y1){ return clamp(min(y1, Y + 1.0) - max(y0, Y), 0.0, 1.0); }
uniform int uYc;
// Where a scaled image is sampled for this pixel row: its centre, or (on a row the image only
// partly covers) a point inside the image.
float yc(float dy, float dh){
  if (uYc == 0) return Y + 0.5;
  if (uYc == 1) return clamp(Y + 0.5, dy, dy + dh);
  return (max(dy, Y) + min(dy + dh, Y + 1.0)) * 0.5;
}
float jround(float v){ return floor(v + 0.5); } // JS Math.round

vec4 src(int i, vec2 p){
  vec2 uv = p / uSrcSize[i];
  if (i == 0) return textureLod(uS0, uv, 0.0); if (i == 1) return textureLod(uS1, uv, 0.0);
  if (i == 2) return textureLod(uS2, uv, 0.0); if (i == 3) return textureLod(uS3, uv, 0.0);
  if (i == 4) return textureLod(uS4, uv, 0.0); if (i == 5) return textureLod(uS5, uv, 0.0);
  if (i == 6) return textureLod(uS6, uv, 0.0); return textureLod(uS7, uv, 0.0);
}
vec4 atlas(int layer, vec2 p){ return textureLod(uAtlas, vec3(p / ${A}.0, float(layer)), 0.0); }

// drawImage(atlas, base.x + tx, base.y + sy0, w, ph -> column at tx, rows [dy, dy+dh))
void atlasImg(int layer, ivec2 base, float tx, float sy0, float ph, float dy, float dh){
  float c = cov(dy, dy + dh); if (c <= 0.0) return;
  float sy = sy0 + (yc(dy, dh) - dy) * ph / dh;
  if (uStrict) sy = clamp(sy, sy0 + 0.5, sy0 + ph - 0.5);
  over(atlas(layer, vec2(base) + vec2(X + 0.5, sy)), c);
}
// drawImage(source, sx, sy, w, ph -> rows [dy, dy+dh)), the source rect clipped to the image.
void srcImg(int slot, float sx, float s0, float ph, float dy, float dh){
  vec2 sz = uSrcSize[slot];
  float x = sx + X; if (x < 0.0 || x >= sz.x) return;
  float c0 = max(s0, 0.0), c1 = min(s0 + ph, sz.y); if (c1 <= c0) return;
  float k = dh / ph;
  float c = cov(dy + (c0 - s0) * k, dy + (c1 - s0) * k); if (c <= 0.0) return;
  float sy = s0 + (yc(dy, dh) - dy) / k;
  if (uStrict) sy = clamp(sy, c0 + 0.5, c1 - 0.5);
  over(src(slot, vec2(x + 0.5, sy)), c);
}
// Board.drawPart: rows [py, py+ph) of a face into [dy, dy+dh), columns [0, fw).
void drawPart(Face f, float py, float ph, float dy, float dh){
  if (dh < 0.5 || ph <= 0.0 || X >= uFw) return;
  float c = cov(dy, dy + dh); if (c <= 0.0) return;
  fill(f.bg, c);
  if (f.uk == 1) atlasImg(f.ul, f.up, 0.0, py, ph, dy, dh);
  else if (f.uk == 2) srcImg(f.ul, float(f.up.x), float(f.up.y) + py, ph, dy, dh);
  if (f.mos) atlasImg(f.ml, f.mp, 0.0, py, ph, dy, dh);
}
// The under-face whole, 1:1 over the cell (bare flaps, and what doesn't move under the brush).
void under(Face f, bool pic){
  float w = uCw, h = uCh;
  if (f.uk == 2) { vec2 sz = uSrcSize[f.ul]; w = clamp(sz.x - float(f.up.x), 0.0, uCw); h = clamp(sz.y - float(f.up.y), 0.0, uCh); }
  if (w < uCw || h < uCh) fill(uGap, 1.0);
  if (X < w && Y < h) {
    fill(f.bg, 1.0);
    if (f.uk == 2) srcImg(f.ul, float(f.up.x), float(f.up.y), h, 0.0, h);
  }
  if (pic && f.uk == 1 && X < uFw && Y < uFh) over(atlas(f.ul, vec2(f.up) + vec2(X + 0.5, Y + 0.5)), 1.0);
}
float turnP(float p){
  if (uFlap == 0) { float qq = pow(p, 1.3); return qq * qq * (3.0 - 2.0 * qq); }
  bool snap = uFlap == 2; float land = snap ? 0.74 : 0.78;
  if (p < land) { float u = p / land; return snap ? 0.1 * u + 0.9 * pow(u, 2.6) : 0.2 * u + 0.8 * pow(u, 2.2); }
  float v = (p - land) / (1.0 - land);
  return snap ? 1.0 - 0.045 * sin(PI * v) * (1.0 - v) : 1.0 - 0.075 * abs(sin(2.0 * PI * v)) * pow(1.0 - v, 1.6);
}
void tileBox(int n, int i, float full, out float t0, out float tw){ t0 = jround(float(i) * full / float(n)); tw = jround(float(i + 1) * full / float(n)) - t0; }
bool tileOn(Face f, int t){ return f.mos && ((f.mask >> t) & 1) != 0; }
// Board.brushGutters (only the pixels past the flap's right or bottom edge).
void brushGutters(Face f){
  if (X < uFw && Y < uFh) return;
  for (int j = 0; j < f.ny; j++) for (int i = 0; i < f.nx; i++) {
    if (!tileOn(f, j * f.nx + i)) continue;
    float tx, tw, ty, th; tileBox(f.nx, i, uFw, tx, tw); tileBox(f.ny, j, uFh, ty, th);
    if (i == f.nx - 1 && X >= uFw && Y >= ty && Y < ty + (j == f.ny - 1 ? uCh - ty : th)) { fill(f.bgap, 1.0); return; }
    if (j == f.ny - 1 && Y >= uFh && X >= tx && X < tx + (i == f.nx - 1 ? uCw - tx : tw)) { fill(f.bgap, 1.0); return; }
  }
}
void chrome(vec3 gap, float ca){
  if (ca <= 0.0) return;
  float m = texelFetch(uChrome, ivec2(int(X), int(Y)), 0).a;
  float seam = (Y == uHy && X < uFw) ? 28.0 / 255.0 : 0.0;
  over(vec4(q(gap * m), q(m + seam * (1.0 - m))), ca);
}
// Board.tilePart for the one little flap this pixel is in.
void tilePart(Face f, int t, float tx, float ty, float py, float ph, float dy, float dh){
  if (dh < 0.5 || ph <= 0.0) return;
  float c = cov(dy, dy + dh); if (c <= 0.0) return;
  fill(f.bg, c);
  if (f.uk == 2) srcImg(f.ul, float(f.up.x), float(f.up.y) + ty + py, ph, dy, dh);
  if (tileOn(f, t)) atlasImg(f.ml, f.mp + ivec2(0, int(ty)), 0.0, py, ph, dy, dh);
}

void main(){
  vec2 fc = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  X = floor(fc.x) - float(vC0.x); Y = floor(fc.y) - float(vC0.y);
  vec3 gap = rgb(vC0.z); int flags = vC0.w;
  bool anim = (flags & 1) != 0, tiled = (flags & 2) != 0;
  float t0 = vC1.x, dur = vC1.y, ca = vC1.z, shK = vC1.w;
  vec3 shade = rgb(vC2.x);
  Face from = face(vF0, vF1), to = face(vT0, vT1); // (a still cell: 'to' is what it shows)
  dst = uGap;
  float p = clamp((uNow - t0) / dur, 0.0, 1.0);
  float theta = PI * turnP(p);
  float k = shK * 1.15;
  if (anim && tiled) {
    under(to, false);
    int mnx = to.mos ? to.nx : from.nx, mny = to.mos ? to.ny : from.ny;
    if (X < uFw && Y < uFh) {
      int i = 0, j = 0; float tx, tw, ty, th;
      for (int n = 0; n < 8; n++) { if (n >= mnx) break; tileBox(mnx, n, uFw, tx, tw); if (X < tx + tw) { i = n; break; } }
      for (int n = 0; n < 8; n++) { if (n >= mny) break; tileBox(mny, n, uFh, ty, th); if (Y < ty + th) { j = n; break; } }
      int t = j * mnx + i;
      if (tileOn(from, t) || tileOn(to, t)) {
        if (p >= 1.0) tilePart(to, t, tx, ty, 0.0, th, ty, th);
        else {
          float thy = jround(th / 2.0), tbh = th - thy;
          tilePart(to, t, tx, ty, 0.0, thy, ty, thy);
          tilePart(from, t, tx, ty, thy, tbh, ty + thy, tbh);
          if (theta < PI / 2.0) {
            float sc = cos(theta), h = thy * sc;
            tilePart(from, t, tx, ty, 0.0, thy, ty + thy - h, h);
            fill(shade, k * 0.5 * (1.0 - sc) * cov(ty + thy - h, ty + thy));
            fill(shade, k * 0.3 * sc * cov(ty, ty + thy - h));
          } else {
            float sc = -cos(theta), h = tbh * sc;
            fill(shade, k * 0.28 * (1.0 - sc) * cov(ty + thy, ty + th));
            tilePart(to, t, tx, ty, thy, tbh, ty + thy, h);
            fill(shade, k * 0.4 * (1.0 - sc) * cov(ty + thy, ty + thy + h));
          }
        }
      }
    }
    chrome(gap, ca);
    if (to.mos) brushGutters(to); else if (from.mos && p < 0.5) brushGutters(from);
  } else if (!anim && ca < 1.0) {
    under(to, true);
    if (to.mos && X < uFw && Y < uFh) over(atlas(to.ml, vec2(to.mp) + vec2(X + 0.5, Y + 0.5)), 1.0);
    if (to.mos && to.mbase) brushGutters(to);
    chrome(gap, ca);
  } else {
    if (!anim) drawPart(to, 0.0, uFh, 0.0, uFh);
    else {
      if (ca < 1.0) {
        fill(to.bg, 1.0);
        if (to.uk == 2 && !to.mos) {
          vec2 sz = uSrcSize[to.ul];
          float w = clamp(sz.x - float(to.up.x), 0.0, uCw), h = clamp(sz.y - float(to.up.y), 0.0, uCh);
          if (w > 0.0 && h > 0.0 && X < w && Y < h) srcImg(to.ul, float(to.up.x), float(to.up.y), h, 0.0, h);
        }
      }
      bool lines = uCw >= 12.0 && !uFine, casts = !uFine;
      float hy = uHy, bh = uFh - uHy, fw = uFw;
      drawPart(to, 0.0, hy, 0.0, hy);
      drawPart(from, hy, bh, hy, bh);
      bool inx = X < fw;
      if (theta < PI / 2.0) {
        float sc = cos(theta), h = hy * sc;
        drawPart(from, 0.0, hy, hy - h, h);
        if (inx) {
          fill(shade, k * 0.5 * (1.0 - sc) * cov(hy - h, hy));
          fill(shade, k * 0.3 * sc * cov(0.0, hy - h));
          if (casts) {
            fill(shade, k * 0.22 * (1.0 - sc) * cov(hy, uFh));
            fill(vec3(1.0), 0.09 * sin(2.0 * theta) * cov(hy - h, hy));
          }
          if (lines) fill(vec3(1.0), 0.2 * (1.0 - sc) * cov(hy - h, hy - h + 1.0));
        }
      } else {
        float sc = -cos(theta), h = bh * sc;
        if (inx) fill(shade, k * 0.28 * (1.0 - sc) * cov(hy, uFh));
        drawPart(to, hy, bh, hy, h);
        if (inx) {
          fill(shade, k * 0.4 * (1.0 - sc) * cov(hy, hy + h));
          if (lines) fill(vec3(1.0), 0.2 * (1.0 - sc) * cov(hy + h - 1.0, hy + h));
        }
      }
      if (lines && inx) fill(shade, 0.28 * shK * cov(hy - 0.5, hy + 0.5));
    }
    chrome(gap, ca);
    if (!anim && to.mos && to.mbase) brushGutters(to);
  }
  oColor = vec4(dst, 1.0);
}`;

const colourCache = new Map();
let probe = null;
/** A CSS colour as 0xRRGGBB (or -1 for null). */
export function packColour(c) {
  if (c == null) return -1;
  let v = colourCache.get(c);
  if (v !== undefined) return v;
  if (/^#[0-9a-f]{6}$/i.test(c)) v = parseInt(c.slice(1), 16);
  else if (/^#[0-9a-f]{3}$/i.test(c)) v = parseInt(c[1] + c[1] + c[2] + c[2] + c[3] + c[3], 16);
  else {
    probe ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    probe.fillStyle = '#000';
    probe.fillStyle = c;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    v = (d[0] << 16) | (d[1] << 8) | d[2];
  }
  colourCache.set(c, v);
  return v;
}

export class GLBoard extends Board {
  /** `canvas` gets a webgl2 context; returns null from create() if that isn't possible. */
  static create(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' });
    if (!gl) return null;
    return new GLBoard(canvas, gl, opts);
  }

  constructor(canvas, gl, opts) {
    super(document.createElement('canvas')); // (the model's 2D context is never drawn on)
    this.canvas = canvas;
    this.gl = gl;
    this.strict = !!opts.strict;
    this.yc = opts.yc ?? 0;
    this.round = opts.round ?? 1;
    this.pending = new Set();
    this.all = true;
    this.srcSlots = new Map(); // source id -> { slot, tex, w, h }
    this.slotUse = new Array(MAX_SRC).fill(null);
    this.atlasLayers = 0;
    this.atlasDirty = []; // [layer, x, y, canvas]
    this.t0base = 0;
    this.initGL();
  }

  initGL() {
    const gl = this.gl;
    const sh = (type, s) => {
      const o = gl.createShader(type);
      gl.shaderSource(o, s);
      gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
      return o;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    this.prog = pr;
    gl.useProgram(pr);
    this.u = {};
    for (let i = 0, n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const name = gl.getActiveUniform(pr, i).name.replace('[0]', '');
      this.u[name] = gl.getUniformLocation(pr, name);
    }
    gl.uniform1i(this.u.uChrome, 0);
    gl.uniform1i(this.u.uAtlas, 1);
    for (let i = 0; i < MAX_SRC; i++) gl.uniform1i(this.u['uS' + i], 2 + i);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const B = STRIDE * 4;
    const ia = (loc, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribIPointer(loc, 4, gl.INT, B, off * 4); gl.vertexAttribDivisor(loc, 1); };
    ia(0, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, B, 16); gl.vertexAttribDivisor(1, 1);
    ia(2, 8); ia(3, 12); ia(4, 16); ia(5, 20); ia(6, 24);
    this.chromeTex = gl.createTexture();
    this.atlasTex = gl.createTexture();
    // An empty source for unused units (so every sampler is complete).
    this.emptyTex = this.tex2d(null, 1, 1);
    for (let i = 0; i < MAX_SRC; i++) { gl.activeTexture(gl.TEXTURE2 + i); gl.bindTexture(gl.TEXTURE_2D, this.emptyTex); }
    this.srcSize = new Float32Array(MAX_SRC * 2).fill(1);
  }

  tex2d(source, w, h, tex = this.gl.createTexture()) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  configure(m, fill) {
    this.t0base = performance.now();
    super.configure(m, fill);
    const gl = this.gl;
    this.data = new ArrayBuffer(this.cells.length * STRIDE * 4);
    this.I = new Int32Array(this.data);
    this.F = new Float32Array(this.data);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.all = true;
    // The chrome's coverage (gutter strips and rounded corners), as Board.chrome draws them.
    const { w, h, fw, fh } = this.gm;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(fw, 0, this.gap, h);
    x.fillRect(0, fh, w, this.gap);
    const r = Math.max(1, Math.round(this.dpr * 1.6));
    x.beginPath();
    x.rect(0, 0, fw, fh);
    x.moveTo(r, 0);
    x.arcTo(0, 0, 0, r, r);
    x.arcTo(0, fh, r, fh, r);
    x.arcTo(fw, fh, fw, fh - r, r);
    x.arcTo(fw, 0, fw - r, 0, r);
    x.closePath();
    x.fill('evenodd');
    gl.activeTexture(gl.TEXTURE0);
    this.tex2d(c, 0, 0, this.chromeTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.atlasLayers = 0;
  }

  // The model's drawing entry points only mark cells for the next render().
  draw(s) {
    this.pending.add(s);
  }
  redrawAll() {
    this.all = true;
  }
  release() {
    if (--this.held > 0) return;
    this.held = 0;
    if (this.dirtyAll) this.all = true;
    for (const s of this.dirty) this.pending.add(s);
    this.dirty.clear();
  }

  /** As Board.glyph, but each new picture also goes to the GPU's copy of its atlas page. */
  glyph(f, gm) {
    let g = this.glyphCache.get(f.gk);
    if (g) return g;
    const { fw, fh } = gm;
    const sw = fw + 2;
    const sh = fh + 2;
    const cols = Math.max(1, Math.floor(A / sw));
    if (!this.atlas || this.atlasN >= cols * Math.max(1, Math.floor(A / sh))) {
      if (this.atlases.length >= 6) {
        this.glyphCache.clear();
        this.atlases = [];
        this.all = true; // (every cell re-finds its pictures)
      }
      this.atlas = document.createElement('canvas');
      this.atlas.width = A;
      this.atlas.height = A;
      this.atlases.push(this.atlas);
      this.atlasN = 0;
    }
    const x = (this.atlasN % cols) * sw + 1;
    const y = Math.floor(this.atlasN / cols) * sh + 1;
    this.atlasN++;
    const pic = this.glyphCanvas(f, gm);
    this.atlas.getContext('2d').drawImage(pic, x, y);
    g = { c: this.atlas, x, y, layer: this.atlases.length - 1 };
    this.glyphCache.set(f.gk, g);
    this.atlasDirty.push([g.layer, x, y, pic]);
    return g;
  }

  srcSlot(src) {
    let e = this.srcSlots.get(src.id);
    if (e) return e.slot;
    let slot = this.slotUse.indexOf(null);
    if (slot < 0) throw new Error('prototype: more than ' + MAX_SRC + ' sources');
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2 + slot);
    const tex = this.tex2d(src.canvas);
    e = { slot, tex };
    this.slotUse[slot] = src.id;
    this.srcSlots.set(src.id, e);
    this.srcSize[slot * 2] = src.canvas.width;
    this.srcSize[slot * 2 + 1] = src.canvas.height;
    return slot;
  }

  /** Two ivec4s describing a face. */
  encodeFace(f, o) {
    const I = this.I;
    const mos = f.t === 'mosaic';
    const u = mos ? f.base || null : f;
    let uk = 0, ul = 0, ux = 0, uy = 0;
    if (u && (u.t === 'glyph' || u.t === 'tri')) {
      const g = this.glyph(u, this.gm);
      uk = 1; ul = g.layer; ux = g.x; uy = g.y;
    } else if (u && u.t === 'slice') {
      uk = 2; ul = this.srcSlot(u.src); ux = u.sx; uy = u.sy;
    }
    let ml = 0, mxy = 0, mask = 0, nx = 0, ny = 0, bgap = 0;
    if (mos) {
      const g = this.glyph(f, this.gm);
      ml = g.layer; mxy = g.x | (g.y << 16);
      nx = f.nx; ny = f.ny;
      for (let t = 0; t < f.tiles.length; t++) if (f.tiles[t]) mask |= 1 << t;
      bgap = packColour(f.gap);
    }
    I[o] = uk | (mos ? 4 : 0) | (nx << 3) | (ny << 6) | (mask << 9) | (mos && f.base ? 1 << 25 : 0);
    I[o + 1] = packColour(f.bg);
    I[o + 2] = ul;
    I[o + 3] = ux;
    I[o + 4] = uy;
    I[o + 5] = ml;
    I[o + 6] = mxy;
    I[o + 7] = bgap;
  }

  encode(s) {
    const o = s.i * STRIDE;
    const I = this.I, F = this.F;
    const a = s.anim;
    const gapC = s.gap || this.gapColor;
    const sh = this.shades.get(gapC) || { shade: this.shade, k: this.shadeK };
    I[o] = s.x;
    I[o + 1] = s.y;
    I[o + 2] = packColour(gapC);
    I[o + 3] = (a ? 1 : 0) | (a && this.tiled(a) ? 2 : 0);
    F[o + 4] = a ? a.t0 - this.t0base : 0;
    F[o + 5] = a ? a.dur : 1;
    F[o + 6] = s.ca ?? 1;
    F[o + 7] = sh.k;
    I[o + 8] = packColour(sh.shade);
    this.encodeFace(a ? a.from : s.cur, o + 12);
    this.encodeFace(a ? a.to : s.cur, o + 20);
  }

  /** Bring the GPU's copy up to date and draw the board as it is at `now`. */
  render(now) {
    const gl = this.gl;
    const n = this.cells.length;
    if (!n) return;
    let lo = Infinity, hi = -1;
    if (this.all) {
      // (An atlas reset while encoding sets it again: then encode once more against the new pages.)
      for (let pass = 0; pass < 2 && this.all; pass++) {
        this.all = false;
        for (const s of this.cells) this.encode(s);
      }
      this.all = false;
      lo = 0; hi = n - 1;
      this.pending.clear();
    } else if (this.pending.size) {
      this.ranges = [];
      const idx = [];
      for (const s of this.pending) { this.encode(s); idx.push(s.i); }
      this.pending.clear();
      if (this.all) return this.render(now);
      idx.sort((a, b) => a - b);
      // Coalesce into runs (a gap of up to 64 cells is cheaper to resend than another call).
      let a = idx[0], b = idx[0];
      const runs = [];
      for (let k = 1; k < idx.length; k++) {
        if (idx[k] - b <= 64) b = idx[k];
        else { runs.push([a, b]); a = b = idx[k]; }
      }
      runs.push([a, b]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      if (runs.length > 32) { lo = runs[0][0]; hi = runs[runs.length - 1][1]; }
      else for (const [a0, b0] of runs) gl.bufferSubData(gl.ARRAY_BUFFER, a0 * STRIDE * 4, this.I, a0 * STRIDE, (b0 - a0 + 1) * STRIDE);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (hi >= lo) gl.bufferSubData(gl.ARRAY_BUFFER, lo * STRIDE * 4, this.I, lo * STRIDE, (hi - lo + 1) * STRIDE);
    this.uploadAtlas();
    gl.useProgram(this.prog);
    gl.viewport(0, 0, this.W, this.H);
    const u = this.u;
    gl.uniform2f(u.uSize, this.W, this.H);
    gl.uniform2f(u.uCell, this.cw, this.ch);
    gl.uniform1f(u.uNow, now - this.t0base);
    gl.uniform1i(u.uFlap, this.flap === 'crisp' ? 0 : this.flap === 'clack' ? 1 : 2);
    gl.uniform1i(u.uFine, this.cells.length > 4000 ? 1 : 0);
    gl.uniform1i(u.uStrict, this.strict ? 1 : 0);
    gl.uniform1i(u.uYc, this.yc ?? 0);
    gl.uniform1i(u.uRound, this.round ?? 1);
    gl.uniform1f(u.uCw, this.cw); gl.uniform1f(u.uCh, this.ch);
    gl.uniform1f(u.uFw, this.gm.fw); gl.uniform1f(u.uFh, this.gm.fh); gl.uniform1f(u.uHy, this.gm.hy);
    const g = packColour(this.gapColor);
    gl.uniform3f(u.uGap, ((g >> 16) & 255) / 255, ((g >> 8) & 255) / 255, (g & 255) / 255);
    gl.uniform2fv(u.uSrcSize, this.srcSize);
    for (const e of this.srcSlots.values()) { gl.activeTexture(gl.TEXTURE2 + e.slot); gl.bindTexture(gl.TEXTURE_2D, e.tex); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.chromeTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }

  uploadAtlas() {
    const gl = this.gl;
    const need = Math.max(1, this.atlases.length);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (need > this.atlasLayers) {
      // (Grow the array: reallocate, then copy every page back from its canvas.)
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, A, A, need, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.atlases.forEach((c, l) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, l, A, A, 1, gl.RGBA, gl.UNSIGNED_BYTE, c));
      this.atlasLayers = need;
      this.atlasDirty.length = 0;
    }
    for (const [l, x, y, c] of this.atlasDirty) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, l, c.width, c.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, c);
    this.atlasDirty.length = 0;
  }

  /** Board.tick without the per-frame redraw of turning flaps: only changes are sent. */
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
          if (ca !== s.ca) { s.ca = ca; changed = true; }
        } else {
          s.ca = 1;
          s.eIn = 0;
        }
      }
      if (!s.anim && s.q.length && now >= s.at) {
        const n = s.q.shift();
        s.anim = { from: s.cur, to: n.f, t0: now, dur: n.d, then: n.then };
        if (n.gap) s.gap = n.gap;
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
      if (changed) this.pending.add(s);
      if (!s.anim && !s.q.length && !s.caAnim) this.active.delete(s);
    }
  }
}
