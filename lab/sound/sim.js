// Simulated landings, bucketed into 60 fps frames: [{ n, pan, final }] per frame.

const FPS = 60;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function bucket(events, seconds) {
  const frames = Array.from({ length: Math.ceil(seconds * FPS) }, () => ({ n: 0, sx: 0, final: 0 }));
  for (const e of events) {
    const f = frames[Math.floor(e.t * FPS)];
    if (!f) continue;
    f.n++;
    f.sx += e.x;
    if (e.final) f.final++;
  }
  return frames.map((f) => ({ n: f.n, pan: f.n ? f.sx / f.n : 0, final: f.final }));
}

/** A wave across a board of `cells` cells (cols x rows), each turning 2-5 flaps (about 95 ms
 *  apiece) after a diagonal front reaches it, over `front` s. */
export function wave(cells, { front = 0.9, seed = 7, drift = 0, seconds = 2.2 } = {}) {
  const r = rng(seed);
  const cols = Math.round(Math.sqrt(cells * 3.2)), rows = Math.ceil(cells / cols);
  const ev = [];
  for (let i = 0; i < cells; i++) {
    const x = i % cols, y = (i / cols) | 0;
    let t = 0.05 + ((x / cols) * 0.7 + (y / rows) * 0.3) * front + r() * 0.04;
    const steps = 2 + Math.floor(r() * 4);
    for (let k = 0; k < steps; k++) {
      t += 0.095 * (1 + (r() * 2 - 1) * 0.05);
      ev.push({ t, x: (x / (cols - 1)) * 2 - 1, final: k === steps - 1 });
    }
  }
  if (drift) ev.push(...driftEvents(drift, seconds, seed + 1));
  return bucket(ev, seconds);
}

/** Background drift: `perFrame` flaps a frame on average, here and there. */
function driftEvents(perFrame, seconds, seed) {
  const r = rng(seed), ev = [];
  const n = Math.round(perFrame * seconds * FPS);
  for (let i = 0; i < n; i++) ev.push({ t: r() * seconds, x: r() * 2 - 1, final: r() < 0.3 });
  return ev;
}

export function drift(perFrame = 2, seconds = 5) {
  return bucket(driftEvents(perFrame, seconds, 3), seconds);
}

/** One character: the drum turns `steps` flaps. */
export function character(steps = 3 + Math.floor(Math.random() * 4)) {
  const ev = [];
  for (let k = 0; k < steps; k++) ev.push({ t: 0.02 + k * 0.095 * (1 + (Math.random() * 2 - 1) * 0.05), x: 0, final: k === steps - 1 });
  return bucket(ev, steps * 0.1 + 0.1);
}

export function single() {
  return bucket([{ t: 0.005, x: 0, final: true }], 0.05);
}

export const total = (frames) => frames.reduce((a, f) => a + f.n, 0);
