// The board's sound: each flap that lands ticks. Three sounds: 'pragotron', ticks cut from a
// recording of a real Pragotron board (one small file, fetched only once sound is switched
// on); 'snap', a synthesised tick through the same few fixed resonances as the recording; and
// 'metal', the earlier synthesised tick with its ring, kept to compare.
// A busy board is never a wash of noise: it is many separate clicks with quiet between them.
// The landings a frame are turned into a click rate that grows more and more slowly and is
// capped (a page turning over is a busy rattle you can still hear click by click), each click
// a little quieter as the rate rises, spread over the frame with jitter and sometimes in
// small clusters (modules stepping nearly together).
// Off by default; a browser won't start audio until someone has pressed something, so a
// remembered "on" waits for the first press or key (the page passes it on via gesture()).

export const CREDIT = 'Split-flap sound: "pragotron_split-flap-display.wav" by matucha (freesound.org/s/174056), CC BY-NC 4.0, edited.';

const db = (x) => Math.pow(10, x / 20);
const rand = (a, b) => a + Math.random() * (b - a);
const jit = (x, f) => x * (1 + (Math.random() * 2 - 1) * f);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * The recorded ticks: one mono MP3 (48 kHz), `count` ticks, the first starting `lead` s in
 * and each `slot` s after the last, `len` s long, with its click `pre` s after its start.
 * Cut from Freesound #174056 (see CREDIT): both microphones time-aligned and summed for each
 * tick, a gentle 180 Hz highpass (12 dB/octave; the chain's own, at 200 Hz for this sound,
 * takes off the rest of a low thump the contact microphone picked up), each tick trimmed to its click and natural
 * decay (up to the next tick in the recording, at most 140 ms, faded out over its last 45%),
 * levelled to the same loudness. Each tick's start
 * is found again in the decoded audio (decoders differ in how much silence they add).
 */
const SPRITE = { file: '../assets/sound/pragotron-ticks.mp3', count: 20, lead: 0.1, slot: 0.16, len: 0.14, pre: 0.0015 };

/**
 * How a busy board sounds (shared by all three). Every flap that lands clicks, as it lands
 * (`knee` is past any real rate, so clicks follow landings one for one). Past `perFrame` in
 * one frame (over 1,400 a second: more than the ear can tell apart) the clicks played stand
 * in for the rest, a little louder; `maxVoices` caps how many sound at once. Each click is (clicks/s ÷ `ref`)^-`fall`
 * as loud (once past `ref`), so a busy board is a fuller sound rather than a much louder one.
 * (`cluster`: echoes of a click, for modules stepping together; off, so every click is a
 * flap.) Each click is down by `spread`·u^`skew` dB (u uniform: most near full level,
 * some further off, as modules nearer and further), made up for on average by `makeup` dB.
 * `rateJit`: playback rate ± (so repeats differ).
 */
const DENSITY = {
  knee: 1e9, exp: 0.45, cmax: 70, ref: 10, fall: 0.35, cluster: 0, clusterMs: [2, 7], clusterDb: [-8, -3],
  spread: 14, skew: 1.3, makeup: 4, rateJit: 0.035, maxVoices: 160, perFrame: 16, landDb: 2,
};
// `length`: every tick drawn out this many times longer, at the same pitch (its click kept as it
// is, its ring and decay stretched); `pitch`: semitones up or down, at the same length.
const CHAIN = { pan: 0.35, hpF: 180, masterLp: 15000, shelfF: 6000, shelfDb: 0, glueThr: -18, glueRatio: 2, level: 0, length: 2.5, pitch: -5 };

/**
 * The 'metal' tick (an aluminium leaf striking its stop, on a plastic frame). Times in ms,
 * levels in dB. contact: white noise highpassed at `hp`, decaying with `tauC`, and a second
 * hit `rattleMs` later at `rattleDb`. body: noise banded at `bodyF` (Q `bodyQ`) at `bodyDb`,
 * decaying with `tauB`, and modes `knockF0` at `knockDb`, decaying with `tauK`. ring: the
 * leaf's modes, `f1` times `ratios` (each tick a little different: `f1Jit`), at `modeDb`,
 * decaying with `tauM`. Then a treble shelf (`hfDb` above `hfF`) and a lowpass `lp`.
 */
const METAL = {
  len: 75, atk: 0.25, hp: 1300, dipF: 2600, dipQ: 0.6, dipDb: -8, tauC: 4, rattleMs: 5.5, rattleDb: -6,
  bodyF: 440, bodyQ: 2.4, bodyDb: -11, tauB: 5, knockF0: [400, 495], knockDb: [-23, -26], tauK: [7, 5.5],
  f1: 2700, f1Jit: 0.2, ratios: [1, 1.47, 1.89, 2.37, 2.93, 3.61],
  modeDb: [-20, -22, -25, -28, -31, -34], tauM: [10.5, 9, 7.5, 6.3, 5.4, 4.5],
  hfF: 6500, hfDb: -5, lp: 16000, bounceMs: 13, bounceDb: -20,
};

/**
 * The 'snap' tick: a sharp broadband snap through the recording's own resonances (measured
 * from 20 of its isolated ticks: a body at 470-680 Hz, then peaks near 1.6, 2.85, 3.25-3.85,
 * 6.2 and 9.5 kHz; every band down 20 dB in 10-15 ms), its spectrum within a few dB of
 * theirs from 250 Hz up and 1-2 dB softer above 5 kHz. The same for every tick; only the level
 * of each varies a little (`resJit` dB) and its frequency by ±`fJit`. Times in ms, levels in dB.
 *   excitation  white noise: a contact (rising in `atk`, decaying with `tauC`) and a tail
 *               (`tailDb`, decaying with `tauN`); a smaller second contact (`rbDb`) `rbMs` later.
 *   direct      the excitation itself, highpassed at `dHp`, at `directDb` (the snap's top).
 *   res         [Hz, Q, dB]: bandpass resonators on the excitation.
 *   lp          a one-pole lowpass over it all (softer on the ears than the real one).
 */
const SNAP = {
  len: 100, atk: 0.06, tauC: 0.7, tailDb: -6, tauN: 12, rbMs: 16, rbDb: -12,
  dHp: 1500, directDb: -10, lp: 6000, fJit: 0.015, resJit: 2,
  res: [[470, 9, 6], [560, 8, 0], [680, 10, 3], [900, 7, -5], [1250, 6, -5], [1600, 6, -4], [2100, 6, -6],
    [2850, 10, -5], [3250, 10, -3], [3650, 10, -3], [6200, 6, -9], [9500, 4, -14]],
};

export const VARIANTS = {
  pragotron: { kind: 'sample', ...CHAIN, ...DENSITY, rateJit: 0.05, level: 0, hpF: 200, shelfDb: -1.5, room: 0.7 },
  snap: { kind: 'snap', ...SNAP, ...CHAIN, ...DENSITY, rateJit: 0.02, level: -1 },
  metal: { kind: 'metal', ...METAL, ...CHAIN, ...DENSITY, shelfDb: -2, level: -2.5 },
};
export const DEFAULT = 'pragotron';

const POOL = 24; // synthesised ticks per sound (plus LANDS heavier ones)
const LANDS = 6;
const PANS = 5; // stereo positions (a panner per tick costs more than it adds)
const HEAD = db(-20); // each tick into the chain (headroom for the glue and limiter)
const MASTER = 4; // the master gain at full volume
const SMOOTH = 0.08; // s, how quickly the sense of "how busy" follows the landings
const PEAK = db(-2.5); // the loudest tick in a pool (a heavier landing)
const KEY = 'sound';

const AC = typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;
const OAC = typeof window === 'undefined' ? null : window.OfflineAudioContext || window.webkitOfflineAudioContext;

/** Clicks a second for `rate` landings a second (see DENSITY). */
export function clickRate(rate, p) {
  if (rate <= p.knee) return rate;
  const raw = p.knee * Math.pow(rate / p.knee, p.exp);
  const room = p.cmax - p.knee;
  return p.knee + room * (1 - Math.exp(-(raw - p.knee) / room));
}

/** Scale `d` so its peak is `to` (give or take `spread` dB) and fade its last `fadeS` s. */
function finish(d, sr, to, spread, fadeS) {
  let pk = 0;
  for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  const s = (to * db(rand(-spread, spread))) / (pk || 1);
  const fade = Math.ceil(sr * fadeS);
  for (let i = 0; i < d.length; i++) d[i] *= s * Math.min(1, (d.length - 1 - i) / fade);
  return d;
}

/** In-place radix-2 FFT of (re, im); `inv` for the inverse (scaled by 1/n). */
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < h; j++) {
        const k = i + j + h, tr = re[k] * cr - im[k] * ci, ti = re[k] * ci + im[k] * cr;
        re[k] = re[i + j] - tr;
        im[k] = im[i + j] - ti;
        re[i + j] += tr;
        im[i + j] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

const VN = 1024, VH = 256; // vocoder frame and hop (75% overlap)
const HANN = Float64Array.from({ length: VN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / VN));

/** `s` made `f` times longer at the same pitch (a phase vocoder: frames read `f` times closer
 *  together than they are written, each bin's phase carried on at its own frequency). */
function vocode(s, f) {
  const half = VN / 2, Ha = VH / f, M = Math.ceil(s.length * f), K = Math.floor(M / VH) + 1;
  const out = new Float32Array(M + VN);
  const re = new Float64Array(VN), im = new Float64Array(VN);
  const last = new Float64Array(half + 1), acc = new Float64Array(half + 1);
  let prev = 0;
  for (let k = 0; k < K; k++) {
    const ta = Math.round(k * Ha), st = ta - half;
    for (let i = 0; i < VN; i++) {
      const j = st + i;
      re[i] = (j >= 0 && j < s.length ? s[j] : 0) * HANN[i];
      im[i] = 0;
    }
    fft(re, im, false);
    const dt = ta - prev;
    for (let b = 0; b <= half; b++) {
      const mag = Math.hypot(re[b], im[b]), ph = Math.atan2(im[b], re[b]), w = (2 * Math.PI * b) / VN;
      if (!k) acc[b] = ph;
      else if (dt > 0) {
        let d = ph - last[b] - w * dt;
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        acc[b] += (w + d / dt) * VH;
      } else acc[b] += w * VH;
      last[b] = ph;
      re[b] = mag * Math.cos(acc[b]);
      im[b] = mag * Math.sin(acc[b]);
    }
    im[0] = im[half] = 0;
    for (let b = 1; b < half; b++) (re[VN - b] = re[b]), (im[VN - b] = -im[b]);
    fft(re, im, true);
    const ts = k * VH;
    for (let i = 0; i < VN; i++) out[ts + i] += (re[i] * HANN[i]) / 1.5; // (Hann² at 75% overlap adds up to 1.5)
    prev = ta;
  }
  return out.subarray(half, half + M);
}

/** A tick `f` times longer at the same pitch: its first 4.5 ms (the click) as it is, the rest
 *  stretched, crossfaded over 4 ms, and faded out at the end. */
export function stretch(x, sr, f) {
  if (Math.abs(f - 1) < 0.01) return Float32Array.from(x);
  const A = Math.round(sr * 0.0045), F = Math.round(sr * 0.002);
  if (x.length <= A + 4 * F) return Float32Array.from(x);
  const y = vocode(x.subarray(A - F), f);
  const out = new Float32Array(A - F + y.length);
  out.set(x.subarray(0, A - F));
  const fade = Math.round(sr * 0.01);
  for (let i = 0; i < y.length; i++) {
    const w = Math.min(1, i / (2 * F)), o = A - F + i < x.length ? x[A - F + i] : 0;
    out[A - F + i] = (o * (1 - w) + y[i] * w) * Math.min(1, (y.length - 1 - i) / fade);
  }
  return out;
}

/** RBJ biquad coefficients (`type`: 'bp' constant 0 dB peak, 'hp', 'lp'). */
function biquad(type, f, q, sr) {
  const w = (2 * Math.PI * f) / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a;
  const b = type === 'bp' ? [a, 0, -a] : type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * c) / a0, (1 - a) / a0];
}
function run(x, [b0, b1, b2, a1, a2], g = 1, out = null) {
  const y = out || new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] += v * g; // (into `out`, added; else a new array)
  }
  return y;
}

/** One 'snap' tick (mono, `p.len` ms) as samples. Pure arithmetic: no audio context needed. */
export function renderSnap(sr, p, land = false) {
  const n = Math.ceil((sr * p.len) / 1000);
  const ex = new Float32Array(n);
  const atk = (jit(p.atk, 0.2) * sr) / 1000, tc = (jit(p.tauC, 0.15) * sr) / 1000, tn = (jit(p.tauN, 0.1) * sr) / 1000;
  const rb = Math.round((jit(p.rbMs, 0.25) * sr) / 1000), rbG = db(p.rbDb + rand(-3, 3)), tail = db(p.tailDb);
  const t0 = Math.round(sr * 0.0005);
  for (let i = t0; i < n; i++) {
    const t = i - t0, up = 1 - Math.exp(-t / atk);
    let e = up * (Math.exp(-t / tc) + tail * Math.exp(-t / tn));
    if (t >= rb) e += rbG * (1 - Math.exp(-(t - rb) / atk)) * Math.exp(-(t - rb) / tc);
    ex[i] = (Math.random() * 2 - 1) * e;
  }
  const y = new Float32Array(n);
  run(ex, biquad('hp', p.dHp, 0.6, sr), db(p.directDb), y);
  for (const [f, q, g] of p.res) run(ex, biquad('bp', jit(f, p.fJit), q, sr), db(g + rand(-p.resJit, p.resJit)), y);
  // A one-pole lowpass (softness), then a highpass at 180 Hz (nothing lower).
  const k = 1 - Math.exp((-2 * Math.PI * p.lp) / sr);
  for (let i = 0, z = 0; i < n; i++) y[i] = z += k * (y[i] - z);
  const out = run(y, biquad('hp', 180, 0.707, sr));
  return finish(out, sr, land ? PEAK : PEAK * db(-DENSITY.landDb), 1.5, 0.025);
}

/** One 'metal' tick (mono, `p.len` ms), rendered offline. `land`: the last flap of a turn. */
export async function renderMetal(sr, p, land = false) {
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
  const out = filter('highpass', 180, 0.7);
  out.connect(filter('highshelf', p.hfF, 0, p.hfDb)).connect(filter('lowpass', jit(p.lp, 0.08), 0.707)).connect(oc.destination);
  const atk = jit(p.atk, 0.15) / 1000;
  const env = (t, g, tau, rise = atk) => {
    const e = oc.createGain();
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g, t + rise);
    e.gain.setTargetAtTime(0, t + rise, jit(tau, 0.15) / 1000);
    e.connect(out);
    return e;
  };
  const hit = (t, g) => {
    const s = oc.createBufferSource();
    s.buffer = noise(0.012);
    s.connect(filter('highpass', jit(p.hp, 0.1), 0.7)).connect(filter('peaking', p.dipF, p.dipQ, p.dipDb)).connect(env(t, g, p.tauC));
    s.start(t);
    const b = oc.createBufferSource();
    b.buffer = noise(0.03);
    const f = jit(p.bodyF, 0.08);
    b.connect(filter('bandpass', f, p.bodyQ)).connect(env(t, g * db(p.bodyDb) * Math.sqrt(sr / 2 / (f / p.bodyQ)), p.tauB, 0.0008));
    b.start(t);
  };
  const L = land ? db(DENSITY.landDb) : 1;
  hit(t0, L);
  hit(t0 + jit(p.rattleMs, 0.4) / 1000, L * db(p.rattleDb + rand(-3, 3)));
  if (land) hit(t0 + jit(p.bounceMs, 0.15) / 1000, L * db(p.bounceDb));
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
  finish(buf.getChannelData(0), sr, land ? PEAK : PEAK * db(-DENSITY.landDb), 1.5, 0.02);
  return buf;
}

/** The recorded ticks, cut from the decoded sprite (`audio`: an AudioBuffer) at the context's rate. */
export function cutSprite(ctx, audio, sp = SPRITE) {
  const sr = audio.sampleRate, d = audio.getChannelData(0);
  const ticks = [];
  let top = 0;
  for (let i = 0; i < sp.count; i++) {
    // Find this tick's click near where it should be: the first sample over a quarter of the
    // slot's peak (as it was found when the tick was cut).
    const a = Math.max(0, Math.floor((sp.lead + i * sp.slot - 0.02) * sr)), b = Math.min(d.length, Math.floor((sp.lead + i * sp.slot + 0.07) * sr));
    let pk = 0;
    for (let j = a; j < b; j++) pk = Math.max(pk, Math.abs(d[j]));
    if (!pk) continue;
    let on = a;
    while (on < b && Math.abs(d[on]) < pk * 0.25) on++;
    const st = Math.max(0, on - Math.round(sp.pre * sr)), n = Math.min(Math.round(sp.len * sr), d.length - st);
    const buf = ctx.createBuffer(1, n, sr);
    const o = buf.getChannelData(0);
    const fin = Math.round(sr * 0.0005), fout = Math.round(sr * 0.003);
    for (let j = 0; j < n; j++) o[j] = d[st + j] * Math.min(1, j / fin, (n - 1 - j) / fout);
    top = Math.max(top, pk);
    ticks.push(buf);
  }
  // As one set: the loudest a landing's level, the rest as recorded (already evened out).
  const s = (PEAK * db(-DENSITY.landDb)) / (top || 1);
  for (const t of ticks) for (let o = t.getChannelData(0), j = 0; j < o.length; j++) o[j] *= s;
  return ticks;
}

/** Everything one sound needs: { ticks, lands } (heavier landings: a set of their own, or
 *  the same ticks played `landDb` louder when `lands` is null). */
export async function renderPool(ctx, name, opts = {}) {
  const p = VARIANTS[name], sr = ctx.sampleRate;
  if (p.kind === 'sample') {
    try {
      const url = opts.spriteUrl || new URL(SPRITE.file, import.meta.url).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const raw = await res.arrayBuffer();
      const audio = await new Promise((ok, no) => {
        const pr = ctx.decodeAudioData(raw, ok, no);
        if (pr && pr.then) pr.then(ok, no);
      });
      const ticks = cutSprite(ctx, audio);
      if (ticks.length) return { ticks, lands: null };
    } catch {}
    return renderPool(ctx, 'snap'); // (the file didn't come: the synthesised one instead)
  }
  if (p.kind === 'snap') {
    const make = (land) => {
      const d = renderSnap(sr, p, land);
      const b = ctx.createBuffer(1, d.length, sr);
      b.getChannelData(0).set(d);
      return b;
    };
    return { ticks: Array.from({ length: POOL }, () => make(false)), lands: Array.from({ length: LANDS }, () => make(true)) };
  }
  const all = await Promise.all(Array.from({ length: POOL + LANDS }, (_, i) => renderMetal(sr, p, i >= POOL)));
  return { ticks: all.slice(0, POOL), lands: all.slice(POOL) };
}

export class FlapSound {
  /** `context`: an AudioContext to use instead of making one (an OfflineAudioContext, for
   *  tests). `spriteUrl`: where the recorded ticks are, if not beside the site's assets. */
  constructor({ variant = DEFAULT, volume = 0.6, context = null, spriteUrl = null } = {}) {
    this.variant = VARIANTS[variant] ? variant : DEFAULT;
    this.volume = volume;
    this.ctx = context;
    this.spriteUrl = spriteUrl;
    this.own = !context; // (only a context of our own is suspended when idle)
    this.pools = new Map(); // variant -> { ticks, lands } (or a promise of them)
    this.pool = null; // the ready sounds for the current variant; land() is ignored until then
    this.want = false;
    try { this.want = localStorage.getItem(KEY) === 'on'; } catch {}
    this.ends = []; // when each tick still playing ends (the voice cap)
    this.busy = 0; // landings in the last ~80 ms (decaying)
    this.carry = Math.random(); // the part of a click owed from earlier frames
    this.last = null; // the last buffer played (not repeated straight away)
    this.lastAt = 0; // when land() was last called (s, the context's clock)
    this.nextT = 0; // where the last frame's clicks ended
    this.prevMs = 0;
    this.idle = 0;
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

  /** Draw every tick out `v` times longer, at the same pitch (null: the sound's own). */
  setLength(v) {
    this.length = v == null ? null : clamp(v, 0.5, 12);
    this.reshape();
  }

  /** Every tick `v` semitones higher or lower, at the same length (null: the sound's own). */
  setPitch(v) {
    this.pitch = v == null ? null : clamp(v, -24, 24);
    this.reshape();
  }

  /** The current sound's ticks at the chosen length and pitch: worked out once per change, a
   *  few ticks at a time so the page never stalls (the last set plays meanwhile). */
  reshape() {
    const name = this.variant, raw = this.pools.get(name);
    if (!raw || raw instanceof Promise) return;
    const p = VARIANTS[name], f = (this.length ?? p.length) * Math.pow(2, (this.pitch ?? p.pitch) / 12);
    const key = `${name}|${f.toFixed(3)}`;
    if (key === this.shapeKey) return;
    this.shapeKey = key;
    const job = (this.job = {});
    if (Math.abs(f - 1) < 0.01) return void (this.pool = raw);
    const sr = this.ctx.sampleRate;
    const make = async (set) => {
      if (!set) return null;
      const out = [];
      for (const b of set) {
        const d = stretch(b.getChannelData(0), sr, f);
        const nb = this.ctx.createBuffer(1, d.length, sr);
        nb.getChannelData(0).set(d);
        out.push(nb);
        await new Promise((r) => setTimeout(r, 0));
        if (this.job !== job) return null;
      }
      return out;
    };
    (async () => {
      const ticks = await make(raw.ticks);
      const lands = ticks && (await make(raw.lands));
      if (this.job === job && ticks) this.pool = { ticks, lands };
    })();
  }

  /** How much of the recording's room the recorded ticks keep: 1 as recorded, 0 dry (each
   *  tick's click and its first moments only; null: the sound's own). */
  setRoom(v) {
    this.room = v == null ? null : clamp(v, 0, 1);
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

  /** The chain: pan buses, a steep highpass (no rumble or hum), a lowpass and treble shelf
   *  for comfort, a gentle compressor, the volume, and a limiter last so that nothing clips. */
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
  }

  /** Make the current sound ready if it isn't yet (once per sound; the recorded one is
   *  fetched now, the first time it is wanted). Returns its pool, or a promise of it. */
  prepare() {
    if (!this.ctx) return null;
    const name = this.variant;
    let got = this.pools.get(name);
    if (!got) {
      got = renderPool(this.ctx, name, { spriteUrl: this.spriteUrl }).then((pool) => {
        this.pools.set(name, pool);
        if (this.variant === name) {
          this.pool = pool;
          this.shapeKey = null;
          this.reshape();
        }
        return pool;
      }, () => {
        this.pools.delete(name);
        return null;
      });
      this.pools.set(name, got);
    }
    if (!(got instanceof Promise)) {
      if (this.shapeKey?.split('|')[0] !== name) (this.pool = got), (this.shapeKey = null);
      this.reshape();
    }
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
   * heavier landing); left out, one click in six is a heavier one. Plays a few clicks at
   * most, spread over the next frame.
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
    this.busy = this.busy * Math.exp(-Math.max(0, now - this.lastAt) / SMOOTH) + n;
    this.lastAt = now;
    if (n <= 0 || !pool) return;
    const rate = this.busy / SMOOTH; // landings per second, roughly
    const cps = clickRate(rate, p);
    // This frame's share of the clicks (a fraction carried on to the next).
    const want = (n * cps) / rate + this.carry;
    let count = Math.min(n, Math.floor(want));
    this.carry = Math.min(0.999, want - count);
    const ends = this.ends;
    for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= now) ends[i] = ends[ends.length - 1], ends.pop();
    const all = count;
    count = Math.min(count, p.perFrame, p.maxVoices - ends.length);
    if (count <= 0) return;
    // (Fewer clicks than landings: each stands in for a few, as loud as they'd be together.)
    const g = HEAD * db(p.level) * Math.pow(Math.max(cps, p.ref) / p.ref, -p.fall) * Math.sqrt(all / count);
    const busy = clamp((cps - p.knee) / (p.cmax - p.knee), 0, 1);
    let heavy = final === undefined ? -1 : Math.min(count, Math.round((final / n) * count + Math.random() - 0.5));
    // Spread over the frame (clicks all on the frame's edge buzz at 60 Hz), following on from
    // the last frame's unless the clock has got ahead of us.
    let t = this.nextT;
    if (t < now + 0.01 || t > now + 0.08) t = now + 0.02;
    this.nextT = t + dt;
    const spread = n > 1 ? 0.5 : 0;
    let prev = -1;
    for (let i = 0; i < count; i++) {
      const isLand = heavy < 0 ? Math.random() < 1 / 6 : i < heavy;
      const set = isLand && pool.lands ? pool.lands : pool.ticks;
      let k = (Math.random() * set.length) | 0;
      if (set[k] === this.last) k = (k + 1) % set.length;
      const s = this.ctx.createBufferSource();
      s.buffer = this.last = set[k];
      const pr = Math.pow(2, (this.pitch ?? p.pitch) / 12); // (the ticks were drawn out by this much more, to make up)
      const r = (s.playbackRate.value = pr * (1 + (Math.random() * 2 - 1) * p.rateJit));
      const gn = this.ctx.createGain();
      // A cluster: this module stepped just after the last one, a little quieter.
      const near = prev >= 0 && Math.random() < p.cluster * busy;
      let lv = g * db(p.makeup - p.spread * Math.pow(Math.random(), p.skew)) * (isLand && !pool.lands ? db(p.landDb) : 1);
      if (near) lv *= db(rand(p.clusterDb[0], p.clusterDb[1]));
      gn.gain.value = lv;
      // (The recording's room is in each tick's tail: past its first 6 ms, fade it as fast as
      // `room` asks, from 8 ms (dry) to as recorded.)
      const room = p.kind === 'sample' ? this.room ?? p.room : 1;
      const at = clamp(pan + (Math.random() * 2 - 1) * spread, -1, 1);
      s.connect(gn).connect(this.buses[Math.round(((at + 1) / 2) * (PANS - 1))]);
      const when = near ? prev + rand(p.clusterMs[0], p.clusterMs[1]) / 1000 : t + ((i + rand(0.1, 0.9)) / count) * dt;
      prev = when;
      if (room < 1) {
        const at = when + 0.006 / r; // (the click is as it was; its decay is drawn out with it)
        gn.gain.setValueAtTime(lv, at);
        gn.gain.setTargetAtTime(0, at, ((0.008 + 0.09 * room) * (this.length ?? p.length)) / (r / pr));
      }
      ends.push(when + s.buffer.duration / r);
      s.onended = () => gn.disconnect();
      s.start(when);
    }
  }
}
