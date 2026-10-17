// The board drawn by the GPU (WebGL2), where it has one. The model is Board's, unchanged: cells,
// queues, tick, faces, the glyph atlas. Only the drawing differs: a switch that changes is
// written into one buffer (a few numbers per switch), and each frame the whole board is one draw
// call. Its fragment shader replays, pixel by pixel, exactly what Board.draw() and drawTiles()
// do on a 2D canvas: every fill and picture composited in the same order, in the same sRGB
// values, rounded to 8 bits after each step as the canvas does, so the two look the same to
// within a level or two. A flap's progress is worked out on the GPU, so a switch in motion costs
// no JavaScript between starting and landing.
// Anything that goes wrong here falls back to drawing nothing new, never to throwing: main.js
// swaps in the 2D board if the GPU is lost for good (see onfail).
import { Board } from './board.js?v=4c6f054';

const STRIDE = 28; // int32s per switch (see encode)
const SOURCES = 12; // pictures (sections' snapshots, the old board) bound at once: units 3…14
const PAGES = 6; // glyph atlas pages at most (Board.glyph starts afresh beyond)
const A = 2048; // an atlas page's size (as Board.glyph)
const TURN = 2048; // samples of Board.turn(p) in the shader's lookup

const VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in ivec4 aC0; layout(location=1) in vec4 aC1; layout(location=2) in ivec4 aC2;
layout(location=3) in ivec4 aF0; layout(location=4) in ivec4 aF1; layout(location=5) in ivec4 aT0; layout(location=6) in ivec4 aT1;
uniform vec2 uSize, uCell; uniform float uNow; uniform int uFrame;
flat out ivec4 vC0; flat out vec4 vC1; flat out ivec4 vC2; flat out ivec4 vF0; flat out ivec4 vF1; flat out ivec4 vT0; flat out ivec4 vT1;
void main() {
  // Only the switches that changed this frame (stamped with it) and those turning are drawn: the
  // rest keep their pixels in the frame. (A switch skipped is a quad of nothing, off screen.)
  if (aC2.z != uFrame && !((aC0.w & 1) != 0 && uNow <= aC1.x + aC1.y + 50.0)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // (One quad per switch, from the vertex number: no vertex buffer.)
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 p = vec2(aC0.xy) + corner * uCell;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
  vC0 = aC0; vC1 = aC1; vC2 = aC2; vF0 = aF0; vF1 = aF1; vT0 = aT0; vT1 = aT1;
}`;

const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DArray;
flat in ivec4 vC0; flat in vec4 vC1; flat in ivec4 vC2; flat in ivec4 vF0; flat in ivec4 vF1; flat in ivec4 vT0; flat in ivec4 vT1;
uniform vec2 uSize; uniform float uNow; uniform bool uFine, uLines;
uniform float uCw, uCh, uFw, uFh, uHy;
uniform sampler2D uChrome, uTurn; uniform sampler2DArray uAtlas;
uniform sampler2D uS0, uS1, uS2, uS3, uS4, uS5, uS6, uS7, uS8, uS9, uS10, uS11; uniform vec2 uSrcSize[${SOURCES}];
out vec4 oColor;

const float PI = 3.141592653589793;
vec3 dst; float X, Y; // this pixel (its colour so far, and where it is in its cell: integers, y down)
vec3 boardGap; // the board's gutter colour (as this switch was last drawn)

struct Face { int uk; bool mos; bool mbase; int nx; int ny; int mask; vec3 bg; int ul; ivec2 up; int ml; ivec2 mp; vec3 bgap; };
vec3 rgb(int c) { return vec3(float((c >> 16) & 255), float((c >> 8) & 255), float(c & 255)) / 255.0; }
Face face(ivec4 a, ivec4 b) {
  Face f; f.uk = a.x & 3; f.mos = (a.x & 4) != 0; f.nx = (a.x >> 3) & 7; f.ny = (a.x >> 6) & 7; f.mask = (a.x >> 9) & 65535; f.mbase = (a.x & (1 << 25)) != 0;
  f.bg = a.y < 0 ? boardGap : rgb(a.y); f.ul = a.z; f.up = ivec2(a.w, b.x); f.ml = b.y; f.mp = ivec2(b.z & 65535, b.z >> 16); f.bgap = rgb(b.w);
  return f;
}
// (The canvas keeps 8 bits a channel: every step is rounded, as it is there.)
float q(float v) { return floor(v * 255.0 + 0.5) / 255.0; }
vec3 q(vec3 v) { return floor(v * 255.0 + 0.5) / 255.0; }
vec4 q(vec4 v) { return floor(v * 255.0 + 0.5) / 255.0; }
// A fillRect over this pixel: colour c at alpha a (times how much of the pixel it covers).
void fill(vec3 c, float a) {
  if (a <= 0.0) return;
  a = q(min(a, 1.0));
  dst = q(mix(dst, c, a));
}
// A drawImage over this pixel: premultiplied p at alpha a.
void over(vec4 p, float a) {
  if (a <= 0.0 || p.a <= 0.0) return;
  a = q(a);
  if (a < 1.0) p = q(p * a);
  dst = q(p.rgb + dst * (1.0 - p.a));
}
// How much of this pixel's row a band [y0, y1) covers (fractional edges are antialiased).
float cov(float y0, float y1) { return clamp(min(y1, Y + 1.0) - max(y0, Y), 0.0, 1.0); }
float jround(float v) { return floor(v + 0.5); } // (JavaScript's Math.round)
// Board.turn(p), from its samples.
float turn(float p) {
  float f = p * ${TURN - 1}.0;
  int i = int(min(floor(f), ${TURN - 2}.0));
  return mix(texelFetch(uTurn, ivec2(i, 0), 0).r, texelFetch(uTurn, ivec2(i + 1, 0), 0).r, f - float(i));
}

vec4 src(int i, vec2 p) {
  vec2 uv = p / uSrcSize[i];
  // (GLSL can't index samplers by a variable.)
  if (i < 6) {
    if (i == 0) return textureLod(uS0, uv, 0.0); if (i == 1) return textureLod(uS1, uv, 0.0);
    if (i == 2) return textureLod(uS2, uv, 0.0); if (i == 3) return textureLod(uS3, uv, 0.0);
    if (i == 4) return textureLod(uS4, uv, 0.0); return textureLod(uS5, uv, 0.0);
  }
  if (i == 6) return textureLod(uS6, uv, 0.0); if (i == 7) return textureLod(uS7, uv, 0.0);
  if (i == 8) return textureLod(uS8, uv, 0.0); if (i == 9) return textureLod(uS9, uv, 0.0);
  if (i == 10) return textureLod(uS10, uv, 0.0); return textureLod(uS11, uv, 0.0);
}
vec4 atlas(int layer, vec2 p) { return textureLod(uAtlas, vec3(p / ${A}.0, float(layer)), 0.0); }

// A character's picture is white: it takes the face's ink colour (a brush picture has its own).
vec4 ink(vec4 p, Face f) { return f.mos ? p : vec4(f.bgap * p.a, p.a); }
// drawImage(atlas, base.x, base.y + sy0, fw, ph -> rows [dy, dy+dh)): a scaled picture is sampled
// at the pixel's centre, bilinear, as the canvas does.
void atlasImg(int layer, ivec2 base, float sy0, float ph, float dy, float dh) {
  float c = cov(dy, dy + dh); if (c <= 0.0) return;
  float sy = sy0 + (Y + 0.5 - dy) * ph / dh;
  over(atlas(layer, vec2(base) + vec2(X + 0.5, sy)), c);
}
void glyphImg(Face f, float py, float ph, float dy, float dh) {
  float c = cov(dy, dy + dh); if (c <= 0.0) return;
  over(ink(atlas(f.ul, vec2(f.up) + vec2(X + 0.5, py + (Y + 0.5 - dy) * ph / dh)), f), c);
}
// drawImage(source, sx, s0, fw, ph -> rows [dy, dy+dh)), the source rectangle clipped to the picture.
void srcImg(int slot, float sx, float s0, float ph, float dy, float dh) {
  vec2 sz = uSrcSize[slot];
  float x = sx + X; if (x < 0.0 || x >= sz.x) return;
  float c0 = max(s0, 0.0), c1 = min(s0 + ph, sz.y); if (c1 <= c0) return;
  float k = dh / ph;
  float c = cov(dy + (c0 - s0) * k, dy + (c1 - s0) * k); if (c <= 0.0) return;
  over(src(slot, vec2(x + 0.5, s0 + (Y + 0.5 - dy) / k)), c);
}
// Board.drawPart: rows [py, py+ph) of a face into [dy, dy+dh).
void drawPart(Face f, float py, float ph, float dy, float dh) {
  if (dh < 0.5 || ph <= 0.0 || X >= uFw) return;
  float c = cov(dy, dy + dh); if (c <= 0.0) return;
  fill(f.bg, c);
  if (f.uk == 1) glyphImg(f, py, ph, dy, dh);
  else if (f.uk == 2) srcImg(f.ul, float(f.up.x), float(f.up.y) + py, ph, dy, dh);
  if (f.mos) atlasImg(f.ml, f.mp, py, ph, dy, dh);
}
// What a face shows under the brush, whole and 1:1 over the cell (a bare flap; what doesn't move
// under the brush), with its picture if 'pic'.
void under(Face f, bool pic) {
  float w = uCw, h = uCh;
  if (f.uk == 2) { vec2 sz = uSrcSize[f.ul]; w = clamp(sz.x - float(f.up.x), 0.0, uCw); h = clamp(sz.y - float(f.up.y), 0.0, uCh); }
  if (w < uCw || h < uCh) fill(boardGap, 1.0);
  if (X < w && Y < h) {
    fill(f.bg, 1.0);
    if (f.uk == 2) srcImg(f.ul, float(f.up.x), float(f.up.y), h, 0.0, h);
  }
  if (pic && f.uk == 1 && X < uFw && Y < uFh) over(ink(atlas(f.ul, vec2(f.up) + vec2(X + 0.5, Y + 0.5)), f), 1.0);
}
void tileBox(int n, int i, float full, out float t0, out float tw) { t0 = jround(float(i) * full / float(n)); tw = jround(float(i + 1) * full / float(n)) - t0; }
bool tileOn(Face f, int t) { return f.mos && ((f.mask >> t) & 1) != 0; }
// Board.brushGutters (only pixels past the flap's right or bottom edge can be in one).
void brushGutters(Face f) {
  if (X < uFw && Y < uFh) return;
  for (int j = 0; j < f.ny; j++) for (int i = 0; i < f.nx; i++) {
    if (!tileOn(f, j * f.nx + i)) continue;
    float tx, tw, ty, th; tileBox(f.nx, i, uFw, tx, tw); tileBox(f.ny, j, uFh, ty, th);
    if (i == f.nx - 1 && X >= uFw && Y >= ty && Y < ty + (j == f.ny - 1 ? uCh - ty : th)) { fill(f.bgap, 1.0); return; }
    if (j == f.ny - 1 && Y >= uFh && X >= tx && X < tx + (i == f.nx - 1 ? uCw - tx : tw)) { fill(f.bgap, 1.0); return; }
  }
}
// Board.chrome in the switch's gutter colour, at alpha ca. (The texture is the chrome drawn in
// white: its colour is where the gutter goes, its alpha the gutter and the hinge seam.)
void chrome(vec3 gap, float ca) {
  if (ca <= 0.0) return;
  vec4 m = texelFetch(uChrome, ivec2(int(X), int(Y)), 0);
  over(vec4(q(gap * m.r), m.a), ca);
}
// Board.tilePart for the one little flap this pixel is in.
void tilePart(Face f, int t, float ty, float py, float ph, float dy, float dh) {
  if (dh < 0.5 || ph <= 0.0) return;
  float c = cov(dy, dy + dh); if (c <= 0.0) return;
  fill(f.bg, c);
  if (f.uk == 2) srcImg(f.ul, float(f.up.x), float(f.up.y) + ty + py, ph, dy, dh);
  if (tileOn(f, t)) atlasImg(f.ml, f.mp + ivec2(0, int(ty)), py, ph, dy, dh);
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  X = floor(fc.x) - float(vC0.x); Y = floor(fc.y) - float(vC0.y);
  vec3 gap = rgb(vC0.z); int flags = vC0.w;
  bool anim = (flags & 1) != 0, tiled = (flags & 2) != 0;
  float t0 = vC1.x, dur = vC1.y, ca = vC1.z, shK = vC1.w;
  vec3 shade = rgb(vC2.x);
  boardGap = rgb(vC2.y);
  Face from = face(vF0, vF1), to = face(vT0, vT1); // (a still switch: 'to' is what it shows)
  dst = boardGap;
  float p = clamp((uNow - t0) / dur, 0.0, 1.0);
  float theta = PI * turn(p);
  float k = shK * 1.15;
  if (anim && tiled) {
    // Board.drawTiles: only the brushed pieces fall.
    under(to, false);
    int mnx = to.mos ? to.nx : from.nx, mny = to.mos ? to.ny : from.ny;
    if (X < uFw && Y < uFh) {
      int i = 0, j = 0; float tx, tw, ty, th;
      for (int n = 0; n < 8; n++) { if (n >= mnx) break; tileBox(mnx, n, uFw, tx, tw); if (X < tx + tw) { i = n; break; } }
      for (int n = 0; n < 8; n++) { if (n >= mny) break; tileBox(mny, n, uFh, ty, th); if (Y < ty + th) { j = n; break; } }
      int t = j * mnx + i;
      if (tileOn(from, t) || tileOn(to, t)) {
        if (p >= 1.0) tilePart(to, t, ty, 0.0, th, ty, th);
        else {
          float thy = jround(th / 2.0), tbh = th - thy;
          tilePart(to, t, ty, 0.0, thy, ty, thy);
          tilePart(from, t, ty, thy, tbh, ty + thy, tbh);
          if (theta < PI / 2.0) {
            float sc = cos(theta), h = thy * sc;
            tilePart(from, t, ty, 0.0, thy, ty + thy - h, h);
            fill(shade, k * 0.5 * (1.0 - sc) * cov(ty + thy - h, ty + thy));
            fill(shade, k * 0.3 * sc * cov(ty, ty + thy - h));
          } else {
            float sc = -cos(theta), h = tbh * sc;
            fill(shade, k * 0.28 * (1.0 - sc) * cov(ty + thy, ty + th));
            tilePart(to, t, ty, thy, tbh, ty + thy, h);
            fill(shade, k * 0.4 * (1.0 - sc) * cov(ty + thy, ty + thy + h));
          }
        }
      }
    }
    chrome(gap, ca);
    if (to.mos) brushGutters(to); else if (from.mos && p < 0.5) brushGutters(from);
  } else if (!anim && ca < 1.0) {
    // A bare flap: its face edge to edge, edges faded in by ca.
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
      float hy = uHy, bh = uFh - uHy;
      drawPart(to, 0.0, hy, 0.0, hy);
      drawPart(from, hy, bh, hy, bh);
      bool inx = X < uFw;
      if (theta < PI / 2.0) {
        float sc = cos(theta), h = hy * sc;
        drawPart(from, 0.0, hy, hy - h, h);
        if (inx) {
          fill(shade, k * 0.5 * (1.0 - sc) * cov(hy - h, hy));
          fill(shade, k * 0.3 * sc * cov(0.0, hy - h));
          if (!uFine) {
            fill(shade, k * 0.22 * (1.0 - sc) * cov(hy, uFh));
            fill(vec3(1.0), 0.09 * sin(2.0 * theta) * cov(hy - h, hy));
          }
          if (uLines) fill(vec3(1.0), 0.2 * (1.0 - sc) * cov(hy - h, hy - h + 1.0));
        }
      } else {
        float sc = -cos(theta), h = bh * sc;
        if (inx) fill(shade, k * 0.28 * (1.0 - sc) * cov(hy, uFh));
        drawPart(to, hy, bh, hy, h);
        if (inx) {
          fill(shade, k * 0.4 * (1.0 - sc) * cov(hy, hy + h));
          if (uLines) fill(vec3(1.0), 0.2 * (1.0 - sc) * cov(hy + h - 1.0, hy + h));
        }
      }
      if (uLines && inx) fill(shade, 0.28 * shK * cov(hy - 0.5, hy + 0.5));
    }
    chrome(gap, ca);
    if (!anim && to.mos && to.mbase) brushGutters(to);
  }
  oColor = vec4(dst, 1.0);
}`;

const colours = new Map();
let probe = null;
/** A CSS colour as 0xRRGGBB (-1 for none). */
function packColour(c) {
  if (c == null) return -1;
  let v = colours.get(c);
  if (v !== undefined) return v;
  if (/^#[0-9a-f]{6}$/i.test(c)) v = parseInt(c.slice(1), 16);
  else if (/^#[0-9a-f]{3}$/i.test(c)) v = parseInt(c[1] + c[1] + c[2] + c[2] + c[3] + c[3], 16);
  else {
    // (Anything else, as the canvas reads it.)
    probe ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    probe.fillStyle = '#000';
    probe.fillStyle = c;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    v = (d[0] << 16) | (d[1] << 8) | d[2];
  }
  if (colours.size > 4096) colours.clear(); // (paint colours are unbounded)
  colours.set(c, v);
  return v;
}

export class GLBoard extends Board {
  /** A board drawn with WebGL2 on `canvas`, or null where that can't be had (then `canvas` may
   *  be spent: it can't take a 2D context once it has tried a WebGL one). `force`: even on a
   *  slow (software) GPU. */
  static create(canvas, { force = false } = {}) {
    try {
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: !force });
      return gl && !gl.isContextLost() ? new GLBoard(canvas, gl) : null;
    } catch (err) {
      console.warn('GL board:', err);
      return null;
    }
  }

  constructor(canvas, gl) {
    super(canvas); // (its 2D context is null: this canvas is WebGL's)
    this.gl = gl;
    this.pending = new Set(); // switches to send to the GPU before the next frame
    this.all = true; // or all of them
    this.later = new Set(); // switches waiting for a picture (see glyph budget)
    this.srcs = new Map(); // picture (canvas) -> { slot, tex }
    this.captures = new Set(); // copies of the board, on the GPU only (see capture)
    this.onfail = null; // called if the GPU is lost for good: the 2D board takes over
    this.tints = true; // (characters are drawn white and take their colour here: see glyphKey)
    this.initGL();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // (so the browser may give it back)
      this.lost = true;
      // A board copy lived only on the GPU: its slices now show their own colour (see encodeFace).
      for (const c of this.captures) c.lost = true;
      this.captures.clear();
      // (Not given back in 3 s, it is taken as gone; a hidden tab may be given it back later.)
      const wait = () => (this.lostTimer = setTimeout(() => this.lost && (document.hidden ? wait() : this.giveUp()), 3000));
      clearTimeout(this.lostTimer);
      wait();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.failed) return;
      clearTimeout(this.lostTimer);
      try {
        this.initGL();
        // (The pictures were only on the GPU: they are drawn again as they are needed.)
        this.glyphCache.clear();
        this.atlases = [];
        this.atlas = null;
        if (this.cells.length) this.setup();
        this.lost = false;
      } catch (err) {
        console.warn('GL board:', err);
        this.giveUp();
      }
    });
  }

  /** The program, buffers and textures: anew after the context is lost and given back. */
  initGL() {
    const gl = this.gl;
    const shader = (type, text) => {
      const o = gl.createShader(type);
      gl.shaderSource(o, text);
      gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
      return o;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, FS));
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
    gl.uniform1i(this.u.uTurn, 2);
    for (let i = 0; i < SOURCES; i++) gl.uniform1i(this.u['uS' + i], 3 + i);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const B = STRIDE * 4;
    const ints = (loc, at) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribIPointer(loc, 4, gl.INT, B, at * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    ints(0, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, B, 16);
    gl.vertexAttribDivisor(1, 1);
    for (let loc = 2; loc <= 6; loc++) ints(loc, loc * 4);
    this.fbo = gl.createFramebuffer();
    this.frameTex = null;
    this.chromeTex = gl.createTexture();
    this.turnTex = gl.createTexture();
    this.turnSent = false;
    this.atlasTex = null;
    this.atlasCap = 0;
    this.atlasNew = [];
    // (Every sampler needs a texture, used or not.)
    this.emptyTex = this.texture(null, 1, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.emptyPages = gl.createTexture(); // (the atlas, until it has a page)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.emptyPages);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.srcs.clear();
    this.slots = new Array(SOURCES).fill(null);
    this.srcSize = new Float32Array(SOURCES * 2).fill(1);
  }

  /** A 2D texture of a canvas (or empty, w × h), premultiplied, smooth, clamped. */
  texture(canvas, w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (canvas) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.smooth(gl.TEXTURE_2D, gl.LINEAR);
    return tex;
  }
  smooth(target, filter) {
    const gl = this.gl;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  configure(m, fill) {
    super.configure(m, fill);
    this.setup();
  }

  /** What depends on the grid: the switches' data, the board's own copy of the frame, and the
   *  chrome. */
  setup() {
    const gl = this.gl;
    const n = this.cells.length;
    this.t0base = performance.now(); // (times are sent from here, so 32-bit floats keep them exact)
    const data = new ArrayBuffer(n * STRIDE * 4);
    this.I = new Int32Array(data);
    this.F = new Float32Array(data);
    this.frameNo = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    // The frame is kept off screen, as a 2D canvas keeps its pixels: each frame only the switches
    // that change or move are drawn into it, and it is copied to the screen.
    if (this.frameTex) gl.deleteTexture(this.frameTex);
    this.frameTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.W, this.H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.chromeTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.chrome('#fff'));
    this.smooth(gl.TEXTURE_2D, gl.NEAREST);
    this.atlasNew.length = 0;
    this.atlasClean = 0; // (pages whose GPU copy is whole but for atlasNew: a new grid starts new pages)
    this.all = true;
    this.fresh = true; // (the frame holds nothing yet: every switch is drawn into it)
  }

  // Board's drawing entry points only mark switches for the next render().
  draw(s) {
    this.pending.add(s);
  }
  redrawAll() {
    this.all = true;
  }
  touch(s) {
    this.pending.add(s);
  }
  /** A flap in motion needs no redraw (the GPU works out where it is): only changes are sent. */
  redraws(s, changed) {
    if (s.anim) this.moving = true;
    return changed;
  }
  setShade(shade, k) {
    super.setShade(shade, k);
    this.restyle = true;
  }

  /** Board.glyph: when the atlas starts afresh, every switch finds its pictures again. */
  glyph(f, gm) {
    const pages = this.atlases;
    const g = super.glyph(f, gm);
    if (this.atlases !== pages) {
      this.all = true;
      this.atlasNew.splice(0, this.atlasNew.length - 1); // (but the picture just placed, the new page's first)
      this.atlasClean = 0;
    }
    return g;
  }
  /** A new picture goes straight to the GPU's copy of its atlas page. (The page's canvas is left
   *  blank: drawing on it costs, and nothing here reads it.) */
  place(pic, g) {
    g.layer = this.atlases.length - 1;
    this.atlasNew.push([g.layer, g.x, g.y, pic]);
  }
  /** A face's picture, if it has been drawn or there is still time to draw it this frame (new
   *  pictures are drawn a few milliseconds' worth a frame, so a board of new ones doesn't stall). */
  picture(f) {
    const g = this.glyphCache.get(this.glyphKey(f));
    if (g || performance.now() > this.drawUntil) return g;
    return this.glyph(f, this.gm);
  }

  /** The texture unit (0…) holding a picture, -1 if it can't be had. */
  slot(canvas) {
    const e = this.srcs.get(canvas);
    if (e) return e.slot;
    if (canvas.lost) return -1;
    let slot = this.slots.indexOf(null);
    if (slot < 0 && !this.swept) {
      this.sweep();
      slot = this.slots.indexOf(null);
    }
    if (slot < 0) return -1;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3 + slot);
    const tex = canvas.tex || this.texture(canvas);
    this.srcs.set(canvas, { slot, tex });
    this.slots[slot] = canvas;
    this.srcSize[slot * 2] = canvas.width;
    this.srcSize[slot * 2 + 1] = canvas.height;
    return slot;
  }
  /** Free the pictures no switch shows or is going to (or only the board copies, which never come
   *  back, if not `pictures`). */
  sweep(pictures = true) {
    this.swept = true;
    const used = new Set();
    const see = (f) => {
      if (f && f.t === 'mosaic') f = f.base;
      if (f && f.t === 'slice') used.add(f.src.canvas);
    };
    for (const c of this.cells) {
      see(c.cur);
      if (c.anim) {
        see(c.anim.from);
        see(c.anim.to);
      }
      for (const n of c.q) see(n.f);
    }
    for (const [canvas, e] of this.srcs) {
      if (used.has(canvas) || (!pictures && !canvas.tex)) continue;
      this.gl.deleteTexture(e.tex);
      this.srcs.delete(canvas);
      this.slots[e.slot] = null;
    }
    // (A board copy whose slices went before a frame showed one never had a slot.)
    for (const c of this.captures) {
      if (used.has(c)) continue;
      if (!this.srcs.has(c)) this.gl.deleteTexture(c.tex);
      this.captures.delete(c);
      c.lost = true;
    }
  }

  /** A face as two ivec4s at `o` (see the shader's face()). False if a picture is missing. */
  encodeFace(f, o) {
    const I = this.I;
    const mos = f.t === 'mosaic';
    const u = mos ? f.base : f;
    let ok = true;
    let uk = 0;
    let ul = 0;
    let ux = 0;
    let uy = 0;
    if (u && u.t === 'glyph') {
      const g = this.picture(u);
      if (g) [uk, ul, ux, uy] = [1, g.layer, g.x, g.y];
      else ok = false;
    } else if (u && u.t === 'slice') {
      const slot = this.slot(u.src.canvas);
      if (slot >= 0) [uk, ul, ux, uy] = [2, slot, u.sx, u.sy];
      else ok = u.src.canvas.lost; // (a lost board copy: its colour for good; else try again)
    }
    let mosaic = false;
    let ml = 0;
    let mxy = 0;
    let mask = 0;
    if (mos) {
      const g = this.picture(f);
      if (g) {
        mosaic = true;
        ml = g.layer;
        mxy = g.x | (g.y << 16);
        for (let t = 0; t < f.tiles.length; t++) if (f.tiles[t]) mask |= 1 << t;
      } else ok = false;
    }
    I[o] = uk | (mosaic ? 4 : 0) | (mos ? (f.nx << 3) | (f.ny << 6) : 0) | (mask << 9) | (mos && f.base ? 1 << 25 : 0);
    I[o + 1] = packColour(f.bg);
    I[o + 2] = ul;
    I[o + 3] = ux;
    I[o + 4] = uy;
    I[o + 5] = ml;
    I[o + 6] = mxy;
    I[o + 7] = packColour(mos ? f.gap : u?.t === 'glyph' ? u.fg : null); // (a character's ink: see the shader's ink())
    return ok;
  }

  /** One switch as the shader reads it: where, its gutter and shading, its flip, its faces, and
   *  `stamp`, the frame it is drawn in (still switches are drawn only when they change; one still
   *  waiting for its picture keeps what it showed, as on a 2D canvas, unless the frame is new). */
  encode(s, stamp) {
    const o = s.i * STRIDE;
    const I = this.I;
    const F = this.F;
    const was = I[o + 10];
    const a = s.anim;
    const gap = s.gap || this.gapColor;
    const sh = this.shades.get(gap) || { shade: this.shade, k: this.shadeK };
    I[o] = s.x;
    I[o + 1] = s.y;
    I[o + 2] = packColour(gap);
    I[o + 3] = (a ? 1 : 0) | (a && this.tiled(a) ? 2 : 0);
    F[o + 4] = a ? a.t0 - this.t0base : 0;
    F[o + 5] = a ? a.dur : 1;
    F[o + 6] = s.ca ?? 1;
    F[o + 7] = sh.k;
    I[o + 8] = packColour(sh.shade);
    I[o + 9] = packColour(this.gapColor);
    let ok = this.encodeFace(a ? a.to : s.cur, o + 20);
    if (a) ok = this.encodeFace(a.from, o + 12) && ok;
    else I.copyWithin(o + 12, o + 20, o + 28);
    if (!ok) this.later.add(s);
    I[o + 10] = ok || a || this.fresh ? stamp : was;
  }

  /** Bring the GPU's copy up to date and draw the board as it is at `now` (if anything changed
   *  or moves: a still board costs nothing). */
  render(now) {
    if (this.lost || !this.cells.length) return void (this.moving = false);
    if (now - (this.sweptAt || 0) > 4000) {
      // (Now and then, let go of pictures no longer shown.)
      this.sweptAt = now;
      if (this.srcs.size > 2 || this.captures.size) this.sweep(this.srcs.size > 2);
    }
    if (this.gapColor !== this.gapWas || this.restyle) {
      // A new gutter colour or shading: switches in motion take it at once, as on the 2D board
      // (the rest when they are next drawn).
      this.gapWas = this.gapColor;
      this.restyle = false;
      for (const s of this.active) if (s.anim) this.pending.add(s);
    }
    if (!this.all && !this.pending.size && !this.later.size && !this.moving) return;
    try {
      this.frame(now);
      this.fails = 0;
    } catch (err) {
      this.fail(err);
    }
    this.moving = false;
  }

  frame(now) {
    const gl = this.gl;
    this.swept = false;
    this.drawUntil = performance.now() + 4;
    if (now - this.t0base > 6e5) {
      // (Every ten minutes, times start again from now: a 32-bit float keeps them exact.)
      this.t0base = now;
      this.all = true;
    }
    for (const s of this.later) this.pending.add(s);
    this.later.clear();
    const stamp = ++this.frameNo;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (this.all) {
      // (An atlas started afresh while encoding sets `all` again: then once more, on the new pages.)
      for (let pass = 0; pass < 2 && this.all; pass++) {
        this.all = false;
        for (const s of this.cells) this.encode(s, stamp);
      }
      this.all = false;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.I);
    } else if (this.pending.size) {
      const idx = [];
      for (const s of this.pending) if (this.cells[s.i] === s) (this.encode(s, stamp), idx.push(s.i)); // (not one from before a new grid)
      if (this.all) return this.frame(now);
      // Only what changed goes to the GPU, in runs of nearby switches (a few unchanged ones
      // between cost less than another upload).
      idx.sort((x, y) => x - y);
      for (let k = 0; k < idx.length; ) {
        let j = k;
        while (j + 1 < idx.length && idx[j + 1] - idx[j] <= 64) j++;
        gl.bufferSubData(gl.ARRAY_BUFFER, idx[k] * STRIDE * 4, this.I, idx[k] * STRIDE, (idx[j] - idx[k] + 1) * STRIDE);
        k = j + 1;
      }
    }
    this.fresh = false;
    this.pending.clear();
    this.sendPictures();
    if (!this.turnSent) this.sendTurn();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.useProgram(this.prog);
    gl.viewport(0, 0, this.W, this.H);
    const u = this.u;
    gl.uniform2f(u.uSize, this.W, this.H);
    gl.uniform2f(u.uCell, this.cw, this.ch);
    gl.uniform1f(u.uNow, now - this.t0base);
    gl.uniform1i(u.uFrame, stamp);
    gl.uniform1i(u.uFine, this.fine ? 1 : 0);
    gl.uniform1i(u.uLines, this.lines ? 1 : 0);
    gl.uniform1f(u.uCw, this.cw);
    gl.uniform1f(u.uCh, this.ch);
    gl.uniform1f(u.uFw, this.gm.fw);
    gl.uniform1f(u.uFh, this.gm.fh);
    gl.uniform1f(u.uHy, this.gm.hy);
    gl.uniform2fv(u.uSrcSize, this.srcSize);
    for (let i = 0; i < SOURCES; i++) {
      gl.activeTexture(gl.TEXTURE3 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.slots[i] ? this.srcs.get(this.slots[i]).tex : this.emptyTex);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.chromeTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex || this.emptyPages);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.turnTex);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.cells.length);
    // To the screen.
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** New atlas pictures to the GPU. Its pages are allocated as the first is needed, then two,
   *  then all six (copied over on the GPU); a page starting out is cleared there, not sent. */
  sendPictures() {
    const gl = this.gl;
    const need = this.atlases.length;
    gl.activeTexture(gl.TEXTURE1);
    if (need > this.atlasCap || this.atlasClean < this.atlases.length) {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      const clear = (l) => {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.atlasTex, 0, l);
        gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      };
      if (need > this.atlasCap) {
        const old = this.atlasTex;
        const keep = old ? Math.min(this.atlasClean, this.atlasCap) : 0;
        this.atlasCap = need <= 2 ? need : PAGES;
        this.atlasTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, A, A, this.atlasCap);
        this.smooth(gl.TEXTURE_2D_ARRAY, gl.LINEAR);
        for (let l = keep; l < this.atlasCap; l++) clear(l);
        for (let l = 0; l < keep; l++) {
          gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, old, 0, l);
          gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, l, 0, 0, A, A);
        }
        if (old) gl.deleteTexture(old);
        this.atlasClean = keep;
      }
      for (let l = this.atlasClean; l < this.atlases.length; l++) clear(l);
      this.atlasClean = this.atlases.length;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
    }
    if (!this.atlasNew.length) return;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (const [l, x, y, c] of this.atlasNew) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, l, c.width, c.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, c);
    this.atlasNew.length = 0;
  }

  /** Board.turn sampled for the shader (the model's own curve: never a copy of it). */
  sendTurn() {
    const gl = this.gl;
    const v = new Float32Array(TURN);
    for (let i = 0; i < TURN; i++) v[i] = this.turn(i / (TURN - 1));
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.turnTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, TURN, 1, 0, gl.RED, gl.FLOAT, v);
    this.smooth(gl.TEXTURE_2D, gl.NEAREST);
    this.turnSent = true;
  }

  /** A copy of the board as it is on screen, kept on the GPU: a picture to cut slices from (it
   *  has the size of a canvas, and stands in for one). Null if it can't be had. */
  capture() {
    if (this.lost || this.gl.isContextLost() || !this.cells.length) return null; // (lost, if not yet told)
    try {
      const gl = this.gl;
      const { W, H } = this;
      this.frame(performance.now()); // (anything changed since the last frame, drawn)
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      this.smooth(gl.TEXTURE_2D, gl.LINEAR);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
      // (Upside down: the frame's rows count up, a picture's down.)
      gl.blitFramebuffer(0, 0, W, H, 0, H, W, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      const shot = { width: W, height: H, tex };
      this.captures.add(shot);
      return shot;
    } catch (err) {
      console.warn('GL board:', err);
      return null;
    }
  }

  /** Something failed: draw nothing new this frame (and everything afresh next time). Failing
   *  frame after frame, it gives up. */
  fail(err) {
    if (!this.fails) console.warn('GL board:', err);
    this.fails = (this.fails || 0) + 1;
    this.pending.clear();
    this.all = true;
    if (this.fails >= 3) this.giveUp();
  }
  /** For good (the GPU lost and not given back, or failing): the 2D board takes over. */
  giveUp() {
    if (this.failed) return;
    this.failed = this.lost = true;
    clearTimeout(this.lostTimer);
    this.onfail?.();
  }
}
