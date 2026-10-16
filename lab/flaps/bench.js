// One rigorous speed test of the split-flap board, at about twice the site's switch density:
// page waves with section pieces, a ripple, the switch to ASCII (4x the switches) through a
// picture of the old board, waves in ASCII, and back, with background drift throughout.
// Results per phase are kept per renderer (in this browser) so the two can be compared.
import { Board, glyph, solid, slice, source } from './board.js';
import { GLBoard } from './glboard.js';

const qs = new URLSearchParams(location.search);
const mode = qs.get('mode') === '2d' ? '2d' : 'gl';
document.getElementById('m-' + mode).classList.add('on');
const $ = (id) => document.getElementById(id);

const cssW = document.documentElement.clientWidth || innerWidth;
const cssH = innerHeight;
const dpr = Math.min(devicePixelRatio || 1, 2);
// The site's switch size, then twice as many switches.
const siteTarget = Math.min(24, Math.max(7.5, Math.sqrt(cssW * cssH) / (Math.min(cssW, cssH) < 640 ? 70 : 58)));
const normal = Board.metrics(cssW, cssH, dpr, siteTarget / Math.SQRT2, 1.9);
const ascii = Board.subdivide(normal, 2);

const canvas = $('c');
let board = null;
let note = '';
if (mode === 'gl') {
  try { board = GLBoard.create(canvas, {}); } catch (e) { note = 'WebGL error: ' + e.message; }
  if (!board) note ||= 'No WebGL2 here: showing 2D.';
}
const isGL = !!board;
if (!board) board = new Board(canvas);
board.flap = 'crisp';
board.setShade('#1a1030', 1);
board.configure(normal, solid('#0a0b10'));
$('info').textContent = `${isGL ? 'GPU' : '2D'} renderer · ${normal.cols * normal.rows} switches, ${ascii.cols * ascii.rows} in ASCII · ${cssW}×${cssH} @${dpr}` + (note ? ' · ' + note : '');

// (The prototype keeps a few textures for snapshot pictures: free the ones no longer shown.)
function freeSources(keep) {
  if (!isGL) return;
  const gl = board.gl;
  for (const [id, e] of [...board.srcSlots]) {
    if (keep.includes(id)) continue;
    gl.deleteTexture(e.tex);
    board.slotUse[e.slot] = null;
    board.srcSlots.delete(id);
  }
}

// Colours: a slowly moving field, as the site's background.
let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
let scheme = 0;
const SCHEMES = [[[40, 30, 90], [150, 60, 170]], [[20, 70, 90], [60, 170, 160]], [[90, 40, 30], [220, 120, 70]]];
function rgbAt(c, t) {
  const [a, b] = SCHEMES[scheme % SCHEMES.length];
  const u = 0.5 + 0.5 * Math.sin(c.x / board.W * 5 + c.y / board.H * 3 + t / 1400 + Math.sin(c.y / board.H * 4 - t / 2100));
  return a.map((v, k) => v + (b[k] - v) * u);
}
const CHARS = ' .:-=+*#%@';
function faceAt(c, t) {
  const [r, g, b] = rgbAt(c, t);
  if (board.cells.length === ascii.cols * ascii.rows) {
    const L = (0.3 * r + 0.59 * g + 0.11 * b) / 200;
    const ch = CHARS[Math.max(1, Math.min(9, Math.round(L * 9)))];
    const q = (v) => Math.round(v / 40) * 40 + 30; // (a bounded set of colours, as the site's)
    return glyph(ch, hex(q(r) * 1.4, q(g) * 1.4, q(b) * 1.4), '#07090c', 600);
  }
  return solid(hex(r, g, b));
}

// A section card: a picture of type on a panel, cut into switch-sized slices by the waves.
function cardSource() {
  const c = document.createElement('canvas');
  c.width = board.W;
  c.height = board.H;
  const x = c.getContext('2d');
  const w = board.W * 0.72, h = board.H * 0.6, x0 = (board.W - w) / 2, y0 = (board.H - h) / 2;
  x.fillStyle = '#f3f1fa';
  x.fillRect(x0, y0, w, h);
  x.fillStyle = '#231d33';
  x.fillRect(x0, y0, w, 34 * dpr);
  x.fillStyle = '#231d33';
  x.font = `700 ${Math.round(w / 9)}px sans-serif`;
  x.fillText('PUBLICATIONS', x0 + 20 * dpr, y0 + 34 * dpr + w / 8);
  x.font = `${13 * dpr}px monospace`;
  for (let k = 0, y = y0 + 34 * dpr + w / 8 + 40 * dpr; y < y0 + h - 20 * dpr; k++, y += 20 * dpr) x.fillText('2026  A benchmark of expert-level academic questions '.slice(0, 20 + (k * 7) % 30), x0 + 20 * dpr, y);
  return { src: source(c), rect: [x0, y0, w, h] };
}
let card = null;
// (The site renders its sections' pictures ahead of time; so does the test, GPU upload included.)
function prepareCard() {
  card = cardSource();
  if (isGL) board.srcSlot(card.src);
}
const inCard = (c) => card && c.x + board.cw > card.rect[0] && c.x < card.rect[0] + card.rect[2] && c.y + board.ch > card.rect[1] && c.y < card.rect[1] + card.rect[3];

const FLIP = 200 * 1.0; // (board.durScale adds the site's slow-down)
const WAVE = 1000;
const diag = (c) => ((c.x + c.y * 0.7) / (board.W + board.H * 0.7)) * WAVE;
const ripple = (c, o = [board.W / 2, board.H / 2]) => (Math.hypot(c.x - o[0], c.y - o[1]) / Math.hypot(board.W / 2, board.H / 2)) * WAVE;

function wave(tau, toCard) {
  const t = performance.now();
  for (const c of board.cells) {
    const d = tau(c);
    const f = toCard && inCard(c) ? slice(card.src, c.x, c.y, '#f3f1fa') : faceAt(c, t + d);
    board.flip(c, f, { dur: FLIP, delay: d });
  }
}

// The site's smooth switch between switch sizes: a picture of the board as it is, cut into the
// new switches (bare, so it looks unchanged), which then ripple over to their own faces.
function changeSize(m) {
  const now = performance.now();
  if (isGL) board.render(now); // (the GPU's picture is read in the same task as it is drawn)
  const pic = document.createElement('canvas');
  pic.width = board.W;
  pic.height = board.H;
  pic.getContext('2d').drawImage(board.canvas, 0, 0);
  const src = source(pic);
  freeSources([]);
  card = null;
  board.configure(m, solid('#0a0b10'));
  board.hold();
  for (const c of board.cells) {
    board.set(c, slice(src, c.x, c.y));
    board.setEdges(c, 0);
  }
  board.release();
  prepareCard();
  const t = performance.now();
  for (const c of board.cells) board.flip(c, faceAt(c, t), { dur: FLIP, delay: ripple(c), edgesIn: 40 });
}

let drift = true;
const PHASES = [
  ['Page wave in', () => wave(diag, true), 1700],
  ['Page wave out', () => { scheme++; wave((c) => WAVE - diag(c), false); }, 1700],
  ['Ripple', () => { scheme++; wave(ripple, false); }, 1500],
  ['Normal → ASCII', () => changeSize(ascii), 1900],
  ['ASCII wave in', () => wave(diag, true), 1700],
  ['ASCII wave out', () => { scheme++; wave((c) => WAVE - diag(c), false); }, 1700],
  ['ASCII → normal', () => changeSize(normal), 1900],
  ['Drift', () => {}, 1500],
];

let run = null; // { k, t0, gaps: [], js: [] , rows: [] }
let last = 0;
function stats(gaps, js) {
  const n = gaps.length || 1;
  const fps = (1000 * gaps.length) / (gaps.reduce((a, b) => a + b, 0) || 1);
  return { fps, bad: gaps.filter((g) => g > 34).length, worst: gaps.length ? Math.max(...gaps) : 0, js: js.reduce((a, b) => a + b, 0) / (js.length || 1), n };
}

function frame(now) {
  const a = performance.now();
  if (drift) {
    for (const c of board.cells) if (!c.anim && !c.q.length && rnd() < 0.006) board.flip(c, card && inCard(c) && c.cur.t === 'slice' ? c.cur : faceAt(c, now), { dur: FLIP });
  }
  if (run) {
    const ph = PHASES[run.k];
    if (now - run.t0 > ph[2]) {
      run.rows.push([ph[0], stats(run.gaps, run.js)]);
      run.k++;
      run.gaps = []; run.js = [];
      if (run.k < PHASES.length) { run.t0 = now; $('status').textContent = `Running: ${PHASES[run.k][0]}`; PHASES[run.k][1](); }
      else finish();
    }
  }
  board.tick(now);
  if (isGL) board.render(now);
  if (run && last) { run.gaps.push(now - last); run.js.push(performance.now() - a); }
  last = now;
  requestAnimationFrame(frame);
}

const KEY = 'flapbench:' + mode;
function load(m) { try { return JSON.parse(localStorage.getItem('flapbench:' + m)); } catch { return null; } }
function finish() {
  const all = run.rows.map((r) => r[1]);
  const total = { fps: all.reduce((a, s) => a + s.fps * s.n, 0) / all.reduce((a, s) => a + s.n, 0), bad: all.reduce((a, s) => a + s.bad, 0), worst: Math.max(...all.map((s) => s.worst)), js: all.reduce((a, s) => a + s.js, 0) / all.length };
  const res = { rows: run.rows, total, info: $('info').textContent, isGL };
  try { localStorage.setItem(KEY, JSON.stringify(res)); } catch {}
  run = null;
  $('run').disabled = false;
  $('status').textContent = `Done: ${total.fps.toFixed(0)} fps, ${total.bad} stutters, worst ${total.worst.toFixed(0)} ms`;
  show();
}

const tone = (s) => (s.bad === 0 && s.fps >= 57 ? 'good' : s.bad <= 2 && s.fps >= 45 ? 'ok' : 'bad');
function show() {
  const g = load('gl'), d = load('2d');
  if (!g && !d) { $('res').innerHTML = ''; return; }
  const names = (g || d).rows.map((r) => r[0]).concat(['Whole test']);
  const cell = (s) => (!s ? '<td>–</td>' : `<td class="${tone(s)}">${s.fps.toFixed(0)} fps · ${s.bad}</td>`);
  let h = '<tr><th>fps · stutters</th><th>GPU</th><th>2D</th></tr>';
  names.forEach((n, k) => {
    const at = (r) => r && (k < r.rows.length ? r.rows[k][1] : r.total);
    h += `<tr${k === names.length - 1 ? ' style="font-weight:700"' : ''}><td>${n}</td>${cell(at(g))}${cell(at(d))}</tr>`;
  });
  const worst = (r) => (r ? r.total.worst.toFixed(0) + ' ms' : '–');
  h += `<tr><td>Worst frame</td><td>${worst(g)}</td><td>${worst(d)}</td></tr>`;
  if (g && !g.isGL) h += '<tr><td colspan=3 style="color:#aaa">(the GPU column ran on 2D: no WebGL2)</td></tr>';
  $('res').innerHTML = h;
}

$('run').onclick = () => {
  $('run').disabled = true;
  if (board.cells.length !== normal.cols * normal.rows) changeSize(normal);
  if (!card) prepareCard();
  scheme = 0;
  run = { k: 0, t0: performance.now(), gaps: [], js: [], rows: [] };
  $('status').textContent = `Running: ${PHASES[0][0]}`;
  PHASES[0][1]();
};
show();
prepareCard();
// Start from a settled board.
{ const t = performance.now(); for (const c of board.cells) board.flip(c, faceAt(c, t), { dur: FLIP, delay: ripple(c) }); }
requestAnimationFrame(frame);
