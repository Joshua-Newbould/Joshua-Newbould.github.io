// The board's sound: each flap that lands ticks, synthesised (no recordings). A few dozen
// varied ticks are rendered once, when sound is first switched on, and replayed with small
// changes of pitch and level; a whole board turning over becomes a rattle, like light rain.
// Off by default; a browser won't start audio until someone has pressed something, so a
// remembered "on" waits for the first press or key (the page passes it on via gesture()).

const db = (x) => Math.pow(10, x / 20);
const rand = (a, b) => a + Math.random() * (b - a);
const jit = (x, f) => x * (1 + (Math.random() * 2 - 1) * f);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * The three sounds. Times in ms, levels in dB against the tick's contact (estimates from how
 * the boards are built; there are no published measurements, so these were tuned by ear).
 *   contact  the flap striking its stop: noise, highpassed at `hp`, banded at `bp` (Q `bpQ`)
 *   modes    the flap's own brief ring, `tauM` its decay
 *   knock    the drum and case answering: a low falling tone
 *   snick    the flap slipping off its edge, `snickLead` before it lands (-90: none)
 *   land     the last flap of a turn: louder, with a small bounce `bounceMs` later
 *   bed      the rattle under a dense wave (ticks past the voice cap go into it), in from
 *            `bedStart` ticks/s and at full level by `bedStart + bedFull`
 */
export const VARIANTS = {
  // A large airport board: thin metal flaps, a woody-metallic clack with a tinny ring and a low thump.
  solari: {
    len: 140, atk: 0.4, hp: 600, bp: 2200, bpQ: 1.4, tauC: 3.5,
    modes: [1900, 3150], modeDb: [-14, -20], tauM: [9, 5],
    knockF0: 170, knockDrop: 0.65, knockWave: 'sine', knockDb: -9, tauK: 22,
    snickLead: 12, snickHp: 3000, snickDb: -16,
    landDb: 3, bounceMs: 32, bounceDb: -13, lp: 7500,
    rateJit: 0.05, k: 0.4, maxVoices: 96, maxPerFrame: 14,
    bedF: 1600, bedQ: 0.8, bedDb: -20, bedStart: 60, bedFull: 600, am: [7, 11], amDb: 2.5,
    pan: 0.6, masterLp: 8000, shelfDb: -3, glueThr: -20, glueRatio: 3, level: 0,
  },
  // A small desk unit: plastic flaps, a dry quick tik with almost no low end.
  desk: {
    len: 90, atk: 0.3, hp: 1400, bp: 3600, bpQ: 1.8, tauC: 1.8,
    modes: [3300, 5100], modeDb: [-18, -24], tauM: [4, 2.5],
    knockF0: 330, knockDrop: 0.7, knockWave: 'triangle', knockDb: -16, tauK: 9,
    snickLead: 6, snickHp: 4500, snickDb: -20,
    landDb: 2, bounceMs: 18, bounceDb: -22, lp: 9000,
    rateJit: 0.03, k: 0.3, maxVoices: 64, maxPerFrame: 10,
    bedF: 3000, bedQ: 1, bedDb: -28, bedStart: 80, bedFull: 800, am: [11, 15], amDb: 1.5,
    pan: 0.25, masterLp: 10000, shelfDb: -2, glueThr: -20, glueRatio: 3, level: -3,
  },
  // For leaving on: a muffled tok, well below 4 kHz, that hardly grows louder in a wave.
  soft: {
    len: 120, atk: 0.8, hp: 250, bp: 1300, bpQ: 0.9, tauC: 3,
    modes: [1500], modeDb: [-28], tauM: [3],
    knockF0: 130, knockDrop: 0.75, knockWave: 'sine', knockDb: -5, tauK: 18,
    snickLead: 0, snickHp: 3000, snickDb: -90,
    landDb: 1.5, bounceMs: 0, bounceDb: -90, lp: 3200,
    rateJit: 0.04, k: 0.18, maxVoices: 40, maxPerFrame: 6,
    bedF: 1100, bedQ: 0.7, bedDb: -30, bedStart: 40, bedFull: 400, am: [6, 9], amDb: 1,
    pan: 0.35, masterLp: 4000, shelfDb: -6, glueThr: -26, glueRatio: 4, level: -7,
  },
};

const POOL = 18; // ordinary ticks per sound (plus LANDS accents)
const LANDS = 6;
const PANS = 5; // stereo positions (a panner per tick costs more than it adds)
const HEAD = db(-20); // each tick into the chain (headroom: the glue compressor should only touch waves)
const MASTER = 4; // the master gain at full volume (a single tick's peaks then near -11 dBFS)
const SMOOTH = 0.08; // s, how quickly the sense of "how busy" follows the landings
const KEY = 'sound';

const AC = typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;
const OAC = typeof window === 'undefined' ? null : window.OfflineAudioContext || window.webkitOfflineAudioContext;

/** Render one tick (mono, `p.len` ms) offline. `land`: the last flap of a turn. */
export async function renderTick(sr, p, land = false) {
  const len = Math.ceil((sr * p.len) / 1000);
  const oc = new OAC(1, len, sr);
  const lead = (p.snickDb > -60 ? p.snickLead : 0) / 1000;
  const t0 = 0.002 + lead; // (the contact; a snick comes first)
  const L = land ? db(p.landDb) : 1;
  const noise = (s) => {
    const b = oc.createBuffer(1, Math.ceil(sr * s), sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  };
  const out = oc.createBiquadFilter();
  out.type = 'lowpass';
  out.frequency.value = jit(p.lp, 0.08);
  out.Q.value = 0.5;
  out.connect(oc.destination);
  const atk = jit(p.atk, 0.15) / 1000;
  const burst = (t, g, hp, bp, q, tau) => {
    const s = oc.createBufferSource();
    s.buffer = noise(0.012);
    const h = oc.createBiquadFilter();
    h.type = 'highpass';
    h.frequency.value = jit(hp, 0.08);
    h.Q.value = 0.7;
    const b = oc.createBiquadFilter();
    b.type = 'bandpass';
    b.frequency.value = jit(bp, 0.08);
    b.Q.value = q;
    const e = oc.createGain();
    e.gain.setValueAtTime(0, t);
    // (Banding noise leaves only its band's share of the power: made up, so `g` is the burst's
    // own level and the other parts' dB are against it.)
    e.gain.linearRampToValueAtTime(g * Math.sqrt(sr / 2 / (bp / q)), t + atk);
    e.gain.setTargetAtTime(0, t + atk, jit(tau, 0.15) / 1000);
    s.connect(h).connect(b).connect(e).connect(out);
    s.start(t);
  };
  burst(t0, L, p.hp, p.bp, p.bpQ, p.tauC);
  if (p.snickDb > -60) burst(0.002, db(p.snickDb), p.snickHp, p.snickHp * 1.6, 1, 0.8);
  if (land && p.bounceDb > -60) burst(t0 + jit(p.bounceMs, 0.15) / 1000, db(p.bounceDb), p.hp, p.bp, p.bpQ, p.tauC);
  // The ring: sines from phase 0, so they start without a click.
  p.modes.forEach((f, i) => {
    const o = oc.createOscillator();
    o.frequency.value = jit(f, 0.06);
    const e = oc.createGain();
    e.gain.setValueAtTime(L * db(p.modeDb[i]), t0);
    e.gain.setTargetAtTime(0, t0, jit(p.tauM[i], 0.15) / 1000);
    o.connect(e).connect(out);
    o.start(t0);
  });
  const k = oc.createOscillator();
  k.type = p.knockWave;
  const f0 = jit(p.knockF0, 0.05);
  k.frequency.setValueAtTime(f0, t0);
  k.frequency.exponentialRampToValueAtTime(f0 * p.knockDrop, t0 + 0.015);
  const ke = oc.createGain();
  ke.gain.setValueAtTime(0, t0);
  ke.gain.linearRampToValueAtTime(L * db(p.knockDb + (land ? 4 : 0)), t0 + 0.001); // (1 ms: no pop)
  ke.gain.setTargetAtTime(0, t0 + 0.001, jit(p.tauK, 0.15) / 1000);
  k.connect(ke).connect(out);
  k.start(t0);
  const buf = await oc.startRendering();
  const d = buf.getChannelData(0);
  let pk = 0;
  for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  // To -2.5 dBFS, give or take 1.5 dB, with the last 8 ms faded so nothing is cut off sharply.
  const s = (db(-2.5) * db(rand(-1.5, 1.5))) / (pk || 1);
  const fade = Math.ceil(sr * 0.008);
  for (let i = 0; i < d.length; i++) d[i] *= s * Math.min(1, (d.length - 1 - i) / fade);
  return buf;
}

/** The ticks for one sound: { ticks, lands }. */
export async function renderPool(sr, p) {
  const all = await Promise.all(Array.from({ length: POOL + LANDS }, (_, i) => renderTick(sr, p, i >= POOL)));
  return { ticks: all.slice(0, POOL), lands: all.slice(POOL) };
}

export class FlapSound {
  /** `context`: an AudioContext to use instead of making one (an OfflineAudioContext, for tests). */
  constructor({ variant = 'solari', volume = 0.6, context = null } = {}) {
    this.variant = VARIANTS[variant] ? variant : 'solari';
    this.volume = volume;
    this.ctx = context;
    this.own = !context; // (only a context of our own is suspended when idle)
    this.pools = new Map(); // variant -> { ticks, lands } (or a promise of them)
    this.pool = null; // the ready ticks for the current sound; land() is ignored until then
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

  /** The chain every tick goes through: pan buses and the rattle bed, a gentle lowpass and
   *  shelf for comfort, a compressor to glue a wave together, the volume, and a limiter last
   *  so that no wave at any volume clips. */
  build() {
    const c = this.ctx;
    this.mix = c.createGain();
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.5;
    this.shelf = c.createBiquadFilter();
    this.shelf.type = 'highshelf';
    this.shelf.frequency.value = 6000;
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
    for (const x of [this.mix, this.lp, this.shelf]) {
      x.channelCount = 2;
      x.channelCountMode = 'explicit';
    }
    this.mix.connect(this.lp).connect(this.shelf).connect(this.glue).connect(this.out).connect(this.limit).connect(c.destination);
    this.buses = Array.from({ length: PANS }, () => {
      const b = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
      b.connect(this.mix);
      return b;
    });
    // The bed: looped noise, banded, its level wobbling a little so it reads as many flaps.
    const n = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = n;
    src.loop = true;
    this.bedBp = c.createBiquadFilter();
    this.bedBp.type = 'bandpass';
    const am = c.createGain();
    this.lfo = c.createOscillator();
    this.lfoDepth = c.createGain();
    this.lfo.connect(this.lfoDepth).connect(am.gain);
    this.bed = c.createGain();
    this.bed.gain.value = 0;
    this.bedK = 1; // (made up for the band's share of the noise, as in renderTick)
    src.connect(this.bedBp).connect(am).connect(this.bed).connect(this.mix);
    src.start();
    this.lfo.start();
    this.tune();
  }

  /** Set the chain for the current sound. */
  tune() {
    const p = VARIANTS[this.variant], t = this.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(p.masterLp, t, 0.05);
    this.shelf.gain.setTargetAtTime(p.shelfDb, t, 0.05);
    this.glue.threshold.value = p.glueThr;
    this.glue.ratio.value = p.glueRatio;
    this.bedBp.frequency.value = p.bedF;
    this.bedBp.Q.value = p.bedQ;
    this.bedK = Math.sqrt(this.ctx.sampleRate / 2 / (p.bedF / p.bedQ));
    this.lfo.frequency.value = rand(...p.am);
    this.lfoDepth.gain.value = db(p.amDb) - 1;
    this.buses.forEach((b, i) => b.pan && (b.pan.value = p.pan * ((i / (PANS - 1)) * 2 - 1)));
  }

  /** Render the current sound's ticks if they aren't yet (a few ms, once per sound). */
  prepare() {
    if (!this.ctx) return null;
    const name = this.variant;
    let got = this.pools.get(name);
    if (!got) {
      got = renderPool(this.ctx.sampleRate, VARIANTS[name]).then((pool) => {
        this.pools.set(name, pool);
        if (this.variant === name) this.pool = pool;
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
   * ticks, spread over the next frame, and lets the rattle bed carry the rest.
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
    // The bed: in as the landings thicken, out again (by itself) soon after they stop.
    const bg = this.bed.gain;
    bg.cancelScheduledValues(now);
    bg.setTargetAtTime(HEAD * this.bedK * db(p.bedDb) * clamp((rate - p.bedStart) / p.bedFull, 0, 1), now, 0.06);
    bg.setTargetAtTime(0, now + 0.12, 0.1);
    if (n <= 0) return;
    if (Math.random() < 0.05) this.lfo.frequency.setTargetAtTime(rand(...p.am), now, 0.2);
    const ends = this.ends;
    for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= now) ends[i] = ends[ends.length - 1], ends.pop();
    // No more a frame than the voices can keep up (filling them all at once, then waiting for
    // them all to end, pulses at the length of a tick).
    const steady = Math.max(1, Math.round((p.maxVoices * dt * 1000) / p.len));
    const count = Math.min(n, p.maxPerFrame, steady, p.maxVoices - ends.length);
    if (count <= 0) return;
    this.played += count;
    // Loudness grows with the log of how busy it is, not the square root: each tick is turned
    // down as 1/√(ticks sounding together), and the whole up by 1 + k·log2(landings).
    const d = Math.max(1, this.busy * 0.625), dp = Math.max(1, this.played * 0.625); // (per 50 ms)
    const g = HEAD * db(p.level) * (1 + p.k * Math.log2(d)) / Math.sqrt(dp);
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
