// The board's sound: each flap that lands ticks, synthesised (no recordings). A few dozen
// varied ticks are rendered once, when sound is first switched on, and replayed with small
// changes of pitch and level. A busy board is not more ticks played louder: it is a wash of
// tiny quiet grains (the same ticks, mixed once into two loops, one sparse and one dense,
// crossfaded as the landings thicken), so a page turning over sounds like rain mixed with falling sand.
// Off by default; a browser won't start audio until someone has pressed something, so a
// remembered "on" waits for the first press or key (the page passes it on via gesture()).

const db = (x) => Math.pow(10, x / 20);
const rand = (a, b) => a + Math.random() * (b - a);
const jit = (x, f) => x * (1 + (Math.random() * 2 - 1) * f);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp01 = (x, a, b) => clamp(Math.log2(x / a) / Math.log2(b / a), 0, 1); // (on a log scale)

/**
 * The sounds: one tick (an aluminium leaf striking its stop, on a plastic frame) and a texture
 * for a busy board made of the same ticks. Tuned against the measured spectrum and decay of a
 * real board: a warm body around 400-500 Hz, a fairly flat, noisy top, and a short metallic
 * ring (here a touch more ring, a quicker end and a few dB less treble than the real thing,
 * for comfort). Nothing below ~200 Hz. Times in ms, levels in dB.
 *   tick     contact: white noise highpassed at `hp`, decaying with `tauC`, and a small
 *            second hit `rattleMs` later at `rattleDb` (the leaf bouncing once on its stop).
 *            body: noise banded at `bodyF` (Q `bodyQ`) at `bodyDb`, decaying with `tauB`, and
 *            modes `knockF0` at `knockDb`, decaying with `tauK`. ring: the leaf's inharmonic
 *            modes, `f1` times `ratios` (each tick a little different: `f1Jit`), at `modeDb`,
 *            decaying with `tauM`. Then a treble shelf (`hfDb` above `hfF`) and a lowpass `lp`.
 *            land: the last flap of a turn, `landDb` louder with a small bounce.
 *   grains   the texture: ticks from the pool laid down at random (`gDense` a second in the
 *            dense loop, `gSparse` in the sparse one), each played at a rate between `gRate`
 *            (lower: a larger drop), cut short with an extra decay `gTau` ms (0: none),
 *            lowpassed at between `gLp` Hz, at a level spread over `gSpread` dB (`gSkew` > 1:
 *            most grains quiet, a few near), panned across `gWidth`.
 *   busy     ticks are played up to `maxPerFrame` a frame, ducked by `tickDuck` dB once the
 *            texture is in. The texture comes in from `texStart` landings/s, at `texDb` by
 *            `texFull`, then grows `texGrow` dB per doubling (at most `texMax` dB more).
 */
const TICK = {
  len: 34, atk: 0.25, hp: 1300, dipF: 2600, dipQ: 0.6, dipDb: -8, tauC: 3, rattleMs: 5.5, rattleDb: -6,
  bodyF: 440, bodyQ: 2.4, bodyDb: -11, tauB: 3.2, knockF0: [400, 495], knockDb: [-23, -26], tauK: [4.5, 3.5],
  f1: 2700, f1Jit: 0.2, ratios: [1, 1.47, 1.89, 2.37, 2.93, 3.61],
  modeDb: [-20, -22, -25, -28, -31, -34], tauM: [7, 6, 5, 4.2, 3.6, 3],
  hfF: 6500, hfDb: -5, lp: 16000,
  landDb: 2, bounceMs: 13, bounceDb: -20,
  rateJit: 0.035, maxVoices: 48, maxPerFrame: 4,
};
const CHAIN = { pan: 0.35, hpF: 190, masterLp: 15000, shelfF: 6000, shelfDb: 0, glueThr: -24, glueRatio: 3, level: -2.5 };
const BUSY = { tickDuck: -7, texStart: 160, texFull: 1600, texDb: -20.5, texGrow: 1, texMax: 2.5 };

export const VARIANTS = {
  // The tick with its ring; the wash an even mix of rain and sand.
  metal: {
    ...TICK, ...CHAIN, ...BUSY,
    gRate: [0.9, 1.15], gTau: 0, gLp: [6000, 13000], gSpread: 10, gSkew: 1.3, gSparse: 300, gDense: 2400, gWidth: 0.7,
    shelfDb: -2,
  },
  // A touch more ring; the wash in larger, lower drops, a few of them nearer, like rain on a roof.
  rain: {
    ...TICK, ...CHAIN, ...BUSY,
    f1: 2450, modeDb: [-22, -22, -25, -28, -31, -34], tauM: [8, 7, 5.5, 4.5, 3.8, 3.2],
    gRate: [0.78, 1], gTau: 0, gLp: [5000, 11000], gSpread: 14, gSkew: 1.4, gSparse: 220, gDense: 2000, gWidth: 0.8,
  },
  // Less ring; the wash finer, smaller, shorter and denser, like sand poured onto a tray.
  sand: {
    ...TICK, ...CHAIN, ...BUSY,
    modeDb: [-24, -26, -29, -32, -35, -38], tauM: [6, 4.5, 3.5, 3, 2.5, 2],
    gRate: [1.05, 1.35], gTau: 3, gLp: [4500, 9000], gSpread: 9, gSkew: 1, gSparse: 600, gDense: 4000, gWidth: 0.65, shelfDb: -3,
  },
};
export const DEFAULT = 'metal';

const POOL = 24; // ordinary ticks per sound (plus LANDS accents)
const LANDS = 6;
const PANS = 5; // stereo positions (a panner per tick costs more than it adds)
const HEAD = db(-20); // each tick into the chain (headroom: the glue compressor should only touch waves)
const MASTER = 4; // the master gain at full volume (a single flap then peaks near -15 dBFS at volume 0.6)
const SMOOTH = 0.08; // s, how quickly the sense of "how busy" follows the landings
const LOOPS = [2.71, 3.13]; // s, the sparse and dense texture loops (unequal: they never line up)
const RATE_LO = 300, RATE_HI = 3000; // landings/s at which the texture is all sparse / all dense
const KEY = 'sound';

const AC = typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;
const OAC = typeof window === 'undefined' ? null : window.OfflineAudioContext || window.webkitOfflineAudioContext;

/** Render one tick (mono, `p.len` ms) offline. `land`: the last flap of a turn. */
export async function renderTick(sr, p, land = false) {
  const len = Math.ceil((sr * p.len) / 1000);
  const oc = new OAC(1, len, sr);
  const t0 = 0.001;
  const noise = (s) => {
    const b = oc.createBuffer(1, Math.ceil(sr * s), sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  };
  const filter = (type, f, q, gain = 0) => {
    const b = oc.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.gain.value = gain;
    return b;
  };
  // Out through a highpass (nothing below ~200 Hz), the treble shelf and a lowpass.
  const out = filter('highpass', 180, 0.7);
  out.connect(filter('highshelf', p.hfF, 0, p.hfDb)).connect(filter('lowpass', jit(p.lp, 0.08), 0.707)).connect(oc.destination);
  const atk = jit(p.atk, 0.15) / 1000;
  // A decaying envelope from `t` (peak `g`, time constant `tau` ms) on a new gain into `to`.
  const env = (t, g, tau, rise = atk) => {
    const e = oc.createGain();
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g, t + rise);
    e.gain.setTargetAtTime(0, t + rise, jit(tau, 0.15) / 1000);
    e.connect(out);
    return e;
  };
  const hit = (t, g) => {
    // The contact: broadband noise.
    const s = oc.createBufferSource();
    s.buffer = noise(0.012);
    s.connect(filter('highpass', jit(p.hp, 0.1), 0.7)).connect(filter('peaking', p.dipF, p.dipQ, p.dipDb)).connect(env(t, g, p.tauC));
    s.start(t);
    // The body: noise banded round `bodyF` (made up for the band's share of the power).
    const b = oc.createBufferSource();
    b.buffer = noise(0.03);
    const f = jit(p.bodyF, 0.08);
    b.connect(filter('bandpass', f, p.bodyQ)).connect(env(t, g * db(p.bodyDb) * Math.sqrt(sr / 2 / (f / p.bodyQ)), p.tauB, 0.0008));
    b.start(t);
  };
  const L = land ? db(p.landDb) : 1;
  hit(t0, L);
  if (p.rattleDb > -60) hit(t0 + jit(p.rattleMs, 0.4) / 1000, L * db(p.rattleDb + rand(-3, 3)));
  if (land && p.bounceDb > -60) hit(t0 + jit(p.bounceMs, 0.15) / 1000, L * db(p.bounceDb));
  // Sines from phase 0 over 0.2 ms or more (no click): the ring, a few inharmonic modes of a
  // thin leaf, and the body's modes.
  const mode = (f, g, tau, rise) => {
    const o = oc.createOscillator();
    o.frequency.value = f;
    o.connect(env(t0, g, tau, rise));
    o.start(t0);
  };
  const f1 = jit(p.f1, p.f1Jit);
  p.ratios.forEach((r, i) => mode(jit(f1 * r, 0.03), L * db(p.modeDb[i] + rand(-2, 2)), p.tauM[i], 0.0002));
  p.knockF0.forEach((f, i) => mode(jit(f, 0.06), L * db(p.knockDb[i] + rand(-2, 2)), p.tauK[i], 0.0008));
  const buf = await oc.startRendering();
  const d = buf.getChannelData(0);
  let pk = 0;
  for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  // To -2.5 dBFS for a landing, `landDb` less for a tick, give or take 1.5 dB; the last 6 ms
  // faded so nothing is cut off sharply.
  const s = (db(-2.5 - (land ? 0 : p.landDb)) * db(rand(-1.5, 1.5))) / (pk || 1);
  const fade = Math.ceil(sr * 0.006);
  for (let i = 0; i < d.length; i++) d[i] *= s * Math.min(1, (d.length - 1 - i) / fade);
  return buf;
}

/**
 * One texture loop (stereo, `seconds` long, `rate` grains a second), mixed straight into the
 * buffer from the sound's own `ticks`: each grain one of them at its own rate, length,
 * brightness, level and place, as a busy board is many flaps at once. Grains near the end
 * wrap round to the start, so the loop has no seam. Normalised to an RMS of 1 (so the denser
 * the loop, the quieter each grain). Yields now and then, so a slow device doesn't stall a
 * frame for long.
 */
export async function renderTexture(ctx, p, rate, seconds, ticks) {
  const sr = ctx.sampleRate;
  const n = Math.ceil(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const src = ticks.map((b) => b.getChannelData(0));
  const count = Math.round(rate * seconds);
  const lnR = [Math.log(p.gRate[0]), Math.log(p.gRate[1])];
  for (let g = 0; g < count; g++) {
    if (g && g % 400 === 0) await new Promise((r) => setTimeout(r, 0));
    const d = src[(Math.random() * src.length) | 0];
    const r = Math.exp(rand(lnR[0], lnR[1]));
    // (Either polarity, for variety: the ticks are already free of any offset.)
    const a = db(-p.gSpread * Math.pow(Math.random(), 1 / p.gSkew)) * (Math.random() < 0.5 ? -1 : 1);
    const pan = rand(-p.gWidth, p.gWidth);
    const gl = a * Math.cos(((pan + 1) * Math.PI) / 4), gr = a * Math.sin(((pan + 1) * Math.PI) / 4);
    const tau = p.gTau ? (jit(p.gTau, 0.3) * sr) / 1000 : 0; // samples
    const cut = tau ? Math.exp(-1 / tau) : 1;
    const k = 1 - Math.exp((-2 * Math.PI * rand(p.gLp[0], p.gLp[1])) / sr);
    let len = Math.min(n, Math.floor((d.length - 2) / r));
    if (tau) len = Math.min(len, Math.ceil(tau * 7)); // (-60 dB)
    let j = (Math.random() * n) | 0, y = 0, e = 1, x = 0;
    for (let i = 0; i < len; i++, x += r) {
      const m = x | 0;
      y += k * (d[m] + (d[m + 1] - d[m]) * (x - m) - y);
      const v = y * e;
      e *= cut;
      L[j] += v * gl;
      R[j] += v * gr;
      if (++j === n) j = 0;
    }
  }
  // A highpass at 200 Hz for anything low the overlaps leave (one pole, run once round the
  // loop first so it starts where it ends).
  const kh = 1 - Math.exp((-2 * Math.PI * 200) / sr);
  let ss = 0;
  for (const d of [L, R]) {
    let lo = 0;
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
      lo += kh * (d[i] - lo);
      if (pass) d[i] -= lo;
    }
    for (let i = 0; i < n; i++) ss += d[i] * d[i];
  }
  const s = 1 / (Math.sqrt(ss / (2 * n)) || 1);
  for (const d of [L, R]) for (let i = 0; i < n; i++) d[i] *= s;
  return buf;
}

/** Everything one sound needs: { ticks, lands, tex: [sparse, dense] }. `ctx` makes the loops. */
export async function renderPool(ctx, p) {
  const sr = ctx.sampleRate;
  const all = await Promise.all(Array.from({ length: POOL + LANDS }, (_, i) => renderTick(sr, p, i >= POOL)));
  const ticks = all.slice(0, POOL);
  const tex = [await renderTexture(ctx, p, p.gSparse, LOOPS[0], ticks), await renderTexture(ctx, p, p.gDense, LOOPS[1], ticks)];
  return { ticks, lands: all.slice(POOL), tex };
}

export class FlapSound {
  /** `context`: an AudioContext to use instead of making one (an OfflineAudioContext, for tests). */
  constructor({ variant = DEFAULT, volume = 0.6, context = null } = {}) {
    this.variant = VARIANTS[variant] ? variant : DEFAULT;
    this.volume = volume;
    this.ctx = context;
    this.own = !context; // (only a context of our own is suspended when idle)
    this.pools = new Map(); // variant -> { ticks, lands, tex } (or a promise of them)
    this.pool = null; // the ready sounds for the current variant; land() is ignored until then
    this.want = false;
    try { this.want = localStorage.getItem(KEY) === 'on'; } catch {}
    this.ends = []; // when each tick still playing ends (the voice cap)
    this.busy = 0; // landings in the last ~80 ms (decaying)
    this.played = 0; // of those, the ones actually played
    this.last = -1; // the last buffer played (not repeated straight away)
    this.lastAt = 0; // when land() was last called (s, the context's clock)
    this.nextT = 0; // where the last frame's ticks ended
    this.prevMs = 0;
    this.idle = 0;
    this.texOn = false; // whether the texture was last set to be heard
    this.loops = null; // the texture sources playing, and whose they are
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.level());
    }
  }

  /** Whether sound is on (as chosen; it may still be waiting for a first press). */
  get on() {
    return this.want;
  }

  /** Switch sound on. Call from a press or key, or it waits for one (see gesture()). */
  enable() {
    this.want = true;
    this.save();
    this.start();
  }

  disable() {
    this.want = false;
    this.save();
    this.level();
  }

  /** Returns whether sound is now on. */
  toggle() {
    this.want ? this.disable() : this.enable();
    return this.want;
  }

  /** Pass on every pointerdown and keydown: starts sound remembered as on, and wakes a
   *  context the browser suspended. (Cheap when there is nothing to do.) */
  gesture() {
    if (!this.want) return;
    if (!this.ctx || this.ctx.state !== 'running') this.start();
  }

  setVariant(name) {
    if (!VARIANTS[name] || name === this.variant) return;
    this.variant = name;
    this.pool = null;
    if (this.ctx) this.prepare();
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    this.level();
  }

  save() {
    try { localStorage.setItem(KEY, this.want ? 'on' : 'off'); } catch {}
  }

  start() {
    try {
      if (!this.ctx) {
        if (!AC || !OAC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
      } else if (!this.out) this.build();
      if (this.ctx.state !== 'running' && this.ctx.resume) this.ctx.resume().catch(() => {});
      this.prepare();
      this.level();
      if (this.own && !this.idle) this.idle = setInterval(() => this.sleep(), 1000);
    } catch {
      // (no audio here: stay quiet)
    }
  }

  /** The chain: pan buses for the ticks and a panner for the texture, a steep highpass (no
   *  rumble or hum), a lowpass and treble shelf for comfort, a compressor to glue a wave
   *  together, the volume, and a limiter last so that no wave at any volume clips. */
  build() {
    const c = this.ctx;
    this.mix = c.createGain();
    this.hp = [c.createBiquadFilter(), c.createBiquadFilter()];
    for (const h of this.hp) {
      h.type = 'highpass';
      h.Q.value = 0.707;
    }
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.707;
    this.shelf = c.createBiquadFilter();
    this.shelf.type = 'highshelf';
    this.glue = c.createDynamicsCompressor();
    this.glue.knee.value = 12;
    this.glue.attack.value = 0.003;
    this.glue.release.value = 0.15;
    this.limit = c.createDynamicsCompressor();
    this.limit.threshold.value = -6;
    this.limit.knee.value = 0;
    this.limit.ratio.value = 20;
    this.limit.attack.value = 0.001;
    this.limit.release.value = 0.06;
    this.out = c.createGain();
    this.out.gain.value = 0;
    // (Always stereo: a filter whose channel count changes as ticks come and go can glitch.)
    for (const x of [this.mix, ...this.hp, this.lp, this.shelf]) {
      x.channelCount = 2;
      x.channelCountMode = 'explicit';
    }
    this.mix.connect(this.hp[0]).connect(this.hp[1]).connect(this.lp).connect(this.shelf).connect(this.glue).connect(this.out).connect(this.limit).connect(c.destination);
    this.buses = Array.from({ length: PANS }, () => {
      const b = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
      b.connect(this.mix);
      return b;
    });
    // The texture: two looping sources (sparse, dense) into their own gains, then a panner.
    this.texPan = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    this.texPan.connect(this.mix);
    this.texG = [c.createGain(), c.createGain()];
    for (const g of this.texG) {
      g.gain.value = 0;
      g.connect(this.texPan);
    }
    this.tune();
  }

  /** Set the chain for the current sound. */
  tune() {
    const p = VARIANTS[this.variant], t = this.ctx.currentTime;
    for (const h of this.hp) h.frequency.value = p.hpF;
    this.lp.frequency.setTargetAtTime(p.masterLp, t, 0.05);
    this.shelf.frequency.value = p.shelfF;
    this.shelf.gain.setTargetAtTime(p.shelfDb, t, 0.05);
    this.glue.threshold.value = p.glueThr;
    this.glue.ratio.value = p.glueRatio;
    this.buses.forEach((b, i) => b.pan && (b.pan.value = p.pan * ((i / (PANS - 1)) * 2 - 1)));
    const pool = this.pools.get(this.variant);
    if (pool && !(pool instanceof Promise)) this.texture(pool);
  }

  /** Start the current sound's texture loops (fading out any other's first). */
  texture(pool) {
    if (this.loops && this.loops.pool === pool) return;
    const c = this.ctx, t = c.currentTime;
    if (this.loops) {
      for (const g of this.texG) g.gain.cancelScheduledValues(t), g.gain.setTargetAtTime(0, t, 0.02);
      for (const s of this.loops.srcs) try { s.stop(t + 0.15); } catch {}
    }
    const srcs = pool.tex.map((b, i) => {
      const s = c.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.connect(this.texG[i]);
      s.start(t + (this.loops ? 0.15 : 0), Math.random() * b.duration);
      return s;
    });
    this.loops = { pool, srcs };
  }

  /** Render the current sound if it isn't yet (about 0.2 s in short chunks, once per sound). */
  prepare() {
    if (!this.ctx) return null;
    const name = this.variant;
    let got = this.pools.get(name);
    if (!got) {
      got = renderPool(this.ctx, VARIANTS[name]).then((pool) => {
        this.pools.set(name, pool);
        if (this.variant === name) {
          this.pool = pool;
          if (this.out) this.tune();
        }
        return pool;
      }, () => null);
      this.pools.set(name, got);
    }
    if (!(got instanceof Promise)) this.pool = got;
    if (this.out) this.tune();
    return got;
  }

  /** Fade the master to where it should be: on, at the chosen volume, and the tab visible. */
  level() {
    if (!this.out) return;
    const hidden = typeof document !== 'undefined' && document.hidden && this.own;
    const g = this.want && !hidden ? MASTER * Math.pow(this.volume, 1.5) : 0;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(g, t, 0.027); // (≈ 80 ms to settle)
    if (g && this.ctx.state === 'suspended' && this.own) this.ctx.resume().catch(() => {});
  }

  /** Suspend our context when nothing has landed for 10 s (or sound is off, or hidden). */
  sleep() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const quiet = performance.now() - this.prevMs > 10000;
    if (quiet || !this.want || document.hidden) c.suspend().catch(() => {});
  }

  /**
   * `n` flaps landed this frame (0 … thousands), around stereo position `pan` (-1 left … 1
   * right: their mean x across the board). `final`: how many of them ended their turn (a
   * heavier landing); left out, one tick in six is a heavier one. Plays at most a handful of
   * ticks, spread over the next frame, and lets the texture carry the rest.
   */
  land(n = 1, pan = 0, final) {
    if (!this.pool || !this.want || (this.own && document.hidden)) return;
    const c = this.ctx;
    const ms = performance.now();
    const dt = this.prevMs ? clamp((ms - this.prevMs) / 1000, 1 / 240, 1 / 20) : 1 / 60;
    this.prevMs = ms;
    if (this.own && c.state !== 'running') {
      c.resume().catch(() => {}); // (asleep: back in a moment, without this frame)
      return;
    }
    this.landAt(n, pan, final, c.currentTime, dt);
  }

  /** land() at a given time on the context's clock (`dt`: the frame's length, in s). */
  landAt(n, pan, final, now, dt) {
    const p = VARIANTS[this.variant];
    const pool = this.pool;
    const decay = Math.exp(-Math.max(0, now - this.lastAt) / SMOOTH);
    this.lastAt = now;
    this.busy = this.busy * decay + n;
    this.played *= decay;
    const rate = this.busy / SMOOTH; // landings per second, roughly
    // The texture: in as the landings thicken (sparse grains, then dense), a little louder
    // still past `texFull`, and out again (by itself) soon after they stop.
    const inT = lerp01(rate, p.texStart, p.texFull);
    if (inT > 0 || this.texOn) {
      this.texOn = inT > 0;
      const grow = rate > p.texFull ? Math.min(p.texMax, p.texGrow * Math.log2(rate / p.texFull)) : 0;
      const T = HEAD * db(p.texDb + grow) * inT * inT;
      const x = (lerp01(rate, RATE_LO, RATE_HI) * Math.PI) / 2;
      [Math.cos(x), Math.sin(x)].forEach((m, i) => {
        const g = this.texG[i].gain;
        g.cancelScheduledValues(now);
        g.setTargetAtTime(T * m, now, 0.04);
        g.setTargetAtTime(0, now + 0.12, 0.1);
      });
      if (this.texPan.pan) this.texPan.pan.setTargetAtTime(clamp(pan, -1, 1) * p.pan * 0.6, now, 0.1);
    }
    if (n <= 0) return;
    const ends = this.ends;
    for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= now) ends[i] = ends[ends.length - 1], ends.pop();
    // No more a frame than the voices can keep up (filling them all at once, then waiting for
    // them all to end, pulses at the length of a tick).
    const steady = Math.max(1, Math.round((p.maxVoices * dt * 1000) / p.len));
    const count = Math.min(n, p.maxPerFrame, steady, p.maxVoices - ends.length);
    if (count <= 0) return;
    this.played += count;
    // Ticks played close together share one tick's loudness (each down as 1/√ of how many in
    // 50 ms), and step back further as the texture comes in.
    const g = (HEAD * db(p.level + p.tickDuck * inT)) / Math.sqrt(Math.max(1, this.played * 0.625));
    let lands = final === undefined ? -1 : Math.min(count, Math.round((final / n) * count + Math.random() - 0.5));
    // Spread over the frame (ticks all on the frame's edge buzz at 60 Hz), following on from
    // the last frame's unless the clock has got ahead of us.
    let t = this.nextT;
    if (t < now + 0.01 || t > now + 0.08) t = now + 0.02;
    this.nextT = t + dt;
    const spread = n > 1 ? 0.5 : 0;
    for (let i = 0; i < count; i++) {
      const heavy = lands < 0 ? Math.random() < 1 / 6 : i < lands;
      const set = heavy ? pool.lands : pool.ticks;
      let k = (Math.random() * set.length) | 0;
      if (set[k] === this.last) k = (k + 1) % set.length;
      const s = this.ctx.createBufferSource();
      s.buffer = this.last = set[k];
      const r = (s.playbackRate.value = 1 + (Math.random() * 2 - 1) * p.rateJit);
      const gn = this.ctx.createGain();
      gn.gain.value = g * db(rand(-1.5, 1.5));
      const at = clamp(pan + (Math.random() * 2 - 1) * spread, -1, 1);
      s.connect(gn).connect(this.buses[Math.round(((at + 1) / 2) * (PANS - 1))]);
      const when = t + ((i + Math.random()) / count) * dt;
      ends.push(when + s.buffer.duration / r);
      s.onended = () => gn.disconnect();
      s.start(when);
    }
  }
}
