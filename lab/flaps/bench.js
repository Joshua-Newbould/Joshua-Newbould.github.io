// Speed test for the split-flap board: the WebGL renderer against the current 2D canvas one,
// with every switch on screen flipping continuously (a harder load than any real transition).
import { Board, glyph, solid } from './board.js';
import { GLBoard } from './glboard.js';

const qs = new URLSearchParams(location.search);
const mode = qs.get('mode') || 'gl'; // gl | 2d
const size = qs.get('size') || 'normal'; // normal | ascii
const link = (k, v, label, box) => {
  const p = new URLSearchParams(location.search);
  p.set(k, v);
  const a = document.createElement('a');
  a.href = '?' + p;
  a.textContent = label;
  if ((qs.get(k) || (k === 'mode' ? 'gl' : 'normal')) === v) a.className = 'on';
  document.getElementById(box).append(a);
};
link('mode', 'gl', 'GPU (new)', 'mode');
link('mode', '2d', '2D (current)', 'mode');
link('size', 'normal', 'Normal switches', 'size');
link('size', 'ascii', 'ASCII (4x)', 'size');

// Switch sizes exactly as the site picks them.
const cssW = document.documentElement.clientWidth || innerWidth;
const cssH = innerHeight;
const dpr = Math.min(devicePixelRatio || 1, 2);
const target = Math.min(24, Math.max(7.5, Math.sqrt(cssW * cssH) / (Math.min(cssW, cssH) < 640 ? 70 : 58)));
let m = Board.metrics(cssW, cssH, dpr, target, 1.9);
if (size === 'ascii') m = Board.subdivide(m, 2);

const canvas = document.getElementById('c');
let board = null;
let note = '';
if (mode === 'gl') {
  try { board = GLBoard.create(canvas, {}); } catch (e) { note = 'WebGL error: ' + e.message; }
  if (!board) note ||= 'No WebGL2 on this device: the site would use 2D here.';
}
if (!board) board = new Board(canvas);
board.flap = 'crisp';
board.setShade('#1a1030', 1);
board.configure(m, solid('#050506'));

let seed = 3;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pal = ['#e8e2d4', '#f5d76e', '#7fd1b9', '#ff7a59', '#a0c4ff', '#c9a7ff'];
const faces = [];
if (size === 'ascii') for (const ch of '#@%*+=.:-') for (const fg of pal) faces.push(glyph(ch, fg, '#07090c', 600));
for (let i = 0; i < 24; i++) faces.push(solid('#' + ((i * 977231 + 0x203040) & 0xffffff).toString(16).padStart(6, '0')));

// Like a page change: a wave of flips crossing the board every 1.6 s, plus background drift.
const gaps = []; // [time, gap]
let last = 0, jsSum = 0, jsN = 0, waveAt = 0;
const stats = document.getElementById('stats');
function frame(now) {
  const a = performance.now();
  if (now - waveAt > 1600) {
    waveAt = now;
    const f = faces;
    for (const c of board.cells) board.flip(c, f[Math.floor(rnd() * f.length)], { dur: 200, delay: ((c.x + c.y * 0.6) / (m.W + m.H * 0.6)) * 1000 });
  } else {
    for (const c of board.cells) if (!c.anim && !c.q.length && rnd() < 0.004) board.flip(c, faces[Math.floor(rnd() * faces.length)], { dur: 200 });
  }
  board.tick(now);
  if (board.render) board.render(now);
  jsSum += performance.now() - a; jsN++;
  if (last) gaps.push([now, now - last]);
  last = now;
  while (gaps.length && now - gaps[0][0] > 4000) gaps.shift();
  if (jsN % 15 === 0 && gaps.length > 20) {
    const g = gaps.map((x) => x[1]);
    const fps = (1000 * g.length) / g.reduce((s, x) => s + x, 0);
    const bad = g.filter((x) => x > 34).length;
    const worst = Math.max(...g);
    stats.innerHTML = `<span class="big">${fps.toFixed(0)} fps</span>   ${board.gl ? 'GPU renderer' : '2D renderer'}\n` +
      `stutters (>34 ms) in last 4 s: ${bad}   worst frame: ${worst.toFixed(0)} ms\n` +
      `JS per frame: ${(jsSum / jsN).toFixed(1)} ms   switches: ${board.cells.length}   ${cssW}x${cssH} @${dpr}` + (note ? `\n${note}` : '');
    jsSum = 0; jsN = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
