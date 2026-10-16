// Joshua Newbould's site: a normal web page whose sections sit snapped onto a board of
// split-flap switches. The board shows a slow moving background; when the page changes, the
// sections turn into switches, flip across to the next page in a wave, and become web sections
// again. Everything here is built for that: the board (board.js), the background (paint.js),
// the design system and its variations (design.js), and the transitions below.

import { Board, solid, glyph, mosaic, source as imageSource, slice } from './board.js';
import { GLBoard } from './glboard.js';
import { Paint } from './paint.js';
import { watchCodes } from './secrets.js';
import { MOTIONS, loadLook, saveLook, scheme as makeScheme, gutter, bgMode, mountOptions, combosOf, comboOf, setCombo, boardHue, oklch as oklchHex } from './design.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let canvas = $('#board'); // (a new one if the GPU is lost for good: see fallBack)
const source = $('#source');
const introEl = $('#intro');
const siteEl = $('#site');
const headerEl = () => $('#site > header');
const footerEl = () => $('#site > footer');

const rand = Math.random;
const pick = (a) => a[(rand() * a.length) | 0];
const randInt = (a, b) => a + ((rand() * (b - a + 1)) | 0);
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const clean = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// ---------------------------------------------------------------------------
// Content (the HTML is the source of truth)

const pages = $$('[data-page]').map((el, i) => ({
  id: el.id,
  el,
  num: String(i + 1).padStart(2, '0'),
  label: el.dataset.label || '',
  name: clean($('h2', el)),
}));
const nav = $$('#site-nav a').map((a) => ({ el: a, id: a.getAttribute('href').slice(1) }));
const themeToggle = $('#theme-toggle');
const themeSwitches = () => $$('.theme-switch'); // the header's, and the title box's
/** The theme switch on screen now. */
const liveSwitch = () => (S.key === 'intro' ? $('#intro-theme') : themeToggle);
const touchy = matchMedia('(hover: none), (pointer: coarse)'); // a touch screen first (no keyboard for the secret codes)
const prevBtn = $('[data-board="prev"]');
const nextBtn = $('[data-board="next"]');

// Give generated labels real elements (so snapshots, which copy the laid-out DOM, show them),
// and put each card's contents in one box that can be scaled down to fit the screen.
for (const pg of pages) {
  const el = pg.el;
  const index = Object.assign(document.createElement('p'), { className: 'w-index' });
  index.append(Object.assign(document.createElement('b'), { textContent: pg.num }), pg.label);
  const big = Object.assign(document.createElement('p'), { className: 'w-big', textContent: el.dataset.big || pg.name });
  for (const n of [index, big]) n.setAttribute('aria-hidden', 'true');
  el.prepend(index, big);
  for (const li of $$('li[data-code]', el)) li.prepend(Object.assign(document.createElement('span'), { className: 'w-code', textContent: li.dataset.code }));
  for (const li of $$('ol > li[data-year]', el)) {
    li.prepend(Object.assign(document.createElement('span'), { className: 'w-year', textContent: li.dataset.year }));
    li.append(Object.assign(document.createElement('span'), { className: 'w-status', textContent: li.dataset.status }));
  }
  const fit = Object.assign(document.createElement('div'), { className: 'w-fit' });
  fit.append(...el.childNodes);
  el.append(fit);
  // The pieces a card can be split into when it doesn't fit the screen: list items, rows of
  // facts and paragraphs (the label and title stay on every part).
  pg.units = [];
  for (const child of fit.children) {
    if (child.matches('.w-index, .w-big, h2, [data-strip]')) continue;
    if (child.matches('ul, ol, dl, .bio')) pg.units.push(...child.children);
    else pg.units.push(child);
  }
  pg.part = 0;
  pg.parts = [pg.units];
  pg.splitting = false;
  const pager = document.createElement('div');
  pager.className = 'w-pager';
  pager.innerHTML =
    '<button type="button" class="pg-prev" aria-label="Previous part"><svg class="arr" aria-hidden="true" viewBox="0 0 12 8"><path d="M4 1 1 4l3 3M1 4h10"/></svg></button>' +
    '<span class="pg-num" aria-live="polite"></span>' +
    '<button type="button" class="pg-next" aria-label="Next part"><svg class="arr" aria-hidden="true" viewBox="0 0 12 8"><path d="m8 1 3 3-3 3M11 4H1"/></svg></button>';
  el.append(pager);
  pg.pager = pager;
  // The window style's title strip and status line (hidden in the plain style).
  const bar = document.createElement('div');
  bar.className = 'w-bar';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = `<span class="w-dot"></span><span class="w-path">JN://<b>${pg.id}</b></span><span class="w-stripes"><i></i><i></i><i></i><i></i></span>`;
  el.prepend(bar);
  const status = document.createElement('div');
  status.className = 'w-statusline';
  status.setAttribute('aria-hidden', 'true');
  status.innerHTML = `<span>SEC ${pg.num}/${String(pages.length).padStart(2, '0')}</span>`;
  el.append(status);
}

// The title box gets the same window strip and status line.
{
  const bar = document.createElement('div');
  bar.className = 'w-bar';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<span class="w-dot"></span><span class="w-path">JN://<b>home</b></span><span class="w-stripes"><i></i><i></i><i></i><i></i></span>';
  // ASCII mode and the sun/moon switch, here too, so they can be chosen before entering.
  const ascii = $('#ascii-toggle').cloneNode(true);
  ascii.id = 'intro-ascii';
  const sw = themeToggle.cloneNode(true);
  sw.id = 'intro-theme';
  bar.removeAttribute('aria-hidden');
  for (const n of bar.querySelectorAll('.w-dot, .w-path, .w-stripes')) n.setAttribute('aria-hidden', 'true');
  bar.append(ascii, sw);
  introEl.prepend(bar);
  const status = document.createElement('div');
  status.className = 'w-statusline';
  status.setAttribute('aria-hidden', 'true');
  status.innerHTML = `<span>SEC 00/${String(pages.length).padStart(2, '0')}</span>`;
  introEl.append(status);
}

/** Show one part of a card (all of it when it fits in one). */
function showPart(pg) {
  const parts = pg.parts;
  pg.part = Math.min(Math.max(0, pg.part), parts.length - 1);
  const on = new Set(parts[pg.part]);
  for (const u of pg.units) u.hidden = !on.has(u);
  // A list with nothing showing goes too (its spacing would remain).
  for (const box of new Set(pg.units.map((u) => u.parentElement))) {
    if (box.classList.contains('w-fit')) continue;
    box.hidden = ![...box.children].some((u) => !u.hidden);
  }
  const paged = parts.length > 1 || !!pg.splitting;
  pg.el.classList.toggle('paged', paged);
  pg.el.classList.toggle('later', pg.part > 0); // parts after the first drop the repeated lines
  pg.el.dataset.part = paged ? `${pg.part + 1}/${parts.length}` : '';
  const two = (n) => String(n).padStart(2, '0');
  $('.pg-num', pg.pager).textContent = `${two(pg.part + 1)}/${two(parts.length)}`; // (as the status line's 'SEC 01/04')
  const prev = $('.pg-prev', pg.pager);
  const next = $('.pg-next', pg.pager);
  const focused = document.activeElement;
  prev.disabled = pg.part === 0;
  next.disabled = pg.part === parts.length - 1;
  $('.pg-num', pg.pager).setAttribute('aria-label', `Part ${pg.part + 1} of ${parts.length}`);
  prev.setAttribute('aria-label', prev.disabled ? 'Previous part' : `Previous part (${pg.part} of ${parts.length})`);
  next.setAttribute('aria-label', next.disabled ? 'Next part' : `Next part (${pg.part + 2} of ${parts.length})`);
  // A pager arrow that has just run out hands keyboard focus to the other one.
  if (focused === prev && prev.disabled && !next.disabled) next.focus({ preventScroll: true });
  if (focused === next && next.disabled && !prev.disabled) prev.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// State

const look = loadLook();
const savedDark = () => {
  try {
    return localStorage.getItem('theme') === 'dark';
  } catch {
    return false;
  }
};

const S = {
  key: 'intro', // 'intro' or a page id
  dark: savedDark(),
  wantDark: null, // the theme the switch asks for (ahead of `dark` while a ripple starts)
  overlay: null, // switches standing in for sections mid-transition (cell -> face)
  brushMap: null, // switches standing in for sections being brushed
  frame: null, // current background colours, one per switch
  pt: rand() * 50, // background time
  lastNow: 0,
  lastStep: -Infinity,
  size: '',
  brush: null,
  lite: false, // no usable GPU (or too slow): bigger switches, a lighter background
  ascii: false, // ASCII mode (the header's >_ button): the background as coloured characters
  player: null, // Bad Apple!! playing on the board (see badapple.js); 'loading' while it loads
  small: false, // smaller switches: 'ascii' (half size, two by two to a switch) or 'apple' (Bad Apple)
  layoutGeom: null, // the normal board's grid: the page is always laid out on it
};

const SPEED = 0.032; // background time per second: a steady drift
// How often the background is re-sampled, and how far a switch's colour may drift before it
// flips. Without a GPU ("lite") both relax, so there is less to compute and to draw.
// While a wave is crossing, the background updates more often so its drift keeps pace on both
// sides of the front (no lull ahead of it, none in its wake).
const stepMs = () => (S.lite ? 900 : 500);
const paintThreshold = () => (S.lite ? 22 : 16);

const paint = new Paint(); // (first: whether there is a real GPU decides how the board is drawn)
const boardListeners = []; // the board canvas's input handlers (see onBoard)
let board = makeBoard();
// (While comparing: ?flap=crisp (the default), clack or snap.)
{
  const f = new URLSearchParams(location.search).get('flap');
  if (['clack', 'snap', 'crisp'].includes(f)) board.flap = f;
}

/**
 * The board, drawn by the GPU (glboard.js) where there is a real one, else on a 2D canvas: with
 * no WebGL2, a software GPU (lite), or ?gl=0. (?gl=1: by the GPU even if it is a slow one; until
 * GL_BY_DEFAULT is on, only then.)
 */
function makeBoard() {
  const GL_BY_DEFAULT = false; // (off until it has been tried on more devices: ?gl=1 turns it on)
  const want = new URLSearchParams(location.search).get('gl');
  const gl = want !== '0' && (want === '1' || (GL_BY_DEFAULT && !paint.lite)) && GLBoard.create(canvas, { force: want === '1' });
  if (gl) {
    gl.onfail = fallBack;
    return gl;
  }
  const b = new Board(canvas);
  if (b.ctx) return b;
  // (WebGL got as far as the canvas, then failed: a canvas keeps the kind of context it had.)
  newCanvas();
  return new Board(canvas);
}

/** The GPU was lost for good: carry on with the board on a 2D canvas. */
function fallBack() {
  const flap = board.flap;
  newCanvas();
  board = new Board(canvas);
  board.flap = flap;
  if (S.player && S.player !== 'loading') S.player.board = board;
  S.size = '';
  build(false);
}

/** A fresh board canvas in place of the old one, with the same input handlers. */
function newCanvas() {
  const c = canvas.cloneNode(false);
  canvas.replaceWith(c);
  canvas = c;
  for (const [type, fn] of boardListeners) c.addEventListener(type, fn);
}
/** Listen on the board canvas (whichever it is). */
function onBoard(type, fn) {
  boardListeners.push([type, fn]);
  canvas.addEventListener(type, fn);
}
const scheme = (key = S.key) => makeScheme(key, S.dark, look);
const pageIndex = (id) => pages.findIndex((p) => p.id === id);

// ---------------------------------------------------------------------------
// Colours & look

function applyLook() {
  const root = document.documentElement;
  root.dataset.font = look.font;
  root.dataset.chrome = look.chrome;
  // Console is the window layout with an inverted strip (data-console on top of data-card=window).
  root.dataset.card = look.card === 'console' ? 'window' : look.card;
  if (look.card === 'console') root.dataset.console = '';
  else delete root.dataset.console;
  root.dataset.theme = S.dark ? 'dark' : 'light';
  paint.mode = bgMode(look);
}

/** Expose a page's colours (the current one's by default) to CSS. */
function applyColours(key = S.key) {
  const sc = scheme(key);
  const rs = document.documentElement.style;
  for (const k of ['surface', 'bar', 'line', 'text', 'soft', 'muted', 'accent']) rs.setProperty('--' + k, sc[k]);
  rs.setProperty('--gapc', gutter(S.dark, look, S.key));
  sc.brush.forEach((c, k) => rs.setProperty(`--st${k + 1}`, c)); // the window strip's colours
  if (key === S.key) $('meta[name="theme-color"]')?.setAttribute('content', sc.bar);
}

// ---------------------------------------------------------------------------
// Switch faces

const hexToRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const rgbHex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
const mixHex = (a, b, t) => {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  return rgbHex(...p.map((v, k) => Math.round(v + (q[k] - v) * t)));
};
// The same blend in OKLab, where halfway between two colours looks halfway (no muddy dip).
const toLin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
function hexToLab(h) {
  return rgbToLab(...hexToRgb(h));
}
function rgbToLab(r8, g8, b8) {
  const r = toLin(r8);
  const g = toLin(g8);
  const b = toLin(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labToRgb(L, A, B) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
const labToHex = ([L, A, B]) => rgbHex(...labToRgb(L, A, B));
const mixLab = (a, b, t) => {
  const p = hexToLab(a);
  const q = hexToLab(b);
  return labToHex(p.map((v, k) => v + (q[k] - v) * t));
};
/**
 * A blend that goes round the colour wheel (keeping colourfulness), the way that doesn't pass
 * through olive; near-neutral colours (card surfaces, the silver title) blend in OKLab.
 */
const hexToLch = (h) => {
  const [L, A, B] = hexToLab(h);
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
};
const inOlive = (h) => ((h = (h + 360) % 360), h > 65 && h < 150);
const mixLch = (a, b, t) => {
  const [L1, C1, h1] = hexToLch(a);
  const [L2, C2, h2] = hexToLch(b);
  if (C1 < 0.03 || C2 < 0.03) return mixLab(a, b, t);
  let d = ((h2 - h1 + 540) % 360) - 180;
  const crosses = (dd) => {
    for (let s = 0.1; s < 0.95; s += 0.1) if (inOlive(h1 + dd * s)) return true;
    return false;
  };
  const alt = d > 0 ? d - 360 : d + 360;
  if (crosses(d) && !crosses(alt)) d = alt;
  const C = Math.max(C1 + (C2 - C1) * t, 0.85 * Math.min(C1, C2));
  const h = ((h1 + d * t) * Math.PI) / 180;
  return labToHex([L1 + (L2 - L1) * t, C * Math.cos(h), C * Math.sin(h)]);
};

/** What a switch shows when it isn't standing in for a section: null = background. */
const faceAt = (i) => (S.overlay && S.overlay.get(i)) || (S.brushMap && S.brushMap.get(i)) || null;
const isPaint = (f) => !f;


/** The face a switch shows for a background colour: the colour itself, or in ASCII mode a
 *  character for how light it is, in that colour, on a near-black face. */
function paintFace(r, g, b, ascii = S.ascii) {
  if (!ascii) return solid(rgbHex(r, g, b));
  const [lo, hi] = frameLuma();
  // (Colours rounded to 32 levels a channel, so the characters' bitmaps can be shared.)
  const q = (v) => Math.min(255, Math.round(v / 8) * 8);
  const fg = rgbHex(q(r), q(g), q(b));
  const t = Math.max(0, Math.min(1, (luma(r, g, b) - lo) / Math.max(1, hi - lo)));
  const f = glyph(rampChar(t ** 0.75), fg, ASCII_FACE, 600); // (a gentle curve: the denser characters come in sooner)
  f.avg = fg; // (blends between faces go by the character's colour, not the black)
  return f;
}
const ASCII_FACE = '#07090c';
const RAMP = '.,:;=+*#%@';
/** The character for a lightness `t` (0 = the darkest colour on the board now, 1 = the lightest). */
const rampChar = (t) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(t * RAMP.length)))];
/** Rec. 709 luma of an sRGB colour (0–255 channels), close enough to choose a character. */
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** The board's range of lightness now, from its 5th to its 95th percentile (so a few outliers
 *  don't squeeze everything else into the faintest characters). */
function frameLuma() {
  const fr = S.frame;
  if (!fr.luma) {
    const ls = [];
    for (let k = 0; k < fr.rgb.length; k += 3 * 5) ls.push(luma(fr.rgb[k], fr.rgb[k + 1], fr.rgb[k + 2]));
    ls.sort((a, b) => a - b);
    fr.luma = [ls[Math.floor(ls.length * 0.05)] ?? 0, ls[Math.floor(ls.length * 0.95)] ?? 255];
  }
  return fr.luma;
}
const concrete = (f, i) => f || paintFace(S.frame.rgb[i * 3], S.frame.rgb[i * 3 + 1], S.frame.rgb[i * 3 + 2]);
/** The overall colour of a face, for blending between faces. */
const faceColour = (f) => f.avg || f.bg;

function rememberPaint(c, stagger = false) {
  const k = c.i * 3;
  c.r = S.frame.rgb[k];
  c.g = S.frame.rgb[k + 1];
  c.b = S.frame.rgb[k + 2];
  if (stagger) staggerMemory(c, k);
}

/**
 * After a transition every switch shows exactly the current colour, so none would be due to
 * flip again until they all were at once. In steady drift each switch is anywhere between
 * "just flipped" and "about to": set its remembered colour a uniformly random fraction of the
 * flip threshold behind, along the way its colour is moving, so the drift carries on unbroken.
 */
function staggerMemory(c, k) {
  const ago = recentPast();
  let dr = c.r - ago[k];
  let dg = c.g - ago[k + 1];
  let db = c.b - ago[k + 2];
  let len = Math.hypot(dr, dg, db);
  if (len < 1) {
    // (barely moving here: any direction will do)
    [dr, dg, db] = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
    len = Math.hypot(dr, dg, db) || 1;
  }
  const back = (rand() * paintThreshold()) / len;
  c.r -= dr * back;
  c.g -= dg * back;
  c.b -= db * back;
}
/** The background as it was a little while ago (about one switch's time between drift flips). */
function recentPast() {
  // (One frame per slice of pattern time is plenty for this, and recomputing it every frame is costly.)
  const key = `${Math.round(S.pt / 0.015)}|${scheme().name}|${S.dark}|${look.palette}|${paint.mode}`;
  if (recentPast.key !== key) {
    recentPast.key = key;
    recentPast.rgb = paint.frame(S.pt - 0.1, scheme()).rgb;
  }
  return recentPast.rgb;
}

/** Bring switches up to date. `how(i, face)` returns flip options, or null to switch at once.
 *  `force(i)` flips a switch even if its face hasn't changed. */
function retarget(indices, how, force = null) {
  const pk = 'paint:' + scheme().name + (S.dark ? 'd' : 'l') + look.palette;
  for (const i of indices) {
    const abs = faceAt(i);
    const key = abs ? abs.key : pk;
    const c = board.cells[i];
    // Background staying background while a sweep crosses the board: the sweep moves it on.
    if (S.sweep && !abs && c.key?.startsWith('paint:')) {
      c.key = key;
      c.abs = abs;
      continue;
    }
    if (c.key === key && !(force && force(i))) continue;
    c.key = key;
    c.abs = abs;
    if (S.sweep) S.sweep.turned[i] = 1; // (flipped here, so the sweep's front leaves it be)
    if (isPaint(abs)) rememberPaint(c, true);
    const f = concrete(abs, i);
    const opts = how && !reduce.matches ? how(i, f) : null;
    if (opts) board.flip(c, f, opts);
    else board.set(c, f);
  }
}

function* allCells() {
  for (let i = 0; i < board.cells.length; i++) yield i;
}

/** Every switch back to normal edges (e.g. when a transition is interrupted). */
function resetEdges() {
  for (const c of board.cells) if ((c.ca ?? 1) !== 1 || c.caAnim) board.setEdges(c, 1);
}

// ---------------------------------------------------------------------------
// Board & layout

/**
 * Switch width (CSS px) from the screen's size: small screens get small switches, so a phone
 * shows as rich a board as a desktop; big screens get bigger ones. Without a GPU they are a
 * little bigger again, so there are fewer to draw.
 */
function cellTarget(w, h) {
  const base = Math.min(24, Math.max(7.5, Math.sqrt(w * h) / (Math.min(w, h) < 640 ? 70 : 58)));
  return S.lite ? base * 1.3 : base;
}

function build(first) {
  const cssW = document.documentElement.clientWidth || window.innerWidth;
  const cssH = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, S.lite ? 1.5 : 2);
  const size = `${cssW}x${cssH}@${dpr}${S.lite ? 'L' : ''}${S.small || ''}`;
  if (size === S.size) return;
  // (Only the switches changed, not the window: the sections' snapshots still hold, but not how
  // they were cut into switches.)
  const sameWindow = S.size && S.size.replace(/[a-z]*$/, '') === size.replace(/[a-z]*$/, '');
  S.size = size;
  board.hold(); // (every switch is set up first, then drawn once)
  try {
    dropBrush();
    if (!first) cancelWeb(); // a wave's switches belong to the old grid
    board.gapColor = boardGutter();
    shadeBoard();
    // The page is always laid out on the normal grid. ASCII mode splits each of its switches in
    // two each way (so cards and bars stay exactly where they are); Bad Apple's are smaller still.
    const normal = Board.metrics(cssW, cssH, dpr, cellTarget(cssW, cssH), 1.9);
    S.layoutGeom = { ...normal, gap: Math.max(1, Math.round(dpr)) };
    const m = S.small === 'ascii' ? Board.subdivide(normal, 2) : S.small === 'apple' ? Board.metrics(cssW, cssH, dpr, Math.max(4, cellTarget(cssW, cssH) * (S.lite ? 0.55 : 0.4)), 1.9) : normal;
    board.configure(m, solid(board.gapColor));
    // (A sweep still crossing the board was for the old switches: the new ones start out in the
    // new colours.)
    if (S.sweep && S.sweep.turned.length !== board.cells.length) S.sweep = null;
    board.sizeScale = Math.sqrt(m.ch / normal.ch);
    paint.resize(board);
    S.frame = paint.frame(S.pt, scheme());
    S.lastStep = performance.now();
    retarget(allCells(), null);
  } finally {
    board.release();
  }
  layoutWeb();
  if (sameWindow) for (const shot of shotCache.values()) shot.then((x) => x?.slices?.clear());
  else shotCache.clear();
  schedulePrefetch();
}

/** The switches the board wants: Bad Apple's while it plays, half-size in ASCII mode, else normal. */
const smallWanted = () => (S.player ? 'apple' : S.ascii ? 'ascii' : false);
/**
 * Rebuild the board on other switches, if that changes (or `force`). `smooth`: the new switches
 * start out showing their piece of the board as it was, bare (no gutters), so nothing visibly
 * changes until a wave turns them over. Returns whether it did that.
 */
function setSmall(mode, { force = false, smooth = false } = {}) {
  if (mode === S.small && !force) return false;
  const shot = smooth && board.cells.length ? board.capture() : null;
  S.small = mode;
  paint.useCpu = !!mode; // (see paint.frame)
  S.size = '';
  if (!shot) {
    build(false);
    return false;
  }
  board.hold(); // (the new board is drawn once, already showing the old one's picture)
  try {
    build(false);
    const src = imageSource(shot);
    const rgb = S.frame.rgb;
    for (const c of board.cells) {
      if (!isPaint(c.abs)) continue;
      board.set(c, slice(src, c.x, c.y, rgbHex(rgb[c.i * 3], rgb[c.i * 3 + 1], rgb[c.i * 3 + 2])));
      board.setEdges(c, 0);
    }
  } finally {
    board.release();
  }
  return true;
}

/** The section that changes between screens: the visible page card, or the title. */
const morphBox = () => (S.key === 'intro' ? introEl : pages.find((p) => !p.el.hidden)?.el);

/** Keep the DOM in step with the current screen. */
function syncDom() {
  const intro = S.key === 'intro';
  introEl.hidden = !intro;
  siteEl.hidden = intro;
  for (const pg of pages) pg.el.hidden = intro || pg.id !== S.key;
  for (const n of nav) {
    if (n.id === S.key) n.el.setAttribute('aria-current', 'page');
    else n.el.removeAttribute('aria-current');
  }
  for (const t of themeSwitches()) t.setAttribute('aria-checked', String(S.wantDark ?? S.dark));
  if (!intro) setFooterLabels(S.key);
  // The window title names the page, and a change of page is read out.
  const name = intro ? '' : pages[pageIndex(S.key)].name;
  document.title = name ? `${name} · Joshua Newbould` : 'Joshua Newbould';
  if (syncDom.shown !== undefined && syncDom.shown !== S.key) $('#announce').textContent = name ? `${name} page` : 'Title screen';
  syncDom.shown = S.key;
  applyColours();
  layoutWeb();
}

/** The footer's previous / next buttons name their pages. */
function setFooterLabels(id) {
  const k = pageIndex(id);
  const n = pages.length;
  $('.lbl', prevBtn).textContent = pages[(k - 1 + n) % n].name;
  $('.lbl', nextBtn).textContent = pages[(k + 1) % n].name;
  prevBtn.setAttribute('aria-label', `Previous: ${pages[(k - 1 + n) % n].name}`);
  nextBtn.setAttribute('aria-label', `Next: ${pages[(k + 1) % n].name}`);
}

/**
 * Snap every box to the switch grid: each starts on a switch's top-left edge, ends on a
 * switch's bottom-right edge, and is only as big as its content needs, so as much of the
 * board as possible stays visible.
 */
function layoutWeb() {
  layoutWebBoxes();
  if (!S.overlay) placeShadow(morphBox()); // outside a transition the shadow follows the card
}

/** Give a bar the first of `modes` (sets of classes) under which nothing in it overflows `width`. */
function fitBar(el, width, modes) {
  const all = [...new Set(modes.flat())];
  const [hid, sh] = [el.hidden, siteEl.hidden];
  el.hidden = false;
  siteEl.hidden = false;
  Object.assign(el.style, { width: `${width}px`, height: 'auto' });
  // Nothing may overflow, nor run into the bar's own padding.
  const fits = () => {
    const lim = el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight) + 6; // (buttons' tap areas reach 4px past their text)
    return [el, ...el.children].every((x) => x.scrollWidth <= x.clientWidth + 5) && [...el.querySelectorAll('button, p, a')].every((x) => x.getBoundingClientRect().right <= lim);
  };
  for (const m of modes) {
    el.classList.remove(...all);
    el.classList.add(...m);
    // 'abbr': links with a short form (data-short) use it.
    for (const a of el.querySelectorAll('[data-short]')) {
      a.dataset.full ||= a.textContent;
      a.textContent = m.includes('abbr') ? a.dataset.short : a.dataset.full;
    }
    if (fits()) break;
  }
  el.hidden = hid;
  siteEl.hidden = sh;
}

function layoutWebBoxes() {
  if (!board.cells.length) return;
  const G = S.layoutGeom || board; // (the normal grid, whatever size the switches are now)
  // Window-size classes for the CSS (copied into snapshots, which media queries can't see).
  {
    const w = G.cssW;
    const h = G.cssH;
    const short = h <= 560 && w > h;
    // ('phone' layouts are for narrow portrait screens; a phone on its side is 'short'.)
    document.documentElement.dataset.vp = [w < 640 && !short && 'phone', (w >= 1000 || (w >= 800 && short)) && 'wide', short && 'short', touchy.matches && 'touch'].filter(Boolean).join(' ');
  }
  const dpr = G.dpr;
  const cw = G.cw / dpr;
  const ch = G.ch / dpr;
  const gap = G.gap / dpr;
  const x0 = G.ox / dpr;
  const y0 = G.oy / dpr;
  const rows = G.fullRows;
  const all = G.cols;
  const narrow = G.cssW < 640;
  const margin = narrow ? 1 : 2;
  // Cards are a comfortable reading width (up to ~880px) and centred, leaving plenty of board;
  // on phones too there is a band of board either side.
  const span = Math.min(G.cols - (narrow ? 8 : 2 * margin * 2), Math.ceil(880 / cw));
  const c0 = Math.floor((G.cols - span) / 2);
  const inset = look.chrome !== 'hairline'; // Floating & Frame: header and footer as wide as the content
  const rs = document.documentElement.style;
  rs.setProperty('--cw', `${cw}px`);
  rs.setProperty('--ch', `${ch}px`);
  rs.setProperty('--inset', `${Math.max(0, x0 + c0 * cw)}px`);
  const place = (el, c, r, w, h) => {
    Object.assign(el.style, { left: `${x0 + c * cw}px`, top: `${y0 + r * ch}px`, width: `${w * cw - gap}px`, height: `${h * ch - gap}px` });
  };
  // Rows a box needs for its content at a given width (in switches).
  const rowsFor = (el, w) => {
    Object.assign(el.style, { width: `${w * cw - gap}px`, height: 'auto' });
    return Math.max(1, Math.ceil((el.scrollHeight + gap) / ch));
  };
  // Measure even while hidden, so transitions know both layouts.
  const measure = (el, w) => {
    const [hid, sh] = [el.hidden, siteEl.hidden];
    el.hidden = false;
    siteEl.hidden = false;
    const r = rowsFor(el, w);
    el.hidden = hid;
    siteEl.hidden = sh;
    return r;
  };

  const bw = inset ? span : all;
  const bc = inset ? c0 : 0;
  // Header and footer: the roomiest layout that fits on one line each (short screens keep
  // the nav on the header's row as long as they can, since height is what they lack).
  const short = G.cssH <= 560 && G.cssW > G.cssH;
  fitBar(headerEl(), bw * cw - gap, short ? [[], ['compact'], ['compact', 'tight'], ['compact', 'tight', 'abbr'], ['stack', 'tight', 'abbr']] : [[], ['compact'], ['stack'], ['stack', 'tight'], ['stack', 'tight', 'abbr']]);
  fitBar(footerEl(), bw * cw - gap, [[], ['compact'], ['nocopy'], ['nocopy', 'compact'], ['nocopy', 'compact', 'notool'], ['nocopy', 'compact', 'notool', 'arrows']]);
  {
    // Header and footer share one inset.
    const hd = headerEl();
    const ft = footerEl();
    const tight = ['compact', 'stack'].some((c) => hd.classList.contains(c)) || ['compact', 'nocopy'].some((c) => ft.classList.contains(c));
    hd.classList.toggle('pad-tight', tight);
    ft.classList.toggle('pad-tight', tight);
  }
  // The grid is centred, so its top and bottom rows are cut about equally. Each bar covers its
  // cut row and as many whole rows as its content needs, and is at least BAR_MIN tall where it
  // shows: the header and footer come out the same height (their content in the visible part).
  const cutTop = Math.max(0, -G.oy / G.dpr); // (hidden above the window)
  const over = inset ? 0 : G.rows - rows; // (rows partly below the window)
  const seenBottom = over ? G.cssH - (G.oy + rows * G.ch) / G.dpr : 0; // (how much of that row shows)
  const barMin = short ? 0 : 40; // (a phone on its side keeps every pixel of height for the cards)
  const contentOf = (el) => {
    const [hid, sh] = [el.hidden, siteEl.hidden];
    el.hidden = siteEl.hidden = false;
    Object.assign(el.style, { width: `${bw * cw - gap}px`, height: 'auto' });
    const px = el.scrollHeight;
    el.hidden = hid;
    siteEl.hidden = sh;
    return px;
  };
  headerEl().style.setProperty('--cut', '0px');
  footerEl().style.paddingBottom = '';
  const needH = Math.max(barMin, contentOf(headerEl()));
  const needF = Math.max(barMin, contentOf(footerEl()));
  const seenTop = cutTop ? ch - cutTop : 0;
  const hh = (cutTop ? 1 : 0) + Math.max(0, Math.ceil((needH - seenTop + gap) / ch));
  const fh = Math.max(0, Math.ceil((needF - seenBottom + gap) / ch));
  headerEl().style.setProperty('--cut', `${cutTop}px`);
  const top0 = inset ? 1 : 0;
  place(headerEl(), bc, top0, bw, hh);
  // The full-width footer also covers a part-visible last row; its text stays centred in the visible part.
  if (over) footerEl().style.paddingBottom = `${(over * G.ch) / G.dpr - (G.cssH - (G.oy + rows * G.ch) / G.dpr)}px`;
  if (inset) place(footerEl(), bc, rows - 1 - fh, bw, fh);
  else place(footerEl(), 0, rows - fh, all, fh + over);

  // Board shows all round the card: a gap under the header and over the footer, and a card
  // no taller than about three quarters of the space (more than that is split into parts).
  const vgap = narrow ? 2 : 1;
  const top = top0 + hh + vgap;
  const room = rows - (inset ? 1 : 0) - fh - vgap - top;
  // A card may use most of the height (more on a portrait screen) before it splits into parts.
  const portrait = G.cssH > G.cssW;
  const maxRows = Math.max(6, Math.floor(room * (portrait ? 0.9 : 0.84)));
  // Fit every card (hidden ones too), so all of them can share one top: where the tallest is centred.
  const heights = new Map();
  const sh = siteEl.hidden;
  siteEl.hidden = false;
  for (const p of pages) {
    const hid = p.el.hidden;
    p.el.hidden = false;
    const key = [span, maxRows, room, cw, ch, look.font, look.chrome, look.card, document.documentElement.dataset.vp].join('|');
    if (p.fitKey !== key) {
      p.fitKey = key;
      // Short screens may use their whole height; elsewhere a card leaves board above and below.
      fitCard(p, (r) => rowsFor(p.el, span) <= r, short ? room : maxRows, room, narrow);
    }
    heights.set(p, p.rows(rowsFor, span));
    p.el.hidden = hid;
  }
  siteEl.hidden = sh;
  const tallest = Math.max(...heights.values());
  const topOff = short ? 0 : Math.max(0, Math.floor((room - tallest) / 2));
  for (const p of pages) if (!p.el.hidden) place(p.el, c0, top + Math.max(0, Math.min(topOff, room - heights.get(p))), span, heights.get(p)); // (never into the footer)

  // The title window sits where the cards sit (same top, same width) and is as tall as the
  // tallest, so entering the site turns one window into the next in place.
  {
    const hid = introEl.hidden;
    introEl.hidden = false;
    const h = Math.min(room, Math.max(measure(introEl, span) + 2, tallest));
    introEl.hidden = hid;
    place(introEl, c0, top + Math.max(0, Math.min(topOff, room - h)), span, h);
  }
}

/**
 * Fit a card without ever scrolling. If it fits in `cap` rows it stays whole; otherwise it is
 * split into numbered parts that flip like pages, balanced so they are about equally full. A
 * piece too tall for a part on its own may use the whole `room`; only if it still doesn't fit
 * is the text set a step smaller (and the card split again).
 */
function fitCard(pg, fits, cap, room, phone) {
  const inner = $('.w-fit', pg.el);
  const base = phone ? 0.92 : 1; // phones: slightly smaller sections, more board
  const keepUnit = pg.parts?.[pg.part]?.[0]; // stay on what was being read
  // Greedy split at a height limit: each part as full as it can be.
  const split = (limit) => {
    pg.splitting = true; // measured with room for the part controls
    const parts = [[]];
    for (const u of pg.units) {
      const cur = parts[parts.length - 1];
      pg.parts = [...parts.slice(0, -1), [...cur, u]];
      pg.part = parts.length - 1;
      showPart(pg);
      if (cur.length && !fits(limit)) parts.push([u]);
      else cur.push(u);
    }
    pg.splitting = false;
    return parts;
  };
  const allFit = (parts) => {
    pg.parts = parts;
    for (let k = 0; k < parts.length; k++) {
      pg.part = k;
      showPart(pg);
      if (!fits(room)) return false;
    }
    return true;
  };
  let done = false;
  for (const z of [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6]) {
    inner.style.zoom = String(base * z);
    pg.parts = [pg.units];
    pg.part = 0;
    showPart(pg);
    if (fits(cap)) {
      done = true;
      break;
    }
    let parts = split(cap);
    if (!allFit(parts)) continue;
    // The card ends up as tall as its tallest part (a lone tall piece may exceed the cap):
    // split again at that height, which can only fill the parts better.
    let H = cap;
    for (let k = 0; k < parts.length; k++) {
      pg.parts = parts;
      pg.part = k;
      showPart(pg);
      while (H < room && !fits(H)) H++;
    }
    if (H > cap) {
      const q = split(H);
      if (q.length <= parts.length && allFit(q)) parts = q;
    }
    // Balance: the lowest limit that still needs no more parts spreads the pieces evenly
    // (never lower than the height one lone piece already forces).
    let lo = 3;
    let hi = H;
    let best = parts;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const p = split(mid);
      // (Never leave the first part sparser than the plain split did: it also carries the title.)
      if (p.length <= parts.length && allFit(p) && p[0].length >= Math.min(2, parts[0].length)) {
        best = p;
        hi = mid;
      } else lo = mid + 1;
    }
    pg.parts = best;
    done = true;
    break;
  }
  if (!done) pg.parts = split(cap); // (nothing fits even small: keep the last split)
  pg.part = Math.max(0, pg.parts.findIndex((p) => p.includes(keepUnit)));
  // One size per card: every part is as tall as the tallest, so flipping through the parts of
  // a page never resizes it.
  let tallest = 1;
  pg.rows = (rowsFor, span) => {
    if (pg.heightKey !== pg.fitKey) {
      const keep = pg.part;
      tallest = 1;
      for (let k = 0; k < pg.parts.length; k++) {
        pg.part = k;
        showPart(pg);
        tallest = Math.max(tallest, Math.min(room, rowsFor(pg.el, span)));
      }
      pg.part = keep;
      showPart(pg);
      pg.heightKey = pg.fitKey;
    }
    return tallest;
  };
  pg.heightKey = null;
  showPart(pg);
}

// ---------------------------------------------------------------------------
// Snapshots: a section rendered to an image (with the site's own CSS and fonts), so it can be
// cut into one slice per switch and flipped.

let morphToken = 0;
let goingTo = null; // where a running transition is heading
let pendingApply = null; // a transition's switch to its next screen, until it has happened

const toDataUrl = (blob) =>
  new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
const cssCache = new Map();
/** The stylesheet with the fonts it needs inlined (only the mono and the chosen display face). */
function inlinedCss() {
  const font = look.font;
  if (!cssCache.has(font)) {
    const keep = { grotesk: 'space-grotesk', inter: 'inter-tight', chakra: 'chakra-petch' }[font];
    const p = (async () => {
      let css = await (await fetch('css/style.css')).text();
      css = css.replace(/@font-face\s*{[^}]*}/g, (block) => (/ibm-plex-mono/.test(block) || block.includes(keep) ? block : ''));
      const urls = [...new Set([...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((m) => m[1]))];
      for (const u of urls) {
        const data = await toDataUrl(await (await fetch(new URL(u, new URL('css/', location.href)))).blob());
        css = css.split(u).join(data);
      }
      // It goes inside XML, so escape what XML would choke on (an '&' in a comment is enough).
      return css.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    })().catch((e) => {
      cssCache.delete(font);
      throw e;
    });
    cssCache.set(font, p);
  }
  return cssCache.get(font);
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Rendered sections are reused: they only change with their size and place, the look, the theme
// and what they say (the header's current page, the footer's labels).
const shotCache = new Map();
function shotKey(el) {
  const r = el.getBoundingClientRect();
  const extra =
    el === headerEl()
      ? nav.find((n) => n.el.hasAttribute('aria-current'))?.id + themeToggle.getAttribute('aria-checked')
      : el === footerEl()
        ? el.textContent
        : el === introEl
          ? $('#intro-theme').getAttribute('aria-checked')
          : el.dataset.part || '';
  const accent = document.documentElement.style.getPropertyValue('--accent');
  // (The header and title carry the ASCII button, which looks pressed while on.)
  const tools = el === headerEl() || el === introEl ? `${S.ascii ? 'A' : ''}` : '';
  return [el.id || el.tagName, extra, tools, accent, S.dark, look.palette, look.chrome, look.font, document.documentElement.dataset.card + ('console' in document.documentElement.dataset ? '+c' : ''), board.dpr, r.left, r.top, r.width, r.height].join('|');
}
function snapshot(el) {
  const key = shotKey(el);
  let shot = shotCache.get(key);
  if (!shot) {
    shot = renderSnapshot(el);
    shotCache.set(key, shot);
    shot.then((x) => x || shotCache.delete(key));
    if (shotCache.size > 64) shotCache.delete(shotCache.keys().next().value);
  }
  return shot;
}

/**
 * Render a laid-out box to a canvas at device resolution (null if the browser can't).
 * The copy of the element is taken synchronously, so callers may change the page straight after.
 */
function renderSnapshot(el) {
  try {
    const rect = el.getBoundingClientRect();
    const w = Math.ceil(rect.width);
    const h = Math.ceil(rect.height);
    const clone = el.cloneNode(true);
    clone.removeAttribute('hidden');
    // Freeze every element's computed sizes: inside the snapshot, viewport units would
    // otherwise resolve against the image rather than the window.
    const KEEP = ['fontSize', 'lineHeight', 'letterSpacing', 'fontWeight', 'fontFamily', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'rowGap', 'columnGap', 'gridTemplateColumns', 'color', 'textTransform', 'textDecorationLine', 'textDecorationColor', 'textDecorationThickness', 'textUnderlineOffset'];
    const src = [el, ...el.querySelectorAll('*')];
    const dst = [clone, ...clone.querySelectorAll('*')];
    src.forEach((node, k) => {
      const cs = getComputedStyle(node);
      for (const prop of KEEP) dst[k].style[prop] = cs[prop];
    });
    clone.style.cssText = el.style.cssText + ';left:0;top:0;opacity:1;visibility:visible;transition:none;';
    // Keep the knob of the theme switch where it is now.
    for (const k of clone.querySelectorAll('.tt-knob, .tt-knob svg')) k.style.transition = 'none';
    const html = new XMLSerializer().serializeToString(clone);
    // Wrap the copy exactly as the original sits in the page, so the same CSS rules match it.
    const inner =
      el === introEl
        ? html
        : el.matches('section')
          ? `<div id="site" style="position:relative;inset:auto"><main>${html}</main></div>`
          : `<div id="site" style="position:relative;inset:auto">${html}</div>`;
    const root = document.documentElement;
    const attrs = `data-font="${look.font}" data-chrome="${look.chrome}" data-theme="${root.dataset.theme}" data-vp="${root.dataset.vp || ''}" data-card="${root.dataset.card}"${'console' in root.dataset ? ' data-console=""' : ''}`;
    const vars = esc(root.style.cssText);
    const dpr = board.dpr;
    return (async () => {
      const css = await inlinedCss();
      const doc = `<div xmlns="http://www.w3.org/1999/xhtml" class="js board" ${attrs} style="${vars};position:relative;width:${w}px;height:${h}px;overflow:hidden;background:transparent">
      <style>${css}</style>
      <div id="source" style="position:relative;inset:auto;width:${w}px;height:${h}px;overflow:visible">${inner}</div></div>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${doc}</foreignObject></svg>`;
      // A data: URL, not a blob: one, so the canvas isn't tainted and its pixels can be read.
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.drawImage(img, 0, 0, w, h);
      return { canvas: c, rect };
    })().catch((err) => {
      console.warn('Snapshot failed', err);
      return null;
    });
  } catch (err) {
    console.warn('Snapshot failed', err);
    return Promise.resolve(null);
  }
}

/** Faces showing a snapshot cut into one slice per switch (each blending as the card's surface). */
function slicesOf(shot, bgHex) {
  if (!shot) return new Map();
  shot.slices ||= new Map();
  if (shot.slices.has(bgHex)) return shot.slices.get(bgHex);
  const out = new Map();
  shot.slices.set(bgHex, out);
  const { rect } = shot;
  const a = board.cellAt(rect.left + 1, rect.top + 1);
  const b = board.cellAt(rect.right - 2, rect.bottom - 2);
  if (a < 0 || b < 0) return out;
  const src = imageSource(shot.canvas);
  const c0 = a % board.cols;
  const r0 = (a / board.cols) | 0;
  const nc = (b % board.cols) - c0 + 1;
  const nr = ((b / board.cols) | 0) - r0 + 1;
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const f = slice(src, c * board.cw, r * board.ch, bgHex);
      f.avg = bgHex; // blends lean on the card's surface, not its ink (no grey tiles)
      out.set((r0 + r) * board.cols + c0 + c, f);
    }
  }
  return out;
}

const cardBg = (el) => {
  const m = getComputedStyle(el).backgroundColor.match(/\d+/g) || [0, 0, 0];
  return rgbHex(+m[0], +m[1], +m[2]);
};

/**
 * While the site is idle, render every box a transition could need (each page's card, the
 * header and footer as they look on each page, the title), so transitions start at once.
 */
let prefetchTimer = 0;
function schedulePrefetch() {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => (window.requestIdleCallback || setTimeout)(prefetchShots), 350);
}
let prefetchedFor = '';
async function prefetchShots() {
  const busy = () => S.overlay || S.brush || goingTo || brushBoxes.size;
  if (busy()) return;
  // (Nothing that goes into the pictures has changed since the last full run: all are cached.
  // Each job re-lays the page out just to look its pictures up, so don't.)
  const pg0 = pages[pageIndex(S.key)];
  const sig = [S.key, pg0?.part, S.dark, S.ascii, S.size, look.palette, ...pages.map((p) => comboOf(p.id)), comboOf('intro')].join('|');
  if (sig === prefetchedFor) return;
  // Briefly lay a hidden box out (invisibly), copy it, and put everything back — all synchronous.
  const withShown = (el, fn) => {
    const state = [el.hidden, siteEl.hidden, headerEl().style.visibility, footerEl().style.visibility];
    el.hidden = false;
    el.style.visibility = 'hidden';
    if (el !== introEl && siteEl.hidden) {
      siteEl.hidden = false;
      headerEl().style.visibility = 'hidden';
      footerEl().style.visibility = 'hidden';
    }
    layoutWebBoxes();
    const shot = fn();
    [el.hidden, siteEl.hidden] = state;
    el.style.visibility = '';
    headerEl().style.visibility = state[2];
    footerEl().style.visibility = state[3];
    layoutWebBoxes();
    return shot;
  };
  // Copy boxes in the colours of the page they will be seen on (the copy is taken synchronously).
  const inColours = (id, fn) => {
    applyColours(id);
    try {
      return fn();
    } finally {
      applyColours();
    }
  };
  // The header and footer as they look on page `id`.
  const asOn = (id, el) => {
    const cur = nav.find((x) => x.el.hasAttribute('aria-current'));
    cur?.el.removeAttribute('aria-current');
    nav.find((x) => x.id === id)?.el.setAttribute('aria-current', 'page');
    setFooterLabels(id);
    const shot = inColours(id, () => withShown(el, () => snapshot(el)));
    nav.find((x) => x.id === id)?.el.removeAttribute('aria-current');
    cur?.el.setAttribute('aria-current', 'page');
    if (S.key !== 'intro') setFooterLabels(S.key);
    return shot;
  };
  const jobs = [() => visibleBoxes().map((el) => snapshot(el))];
  // The visible card's other parts, so flipping through them starts at once.
  jobs.push(() => {
    const pg = pages[pageIndex(S.key)];
    if (!pg || pg.parts.length < 2) return null;
    const keep = pg.part;
    const shots = [];
    for (let k = 0; k < pg.parts.length; k++) {
      if (k === keep) continue;
      pg.part = k;
      showPart(pg);
      layoutWebBoxes(); // each part has its own height
      shots.push(snapshot(pg.el));
    }
    pg.part = keep;
    showPart(pg);
    layoutWebBoxes();
    return shots;
  });
  // The visible card (or title) in the other theme, so the theme switch starts at once too.
  jobs.push(() => {
    const root = document.documentElement;
    S.dark = !S.dark;
    root.dataset.theme = S.dark ? 'dark' : 'light';
    applyColours();
    try {
      return visibleBoxes()
        .filter((el) => el !== headerEl() && el !== footerEl())
        .map((el) => snapshot(el));
    } finally {
      S.dark = !S.dark;
      root.dataset.theme = S.dark ? 'dark' : 'light';
      applyColours();
    }
  });
  for (const pg of pages) jobs.push(() => (pg.el.hidden ? inColours(pg.id, () => withShown(pg.el, () => snapshot(pg.el))) : null));
  for (const pg of pages) jobs.push(() => [asOn(pg.id, headerEl()), asOn(pg.id, footerEl())]);
  jobs.push(() => (introEl.hidden ? inColours('intro', () => withShown(introEl, () => snapshot(introEl))) : null));
  // One job per idle moment: a job whose pictures are all cached finishes without ever waiting,
  // and a run of them in one go is a long task just as a wave settles (or a click arrives).
  const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 1000 }) : setTimeout(r, 16)));
  for (const job of jobs) {
    await idle();
    if (busy()) return;
    await Promise.all([].concat(job()));
  }
  if (!busy()) prefetchedFor = sig;
}

const visibleBoxes = () => (S.key === 'intro' ? [introEl] : [headerEl(), morphBox(), footerEl()]).filter((el) => el && !el.closest('[hidden]'));

// ---------------------------------------------------------------------------
// Motion: where and when a transition reaches each point of the screen

/**
 * The shape of a transition, as a field of times: `tau(x, y)` is how many ms after it starts
 * the wave reaches CSS-pixel point (x, y). `edge()` draws that front as a CSS gradient, so the
 * card's shadow and the header/footer colours can follow the switches exactly.
 *   sweep   diagonally across the board, in the direction of travel
 *   ripple  outwards from what was clicked
 *   cascade down the board, row by row
 */
// Every wave (page, part or theme) crosses the whole screen in the same time, whatever the
// screen's size, and every switch in it flips at the same pace: one blend step, then the flip.
const WAVE_MS = 1000;
// How long before a switch falls its edges fade in (and the background's sweep is timed to it).
// Short, so a click is answered at once; the wave's own pace is set by WAVE_MS.
const PAGE_AHEAD = 55;
const THEME_AHEAD = 40;
const FLIP_STEP = 110;
const FLIP_DUR = 200;

function motionField(kind, dir = 1, origin = null) {
  const dpr = board.dpr;
  const colOf = (x) => (x * dpr - board.ox) / board.cw;
  const rowOf = (y) => (y * dpr - board.oy) / board.ch;
  const flip = (col) => (dir > 0 ? col : board.cols - 1 - col);
  if (kind === 'ripple') {
    const o = origin || { x: board.cssW / 2, y: board.cssH / 2 };
    const far = Math.max(...[[0, 0], [board.cssW, 0], [0, board.cssH], [board.cssW, board.cssH]].map(([x, y]) => Math.hypot(x - o.x, y - o.y))) || 1;
    const speed = far / WAVE_MS; // px per ms
    return {
      tau: (x, y) => Math.hypot(x - o.x, y - o.y) / speed,
      edge(rect, front, inner, outer, soft) {
        const R = front * speed;
        return `radial-gradient(circle at ${o.x - rect.left}px ${o.y - rect.top}px, ${inner} ${Math.max(0, R - soft)}px, ${outer} ${Math.max(0.5, R)}px)`;
      },
    };
  }
  // The shape (ms per column : ms per row), scaled so the far corner is reached in WAVE_MS.
  const [ax, ay] = kind === 'cascade' ? [1.2, 26] : [6, 9];
  const k = WAVE_MS / Math.max(1, ax * (board.cols - 1) + ay * (board.fullRows - 1));
  const [kx, ky] = [ax * k, ay * k];
  const tau = (x, y) => kx * flip(colOf(x)) + ky * rowOf(y);
  const gx = ((kx * dpr) / board.cw) * (dir > 0 ? 1 : -1);
  const gy = (ky * dpr) / board.ch;
  const gl = Math.hypot(gx, gy);
  const [ux, uy] = [gx / gl, gy / gl];
  const angle = (Math.atan2(ux, -uy) * 180) / Math.PI;
  return {
    tau,
    edge(rect, front, inner, outer, soft) {
      const len = Math.abs(rect.width * ux) + Math.abs(rect.height * uy);
      const sF = (front - tau(rect.left + rect.width / 2, rect.top + rect.height / 2)) / gl + len / 2;
      return `linear-gradient(${angle}deg, ${inner} ${sF - soft}px, ${outer} ${sF}px)`;
    },
  };
}

const cellCentre = (i) => [
  (board.ox + (i % board.cols) * board.cw + board.cw / 2) / board.dpr,
  (board.oy + ((i / board.cols) | 0) * board.ch + board.ch / 2) / board.dpr,
];

// ---------------------------------------------------------------------------
// Card shadow: two layers, so the old card's shadow can leave and the new one arrive with the
// wave (a moving mask whose edge is the wave's front) instead of popping.

const PAD = 60;
const shadows = [0, 1].map(() => {
  const d = document.createElement('div');
  d.className = 'card-shadow';
  d.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(d, source); // below the page content
  return d;
});
let shadowCur = 0;
let shadowRun = 0;
const hasShadow = (box) => box && !box.hidden;
const setMask = (el, m) => {
  el.style.maskImage = m;
  el.style.webkitMaskImage = m;
};
function setShadowRect(layer, box) {
  const r = box.getBoundingClientRect();
  // (Kept, so a wave's frames needn't ask the page where the layer is: that would make each frame
  // wait for the page's styles, all of which change at once with the theme.)
  layer.rect = { left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
  Object.assign(layer.style, { left: layer.rect.left + 'px', top: layer.rect.top + 'px', width: layer.rect.width + 'px', height: layer.rect.height + 'px' });
}
/** The shadow at rest: under the visible card, or none. */
function placeShadow(box) {
  shadowRun++;
  for (const d of shadows) {
    setMask(d, '');
    d.style.opacity = '0';
  }
  if (!hasShadow(box)) return;
  setShadowRect(shadows[shadowCur], box);
  shadows[shadowCur].style.opacity = '1';
}
/** Hand the shadow from `oldBox` to `newBox` along the wave: hidden as the front passes, shown as switches land. */
function shadowWave(field, oldBox, newBox, hideLag, showLag, span) {
  const run = ++shadowRun;
  const oldL = shadows[shadowCur];
  const newL = shadows[1 - shadowCur];
  shadowCur = 1 - shadowCur;
  const oldOn = oldL.style.opacity === '1' && hasShadow(oldBox);
  if (!oldOn) oldL.style.opacity = '0';
  newL.style.opacity = '0';
  if (hasShadow(newBox)) {
    setShadowRect(newL, newBox);
    newL.style.opacity = '1';
  }
  const soft = 80;
  const t0 = performance.now();
  const frame = (now) => {
    if (run !== shadowRun) return;
    const t = now - t0;
    if (oldOn) setMask(oldL, field.edge(oldL.rect || oldL.getBoundingClientRect(), t - hideLag, 'transparent', '#000', -soft));
    if (hasShadow(newBox)) setMask(newL, field.edge(newL.rect || newL.getBoundingClientRect(), t - showLag, '#000', 'transparent', soft));
    if (t - showLag > span + 200) {
      oldL.style.opacity = '0';
      setMask(oldL, '');
      setMask(newL, '');
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/**
 * Sections that change continuously with a wave rather than as switches (the header and footer):
 * copies of them as they were sit on top, and the wave's front wipes them away.
 */
const themeVeil = document.createElement('div');
themeVeil.id = 'theme-veil';
themeVeil.setAttribute('aria-hidden', 'true');
document.body.append(themeVeil);
let veilRun = 0;
function clearThemeVeil() {
  veilRun++;
  themeVeil.replaceChildren();
}
/** Old copies of the bars over the live ones; `hole` (an element) is left showing through. */
function veilUp(shots, hole = null) {
  clearThemeVeil();
  for (const c of veilCanvases(shots, hole)) themeVeil.append(c);
}

/**
 * A transition turned round while the bars are still part-way through changing: the copy
 * that is up stays exactly as it looks now (frozen where its wipe had got to), and a copy of
 * the live bars as they are this moment goes underneath it. Both then wipe with the new front,
 * so nothing on the bars jumps.
 */
function veilRedirect(shots, hole = null) {
  if (!themeVeil.children.length) return veilUp(shots, hole);
  veilRun++; // the old wipe stops where it is
  for (const c of themeVeil.children) {
    const m = c.style.maskImage;
    if (m && m !== 'none') c.frozen = c.frozen ? `${c.frozen}, ${m}` : m;
  }
  themeVeil.prepend(...veilCanvases(shots, hole));
}

function veilCanvases(shots, hole) {
  const h = hole?.getBoundingClientRect();
  const out = [];
  for (const shot of shots) {
    if (!shot) continue;
    const c = shot.canvas.cloneNode(false);
    const g = c.getContext('2d');
    g.drawImage(shot.canvas, 0, 0);
    if (h) {
      // Exactly the switch's own pill, so the live switch shows through without a ring of bar.
      const d = c.width / shot.rect.width;
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.roundRect((h.left - shot.rect.left) * d, (h.top - shot.rect.top) * d, h.width * d, h.height * d, (h.height / 2) * d);
      g.fill();
    }
    Object.assign(c.style, { left: shot.rect.left + 'px', top: shot.rect.top + 'px', width: shot.rect.width + 'px', height: shot.rect.height + 'px' });
    c.rect = shot.rect; // (where it is, without asking the page each frame)
    out.push(c);
  }
  return out;
}
/** A veil copy's mask: the wipe, intersected with where an earlier wipe had frozen it. */
function setVeilMask(c, m) {
  const all = c.frozen ? `${c.frozen}, ${m}` : m;
  c.style.maskImage = all;
  c.style.webkitMaskImage = all;
  if (c.frozen) {
    c.style.maskComposite = 'intersect';
    c.style.webkitMaskComposite = 'source-in';
  }
}
function veilWipe(field, lag, span) {
  if (!themeVeil.children.length) return;
  const run = ++veilRun;
  const t0 = performance.now();
  const frame = (now) => {
    if (run !== veilRun) return;
    const t = now - t0 - lag;
    for (const c of themeVeil.children) setVeilMask(c, field.edge(c.rect || c.getBoundingClientRect(), t, 'transparent', '#000', 110));
    if (t > span + 300) return clearThemeVeil();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Transitions between screens

/**
 * The boxes that turn into switches on the `key` side of a transition to/from `other`: the card
 * always; the header and footer too when they appear or disappear (the title screen).
 */
function waveBoxes(key, other) {
  if (key === 'intro') return [introEl];
  return (other === 'intro' || other === null ? [headerEl(), morphBox(), footerEl()] : [morphBox()]).filter(Boolean);
}

/** Show boxes as bare switches of themselves (skipping any already on the board), then hide them. */
async function boxesToSwitches(boxes, keep = null) {
  const live = boxes.filter((el) => el.style.opacity !== '0' && !el.closest('[hidden]'));
  const shots = await Promise.all(live.map((el) => snapshot(el)));
  // Can't snapshot here, or the transition was cut short meanwhile: the caller swaps instead.
  if (shots.some((x) => !x) || !S.overlay) return null;
  if (keep) live.forEach((el, k) => keep.set(el, shots[k]));
  const added = [];
  shots.forEach((shot, k) => {
    for (const [i, f] of slicesOf(shot, cardBg(live[k]))) {
      S.overlay.set(i, f);
      added.push(i);
    }
  });
  board.hold(); // (each switch drawn once, face and edges together)
  try {
    retarget(added, null, () => true);
    for (const i of added) board.setEdges(i, 0);
  } finally {
    board.release();
  }
  for (const el of live) el.style.opacity = '0';
  return added;
}

/**
 * Move to another screen. The changing sections become switches (seamlessly — each shows its
 * exact piece of the section); a wave then flips every switch across, through one soft blended
 * step, to its piece of the next section or to the new page's background; each switch's edges
 * are fully in as it flips and fade as it lands; and the sections are web sections again.
 * The header and footer colours and the card's shadow follow the same front.
 * A second navigation mid-wave simply redirects it from wherever the switches are.
 */
/** Run a transition; if anything in it fails, the page still ends up showing, just without the wave. */
const safely = (run) =>
  async function (...args) {
    const running = run.apply(this, args);
    const token = morphToken; // (each run takes a new token before its first wait)
    try {
      return await running;
    } catch (err) {
      console.error('Transition failed', err);
      if (token !== morphToken) return; // (a newer transition has taken over: it finishes)
      pendingApply?.();
      if (themeWanted()) {
        applyTheme(S.wantDark);
        syncDom();
      }
      finishWeb();
    }
  };

const webGo = safely(async function webGo(go, { dir = 1, toKey = null, fromNothing = false, origin = null } = {}) {
  const token = ++morphToken;
  const fromKey = S.key;
  // Until the next screen is applied, a cancel (theme switch, resize) applies it straight away.
  const apply = () => {
    if (pendingApply === apply) pendingApply = null;
    go();
  };
  pendingApply = apply;
  // Flipping to another part of the same card leaves the header and footer alone.
  const samePage = fromKey === toKey;
  const barsSweep = fromKey !== 'intro' && toKey !== 'intro' && !fromNothing && !samePage;
  // Bars that change colour in place keep any part-wiped copy (see veilRedirect). Bars that
  // join the wave as switches keep it too, frozen, and it is wiped away by this wave's front.
  const freezeVeil = !barsSweep && !samePage && themeVeil.children.length > 0;
  if (freezeVeil) veilRedirect([]);
  restoreBrushBoxes(true); // brushed sections back to normal before they join the wave
  if (reduce.matches) {
    apply();
    return finishWeb();
  }
  if (!S.overlay) {
    resetEdges();
    S.overlay = new Map();
  }
  const before = new Set(S.overlay.keys());
  const oldCard = fromNothing ? null : morphBox();
  const oldRect = oldCard?.getBoundingClientRect();
  if (!fromNothing) {
    const [added, ...bars] = await Promise.all([
      boxesToSwitches(waveBoxes(fromKey, toKey)),
      ...(barsSweep ? [headerEl(), footerEl()].map((el) => snapshot(el)) : []),
    ]);
    if (token !== morphToken) return;
    if (barsSweep) veilRedirect(bars); // the header and footer as they were, until the wave passes
    if (!added) {
      apply();
      return finishWeb();
    }
    for (const i of added) before.add(i);
  }
  // Lay out the next screen invisibly and slice its changing boxes. Its colours sweep across
  // the background from this moment (see startSweep), in step with the switches' wave.
  const sweepFrom = scheme();
  const gapFrom = board.gapColor;
  const fromFrame = S.frame;
  apply();
  if (!samePage) startSweep(sweepFrom, motionField(look.motion, dir, origin), PAGE_AHEAD - SWEEP_BAND / 2, gapFrom, fromFrame); // (half-way through its blend as the cards flip)
  const boxes = waveBoxes(S.key, fromNothing ? null : fromKey);
  for (const el of boxes) el.style.opacity = '0';
  layoutWeb();
  const shots = await Promise.all(boxes.map((el) => snapshot(el)));
  if (token !== morphToken) return;
  if (shots.some((x) => !x)) return finishWeb();
  S.overlay = new Map();
  shots.forEach((shot, k) => {
    for (const [i, f] of slicesOf(shot, cardBg(boxes[k]))) S.overlay.set(i, f);
  });

  const field = motionField(look.motion, dir, origin);
  const ahead = PAGE_AHEAD; // edges fade in over this long, reaching full strength as the switch flips
  const STEP = FLIP_STEP;
  const DUR = FLIP_DUR;
  let span = 0;
  retarget(
    allCells(),
    (i, to) => {
      const delay = ahead + field.tau(...cellCentre(i)) + rand() * 25;
      // One soft step between what the switch shows now and where it is going, blended in OKLab
      // and leaning towards the new colours (so a card's switches stay close to the card's
      // colours, and the board's pass through colours that belong to the new page).
      const from = board.cells[i].cur;
      const a = faceColour(from);
      const b = faceColour(to);
      const steps = a && b && a !== b ? [solid(mixLch(a, b, 0.62))] : null;
      span = Math.max(span, delay);
      return { delay, dur: DUR, steps, stepDur: STEP, gap: board.gapColor, edgesIn: ahead, edgesOut: S.overlay.has(i) ? 170 : 0 };
    },
    (i) => S.overlay.has(i) || before.has(i),
  );
  // Shadow and bars: the old shadow goes as the front arrives, the new one comes as switches land.
  const land = ahead + 30 + STEP + DUR;
  // (A card that stays where it is, flipping to another part or style, keeps its shadow as it is.)
  const newCard = morphBox();
  const r = newCard?.getBoundingClientRect();
  const still = samePage && oldRect && r && ['left', 'top', 'width', 'height'].every((k) => Math.abs(oldRect[k] - r[k]) < 1);
  if (!still) shadowWave(field, oldCard, newCard, ahead, land + 90, span);
  if (barsSweep || freezeVeil) veilWipe(field, ahead + 30 + STEP + DUR / 2, span);
  await wait(Math.min(span + land + 220, 3200));
  if (token !== morphToken) return;
  finishWeb();
});

/** End (or cut short) a transition: real sections visible, the board back to plain background. */
function finishWeb() {
  goingTo = null;
  clearThemeVeil();
  for (const el of [introEl, headerEl(), footerEl(), ...pages.map((p) => p.el)]) el.style.opacity = '';
  S.overlay = null;
  layoutWeb();
  // (Only switches whose edges, gutter or face change are redrawn, each once: a whole board of
  // small switches is too much to redraw in one frame.)
  board.hold();
  try {
    resetEdges();
    // Every switch settles at once (nothing left half-flipped), in this theme's gutter (unless a
    // sweep is still crossing the board: it hands the gutters over as it goes).
    if (!S.sweep) board.settleGaps();
    // Only switches still showing (or on their way to) a piece of a card are settled at once;
    // background switches already drifting again are left to finish their flips.
    const onCard = (i) => {
      const c = board.cells[i];
      return c.cur?.t === 'slice' || c.anim?.to?.t === 'slice' || c.q.some((n) => n.f?.t === 'slice');
    };
    retarget(allCells(), null, onCard);
  } finally {
    board.release();
  }
  if (!reduce.matches) paintStep(performance.now()); // the background drift carries straight on
  schedulePrefetch();
}

/** Abandon a transition at once (theme switch, resize). */
function cancelWeb({ keepTheme = false } = {}) {
  morphToken++;
  clearThemeVeil();
  restoreBrushBoxes(true);
  if (pendingApply) pendingApply(); // a navigation still being prepared goes through
  if (!keepTheme && themeWanted()) {
    applyTheme(S.wantDark); // so does a theme switch that hadn't taken effect yet
    syncDom();
  }
  if (S.overlay || goingTo) finishWeb();
}

function go(key, { dir = 1, push = true, origin = null } = {}) {
  if (S.player) stopBadApple(); // (Back or Forward while Bad Apple plays: it stops first)
  if (!key || key === (goingTo ?? S.key) || !board.cells.length) return;
  const from = S.key;
  dropBrush();
  goingTo = key;
  if (push) history.pushState(null, '', key === 'intro' ? location.pathname + location.search : '#' + key);
  webGo(
    () => {
      S.key = key;
      retintGutter(); // each page's gutters take its colour, changing with the wave
      const pg = pages[pageIndex(key)];
      if (pg?.part) {
        pg.part = 0; // a page opens at its first part
        showPart(pg);
      }
      if (themeWanted()) applyTheme(S.wantDark); // a theme switch cut short rides this wave
      syncDom();
      S.frame = paint.frame(S.pt, scheme());
      keepFocus(from);
    },
    { dir, toKey: key, origin },
  );
}

/** Keep keyboard focus somewhere sensible once a new screen is showing. */
function keepFocus(from) {
  const a = document.activeElement;
  if (a && a !== document.body && !a.closest('[hidden]') && a !== $('#enter')) return;
  const h = S.key === 'intro' ? $('h1', introEl) : $('h2', pages[pageIndex(S.key)].el);
  if (S.key === from || !h) return;
  h.tabIndex = -1;
  h.focus({ preventScroll: true });
}

const enter = (origin = null) => go('about', { origin });

/** Flip the visible card to its next (+1) or previous (-1) part, in the same wave as a page. */
function goPart(delta, origin = null) {
  if (S.key === 'intro' || goingTo) return;
  const pg = pages[pageIndex(S.key)];
  const to = Math.min(pg.parts.length - 1, Math.max(0, pg.part + delta));
  if (to === pg.part || pendingApply) return;
  webGo(
    () => {
      pg.part = to;
      showPart(pg);
      if (themeWanted()) {
        applyTheme(S.wantDark);
        syncDom();
      }
    },
    { dir: delta, toKey: S.key, origin },
  );
}
function step(delta, origin = null) {
  if (S.key === 'intro') return;
  const n = pages.length;
  go(pages[(pageIndex(goingTo ?? S.key) + delta + n) % n].id, { dir: delta, origin });
}
const centreOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

// ---------------------------------------------------------------------------
// Light ↔ dark

/** A theme switch has been asked for that hasn't taken effect yet. */
const themeWanted = () => S.wantDark != null && S.wantDark !== S.dark;

/** The board's gutter colour for the current page and theme; switches keep theirs until a wave reaches them. */
function retintGutter() {
  const old = board.gapColor;
  board.gapColor = boardGutter();
  shadeBoard();
  if (old !== board.gapColor) for (const c of board.cells) c.gap = c.gap || old;
}

/** The gutter between switches (in ASCII mode, near-black with a hint of the page's colour). */
function boardGutter() {
  return S.ascii ? oklchHex(S.dark ? 0.1 : 0.13, 0.02, boardHue(S.key, look)) : gutter(S.dark, look, S.key);
}

/** The flip's shading takes a deep tint of the page's colour (pure black muddies pastels). */
function shadeBoard() {
  const hue = boardHue(S.key, look);
  board.setShade(S.dark ? oklchHex(0.16, 0.05, hue) : oklchHex(0.38, 0.09, hue), S.dark ? 1 : 0.6);
}

/** Take on a theme (the switches follow in whatever wave is running). */
function applyTheme(dark) {
  const oldGap = board.gapColor;
  S.dark = dark;
  try {
    localStorage.setItem('theme', S.dark ? 'dark' : 'light');
  } catch {}
  applyLook();
  // Every switch keeps its old gutter until the wave reaches it.
  for (const c of board.cells) c.gap = c.gap || oldGap;
  board.gapColor = boardGutter();
  shadeBoard();
  S.frame = paint.frame(S.pt, scheme());
}

/** Every click counts: a click mid-ripple turns it round from wherever the switches are. */
function toggleTheme(e) {
  const from = e?.currentTarget || liveSwitch();
  S.wantDark = !(S.wantDark ?? S.dark);
  // Copy the bars as they are (usually already cached), before the switch moves: the copy
  // covers the old bars until the ripple passes, with a hole where the live switch shows.
  // (A bar the brush has turned into switches comes back first, so it gets its copy too.)
  restoreBrushBoxes(true);
  const bars = [headerEl(), footerEl()].filter((el) => !el.closest('[hidden]') && el.style.opacity !== '0');
  const barShots = reduce.matches ? null : bars.map((el) => snapshot(el));
  // The switch answers at once; the page follows in the ripple.
  for (const t of themeSwitches()) t.setAttribute('aria-checked', String(S.wantDark));
  switchTheme(S.wantDark, barShots, from);
}

/**
 * The board ripples out from the switch, every switch taking the new theme's gutter and colours.
 * The page card joins as switches, each flipping from its light piece to its dark piece through
 * one half-way blend; the header and footer change continuously with the front.
 */
const switchTheme = safely(async function switchTheme(dark, preShots = null, from = liveSwitch()) {
  const origin = centreOf(from);
  const motion = !reduce.matches;
  // A wave or ripple already moving is turned round from wherever its switches are; only a
  // navigation still being prepared is cut short (it goes through at once).
  // A navigation (or part flip) still being set up: the theme rides its wave (see its apply()).
  if (pendingApply) return;
  const rippling = !!S.overlay;
  if (rippling) morphToken++;
  else cancelWeb({ keepTheme: true });
  if (dark === S.dark && !rippling) return; // asked for and back again before anything changed
  const token = ++morphToken;
  let before = new Set();
  const oldShots = new Map();
  // The card (or title) flips; bars still arriving as switches flip too, and bars that are
  // showing change colour under the wipe.
  const isBar = (el) => el === headerEl() || el === footerEl();
  const flipBoxes = () => visibleBoxes().filter((el) => !isBar(el) || el.style.opacity === '0');
  if (motion) {
    if (!S.overlay) {
      resetEdges();
      S.overlay = new Map();
    }
    before = new Set(S.overlay.keys());
    const bars = [headerEl(), footerEl()].filter((el) => !el.closest('[hidden]') && el.style.opacity !== '0');
    const barShots = await Promise.all(preShots || bars.map((el) => snapshot(el)));
    if (token !== morphToken) return;
    veilRedirect(barShots, from);
    const added = await boxesToSwitches(flipBoxes(), oldShots);
    if (token !== morphToken) return;
    if (added) for (const i of added) before.add(i);
    else S.overlay = null;
  }
  if (dark === S.dark) return finishWeb();
  const sweepFrom = scheme();
  const gapFrom = board.gapColor;
  const fromFrame = S.frame;
  applyTheme(dark);
  startSweep(sweepFrom, motionField('ripple', 1, origin), THEME_AHEAD - SWEEP_BAND / 2, gapFrom, fromFrame); // the background ripples into the new theme
  syncDom();

  const BLENDS = [0.5];
  const between = new Map(); // cell -> one blended face per BLENDS level
  if (motion && S.overlay) {
    const boxes = flipBoxes();
    const shots = await Promise.all(boxes.map((el) => snapshot(el)));
    if (token !== morphToken) return;
    S.overlay = new Map();
    if (shots.every(Boolean)) {
      shots.forEach((shot, k) => {
        const bg = cardBg(boxes[k]);
        for (const [i, f] of slicesOf(shot, bg)) S.overlay.set(i, f);
        const old = oldShots.get(boxes[k]);
        if (!old || old.canvas.width !== shot.canvas.width || old.canvas.height !== shot.canvas.height) return;
        BLENDS.forEach((a, n) => {
          const c = document.createElement('canvas');
          c.width = shot.canvas.width;
          c.height = shot.canvas.height;
          const x = c.getContext('2d');
          x.drawImage(old.canvas, 0, 0);
          x.globalAlpha = a;
          x.drawImage(shot.canvas, 0, 0);
          for (const [i, f] of slicesOf({ canvas: c, rect: shot.rect }, bg)) {
            if (!between.has(i)) between.set(i, []);
            between.get(i)[n] = f;
          }
        });
      });
    }
  }
  const field = motionField('ripple', 1, origin);
  const ahead = THEME_AHEAD; // the switch has already answered; the ripple follows straight away
  veilWipe(field, ahead + 30 + FLIP_STEP + FLIP_DUR / 2, WAVE_MS); // the front sits where switches are half-way through
  let end = 0;
  retarget(
    allCells(),
    (i, to) => {
      const delay = ahead + field.tau(...cellCentre(i)) + rand() * 25;
      const onBox = S.overlay && (S.overlay.has(i) || before.has(i));
      // One blended step half-way: the front reads as an even gradient rather than speckle.
      const levels = [0];
      let steps = null;
      const blended = between.get(i);
      if (blended) steps = levels.map((n) => blended[n]).filter(Boolean);
      else {
        const from = board.cells[i].cur;
        const a = faceColour(from);
        const b = faceColour(to);
        if (a && b && a !== b) steps = levels.map((n) => solid(mixLch(a, b, BLENDS[n])));
      }
      const stepDur = FLIP_STEP;
      const dur = FLIP_DUR;
      end = Math.max(end, delay + (steps ? steps.length : 0) * stepDur + dur + 200);
      const base = { delay, dur, gap: board.gapColor, steps, stepDur };
      return onBox ? { ...base, edgesIn: ahead, edgesOut: S.overlay.has(i) ? 170 : 0 } : base;
    },
    () => true, // every switch flips, background included, so the gutters change in the same ripple
  );
  if (!motion) {
    for (const c of board.cells) c.gap = null;
    board.redrawAll();
    return;
  }
  if (S.overlay) {
    await wait(Math.min(end, 2200));
    if (token === morphToken) finishWeb();
  }
});

// ---------------------------------------------------------------------------
// Background: re-sample it now and then; flip only the switches whose colour has drifted.

function paintStep(now) {
  S.lastStep = now;
  S.frame = paint.frame(S.pt, scheme());
  if (S.sweep) return; // (while a sweep crosses the board it moves the background on: sweepStep)
  const rgb = S.frame.rgb;
  const th2 = paintThreshold() ** 2;
  for (const c of board.cells) {
    if (!isPaint(c.abs) || board.busy(c)) continue;
    const k = c.i * 3;
    const dr = rgb[k] - c.r;
    const dg = rgb[k + 1] - c.g;
    const db = rgb[k + 2] - c.b;
    if (dr * dr + dg * dg + db * db > th2) {
      rememberPaint(c);
      board.flip(c, concrete(null, c.i), { delay: rand() * 500, dur: 440 + rand() * 240 }); // (spread evenly)
    }
  }
}

// ---------------------------------------------------------------------------
// Sweeps: a page change, theme change or pulse doesn't re-flip the background. The background
// is one continuous moving map; the change is a front crossing that map, with the old colours
// ahead of it, the new behind, and a soft blend in between. Each switch keeps flipping as its
// colour drifts, so the wave is simply where the colours change fastest, and the background
// never pauses. At the front every switch turns over once, straight to the new colours (and
// the new gutter), however little its colour changes.

const SWEEP_BAND = 300; // ms the blend takes to pass a point
const SWEEP_FREEZE = 480; // ms ahead of the front that drift flips stop starting (> the longest one ahead)

function startSweep(from, field, lag, gapFrom, fromFrame = null) {
  if (reduce.matches) return;
  const n = board.cells.length;
  const tau = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    tau[i] = field.tau(...cellCentre(i)) + rand() * 25;
    last = Math.max(last, tau[i]);
  }
  // Switches keep their own gutter until the front reaches them.
  for (const c of board.cells) c.gap = c.gap || gapFrom;
  // Where each switch starts from: the colours the board was showing (one of `srcs`) and the
  // look (plain or ASCII). (The first map is the frame the board was showing, so starting a sweep
  // computes nothing new.) A sweep that turns round one still running carries over what the
  // switches its front hadn't reached were showing, so they drift on in that until the new
  // front reaches them, rather than all flipping at once.
  const srcs = [{ scheme: from, rgb: fromFrame?.rgb, lab: null }];
  const src = new Uint8Array(n);
  const asciiOld = new Uint8Array(n).fill(S.ascii ? 1 : 0);
  const prev = S.sweep;
  if (prev && prev.turned.length === n) {
    for (let i = 0; i < n; i++) {
      if (prev.turned[i]) continue;
      const was = prev.srcs[prev.src[i]];
      let k = srcs.indexOf(was);
      if (k < 0 && srcs.length < 4) k = srcs.push(was) - 1;
      src[i] = Math.max(0, k);
      asciiOld[i] = prev.asciiOld[i];
    }
  }
  S.sweep = { srcs, src, asciiOld, to: scheme(), t0: performance.now(), lag, tau, turned: new Uint8Array(n), frozen: new Uint8Array(n), end: lag + last + SWEEP_BAND + 60, gapTo: board.gapColor, at: -Infinity, toRgb: S.frame?.rgb };
}

function sweepStep(now) {
  const sw = S.sweep;
  // The two maps, refreshed as the pattern moves (in OKLab, so blends never dip through grey).
  // (Without a GPU the maps are computed in JavaScript: the old one once, the new one less often.)
  // (Each read of the maps waits for the GPU to finish drawing; on small switches there is much
  // more to draw, so they are read half as often, and the starting maps half as often again.)
  const fine = board.cells.length > 4000;
  if (now - sw.at > (S.lite ? 600 : fine ? 240 : 120)) {
    sw.at = now;
    sw.reads = (sw.reads || 0) + 1;
    const toLab = (rgb) => {
      const out = new Float32Array(rgb.length);
      for (let k = 0; k < rgb.length; k += 3) {
        const v = rgbToLab(rgb[k], rgb[k + 1], rgb[k + 2]);
        out[k] = v[0];
        out[k + 1] = v[1];
        out[k + 2] = v[2];
      }
      return out;
    };
    const first = !sw.b;
    if (!first) S.frame = paint.frame(S.pt, sw.to);
    for (const f of sw.srcs) {
      if (!f.lab) f.lab = toLab(f.rgb || paint.frame(S.pt, f.scheme).rgb);
      else if (!S.lite && (!fine || sw.reads % 2)) f.lab = toLab(paint.frame(S.pt, f.scheme).rgb);
    }
    sw.b = toLab(first && sw.toRgb ? sw.toRgb : S.frame.rgb);
  }
  const el = now - sw.t0 - sw.lag;
  const th2 = paintThreshold() ** 2;
  for (const c of board.cells) {
    if (!isPaint(c.abs)) continue;
    const i = c.i;
    const k = i * 3;
    const x = (el - sw.tau[i]) / SWEEP_BAND;
    if (!sw.turned[i]) {
      if (x >= 0.5) {
        // The front (half-way through the blend): the switch turns over whatever its threshold,
        // straight to the new colours (its flip takes about as long as the rest of the blend).
        // This replaces a drift flip still waiting; one still in motion (the freeze should have
        // seen to that) is hurried to land first.
        sw.turned[i] = 1;
        board.hurry(c, 60);
        const [r, g, b] = labToRgb(sw.b[k], sw.b[k + 1], sw.b[k + 2]);
        c.r = r;
        c.g = g;
        c.b = b;
        board.flip(c, paintFace(r, g, b), { dur: FLIP_DUR, gap: sw.gapTo, edgesIn: (c.ca ?? 1) < 1 ? 40 : 0 });
        // Now that it shows the current colour, leave it a random way towards its next drift
        // flip (as in steady drift), so they don't all come due again together.
        staggerMemory(c, k);
        continue;
      }
      // An unseen freeze runs SWEEP_FREEZE ms ahead of the front: once it has passed, no drift
      // flip starts (one still waiting is dropped, one in motion is hurried to land in time), so
      // every switch is free to turn over the moment the front arrives.
      const toFront = sw.tau[i] + SWEEP_BAND / 2 - el;
      if (sw.hold) continue; // (showing the old board's picture until the front)
      if (x > 0 || toFront < SWEEP_FREEZE * board.durScale) {
        if (!sw.frozen[i]) {
          sw.frozen[i] = 1;
          board.dropQueue(c);
          board.hurry(c, Math.max(60, toFront - 30));
        }
        continue;
      }
    }
    // Ahead of the freeze the old colours drift on, behind the front the new ones.
    if (c.anim || c.q.length) continue;
    const m = sw.turned[i] ? sw.b : sw.srcs[sw.src[i]].lab;
    const [r, g, b] = labToRgb(m[k], m[k + 1], m[k + 2]);
    if ((r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2 > th2) {
      c.r = r;
      c.g = g;
      c.b = b;
      // (Ahead of the freeze, drift flips are short and start before it arrives, so each lands
      // before the front; behind the front they are the ordinary drift, so handing back to
      // paintStep shows no seam.)
      const ahead = sw.tau[i] + SWEEP_BAND / 2 - el - SWEEP_FREEZE * board.durScale;
      board.flip(c, paintFace(r, g, b, sw.turned[i] ? S.ascii : !!sw.asciiOld[i]), sw.turned[i] ? { delay: rand() * 500, dur: 440 + rand() * 240 } : { delay: rand() * Math.min(250, ahead), dur: 320 + rand() * 120 });
    }
  }
  if (el > sw.end) {
    S.sweep = null;
    board.settleGaps();
    paintStep(now); // the ordinary drift carries straight on
  }
}

// ---------------------------------------------------------------------------
// Brush: pressing and dragging flips nearby switches through colours, then they return.
// Over a section, the section quietly becomes switches of itself while it is being brushed.

const HOLD_MS = 200; // press this long without moving (or drag) to start painting
const RESPLASH_MS = 420; // a still, held pointer keeps re-painting its patch

const brushBoxes = new Map(); // element -> { ready, cells, waiting }
// The boxes on top of the board (the sections, bars and title), which the brush leaves alone.
const brushable = () => [headerEl(), footerEl(), morphBox()].filter((el) => el && !el.closest('[hidden]'));
function boxAtCell(i) {
  if (S.overlay) return null;
  const [x, y] = cellCentre(i);
  return (
    brushable().find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) || null
  );
}
/** Once a stroke has settled, painted sections become normal web sections again. */
let brushRestoreTimer = 0;
function restoreBrushBoxes(force = false) {
  clearTimeout(brushRestoreTimer);
  if (!brushBoxes.size) return;
  const settled = [...brushBoxes.values()].every((st) => st.ready && [...st.cells].every((i) => !board.busy(i) && !board.cells[i].caAnim && (board.cells[i].ca ?? 1) === 0));
  if (!force && (S.brush || !settled)) {
    brushRestoreTimer = setTimeout(restoreBrushBoxes, 250);
    return;
  }
  const cells = [];
  for (const [el, st] of brushBoxes) {
    el.style.opacity = '';
    for (const i of st.cells) {
      S.brushMap?.delete(i);
      cells.push(i);
    }
  }
  brushBoxes.clear();
  for (const i of cells) board.setEdges(i, 1);
  retarget(cells, null, () => true);
}

/** Colours a brushed switch flicks through: one held for a moment, then a couple more. */
/**
 * The faces a brushed switch passes through before it goes back: bold characters in the brush's
 * colours. On ASCII mode's small switches, one each; on normal ones the switch splits into a
 * little grid of four smaller ones: the pieces the brush covers (`mask`) get characters, the rest
 * go on showing what the switch showed (its colour, or a section's text), so a stroke's edge is
 * softer. Their gutters match what they are over (`gap`).
 */
function brushPath(base, mask) {
  const pal = scheme().brush;
  const c = () => (S.small === 'ascii' ? Object.assign(glyph(pick('#@%*'), pick(pal), ASCII_FACE, 600), { avg: pal[0] }) : brushMosaic(pal, mask, base));
  return [c(), { f: c(), w: 220 + rand() * 260 }, ...Array.from({ length: randInt(1, 3) }, c)];
}

// The brushed pieces' characters, by palette, pieces covered and gutter colour (a few variants
// of each): their pictures are drawn once and shared; what shows through differs per switch.
const brushTiles = new Map();
function brushMosaic(pal, mask, base) {
  const key = `${pal.join()}|${mask}|${randInt(0, mask === 15 ? 11 : 3)}`;
  let tiles = brushTiles.get(key);
  if (!tiles) {
    if (brushTiles.size > 3000) brushTiles.clear();
    tiles = Array.from({ length: 4 }, (_, k) => (mask & (1 << k) ? { ch: pick('#@%*+='), fg: pick(pal) } : null));
    brushTiles.set(key, tiles);
  }
  // (Every piece keeps what the switch showed under it, so each little flap falls on its own.)
  return Object.assign(mosaic(tiles, 2, 2, ASCII_FACE, BRUSH_GAP, key, base), { avg: faceColour(base) });
}

const BRUSH_R = 1.15; // the brush's radius, in normal switch widths
const BRUSH_GAP = '#000'; // the brush's gutters: black, as a terminal's (whatever it is over)

/** What a switch the brush is about to paint shows (or is on its way to; one being brushed already
 *  keeps what it showed before), so that is what it goes back to and what shows between strokes. */
function heldFace(s) {
  if (S.small === 'ascii') return concrete(s.abs, s.i);
  const last = s.q.length ? s.q[s.q.length - 1].f : s.anim ? s.anim.to : s.cur;
  const f = last.t === 'mosaic' ? last.base : last;
  if (!f || f.t === 'mosaic' || f.t === 'glyph') return concrete(s.abs, s.i);
  // (Held while it is still the board's colour, give or take its drift; once a wave has moved
  // the board on, e.g. to another page, it takes the board's colour now.)
  if (f.t === 'blank' && isPaint(s.abs)) {
    const k = s.i * 3;
    const rgb = S.frame.rgb;
    const d = Math.hypot(parseInt(f.bg.slice(1, 3), 16) - rgb[k], parseInt(f.bg.slice(3, 5), 16) - rgb[k + 1], parseInt(f.bg.slice(5, 7), 16) - rgb[k + 2]);
    if (d > 3 * paintThreshold()) return concrete(s.abs, s.i);
  }
  return f;
}

/** Paint around a point (CSS px): every switch the brush covers flips through brushed faces and back. */
function splash(x, y, again = false) {
  const dpr = board.dpr;
  const cwc = board.cw / dpr;
  const chc = board.ch / dpr;
  const ox = board.ox / dpr;
  const oy = board.oy / dpr;
  const R = BRUSH_R * ((S.layoutGeom || board).cw / dpr);
  const split = S.small !== 'ascii'; // (normal switches split into four pieces)
  const now = performance.now();
  const c0 = Math.max(0, Math.floor((x - R - ox) / cwc));
  const c1 = Math.min(board.cols - 1, Math.floor((x + R - ox) / cwc));
  const r0 = Math.max(0, Math.floor((y - R - oy) / chc));
  const r1 = Math.min(board.rows - 1, Math.floor((y + R - oy) / chc));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      // Which pieces the brush covers (their centres inside it, the edge a little ragged).
      let mask = 0;
      const pieces = split ? 4 : 1;
      for (let k = 0; k < pieces; k++) {
        const px = ox + (c + (split ? (k & 1 ? 0.75 : 0.25) : 0.5)) * cwc;
        const py = oy + (r + (split ? (k & 2 ? 0.75 : 0.25) : 0.5)) * chc;
        if (Math.hypot(px - x, py - y) < R * (0.85 + rand() * 0.3)) mask |= 1 << k;
      }
      if (!split && mask) mask = 15;
      if (!mask) continue;
      const j = r * board.cols + c;
      const s = board.cells[j];
      // (A switch just painted is left to finish, unless the brush now covers more of it.)
      const had = now - s.splash < 1200 ? s.mask || 0 : 0;
      const more = (mask | had) !== had;
      if (!more && (now - s.splash < 200 || (again && board.busy(s)))) continue;
      mask |= had;
      s.splash = now;
      s.mask = mask;
      const delay = rand() * 40;
      // (The sections, bars and title sit on top, also while they are switches in a transition:
      // the brush paints the board.)
      if (boxAtCell(j) || !isPaint(s.abs)) continue;
      // The switch holds what it shows while the brush is at work, and goes back to it after;
      // the background's drift takes it up again from there.
      const base = heldFace(s);
      if (isPaint(s.abs) && base.t === 'blank') {
        s.r = parseInt(base.bg.slice(1, 3), 16);
        s.g = parseInt(base.bg.slice(3, 5), 16);
        s.b = parseInt(base.bg.slice(5, 7), 16);
      }
      board.hurry(s, 40); // (a drift flip under way lands at once, so the brush isn't kept waiting)
      board.flip(s, base, { delay, steps: brushPath(base, mask), stepDur: 85, dur: 190 });
    }
  }
}

/** Paint along the pointer's path since the last point painted, so fast strokes leave no gaps. */
function splashTo(b, x, y) {
  const stepPx = (S.layoutGeom || board).cw / board.dpr / 2;
  const x0 = b.px ?? x;
  const y0 = b.py ?? y;
  const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / stepPx));
  for (let k = 1; k <= n; k++) splash(x0 + ((x - x0) * k) / n, y0 + ((y - y0) * k) / n);
  b.px = x;
  b.py = y;
}

function startPainting(b) {
  if (b.painting || S.brush !== b || b.noPaint) return;
  b.painting = true;
  S.paintedAt = Infinity; // (a paint stroke's release isn't a pulse click)
  clearTimeout(b.timer);
  document.documentElement.classList.add('painting');
  document.getSelection()?.removeAllRanges();
  b.px = b.py = null;
  splashTo(b, b.lx ?? b.x, b.ly ?? b.y);
  b.lastSplash = performance.now();
}

function dropBrush() {
  if (!S.brush) return;
  if (S.brush.painting) S.paintedAt = performance.now();
  clearTimeout(S.brush.timer);
  S.brush = null;
  document.documentElement.classList.remove('painting');
  restoreBrushBoxes();
}

function startBrush(e, flickOnly = false) {
  dropBrush();
  const b = { id: e.pointerId, x: e.clientX, y: e.clientY, last: board.cellAt(e.clientX, e.clientY), painting: false, moved: false, lastSplash: 0, t0: performance.now() };
  // On a touch screen, a press on a card with parts may be a flick: don't paint straight away.
  b.flick = e.pointerType !== 'mouse' && !!e.target.closest?.('section.paged');
  // The brush paints only the board (never with reduced motion); a press on a card with parts
  // only counts as a possible flick, which turns the card's part.
  b.noPaint = flickOnly || reduce.matches;
  if (b.noPaint && !b.flick) return;
  try {
    e.target.setPointerCapture(e.pointerId);
  } catch {}
  if (!b.noPaint) b.timer = setTimeout(() => startPainting(b), b.flick ? 450 : HOLD_MS);
  S.brush = b;
}

function brushMove(e) {
  const i = board.cellAt(e.clientX, e.clientY);
  // A release we never heard about (e.g. outside the window) must not leave the brush on.
  if (S.brush && e.pointerType === 'mouse' && !(e.buttons & 1)) dropBrush();
  const b = S.brush;
  if (!b || b.id !== e.pointerId) return false;
  b.lx = e.clientX;
  b.ly = e.clientY;
  if (!b.moved && Math.hypot(e.clientX - b.x, e.clientY - b.y) > 8) {
    // (A possible flick waits until it's clearly a slow drag.)
    if (b.flick && performance.now() - b.t0 < 280) return true;
    b.moved = true;
    startPainting(b);
  }
  if (b.painting && i >= 0) {
    splashTo(b, e.clientX, e.clientY);
    b.lastSplash = performance.now();
  }
  if (i >= 0) b.last = i;
  return true;
}

// ---------------------------------------------------------------------------
// Input

onBoard('pointerdown', (e) => {
  if (e.button !== 0 || !e.isPrimary) return;
  // (On the title screen a tap enters and a hold or drag paints.)
  if (S.key === 'intro' && reduce.matches) return enter({ x: e.clientX, y: e.clientY });
  startBrush(e);
});
// On the sections a press-and-hold (or drag) paints too; clicks on links and buttons work as usual.
source.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.isPrimary || e.target.closest('button')) return;
  // Links work as usual, except that a touch on a card with parts may also be a flick.
  if (e.target.closest('a') && (e.pointerType === 'mouse' || !e.target.closest('section.paged'))) return;
  if (S.key === 'intro') return enter({ x: e.clientX, y: e.clientY });
  // (The brush paints only the board; a touch on a card with parts may be a flick, to turn it.)
  if (e.pointerType !== 'mouse' && e.target.closest('section.paged')) startBrush(e, true);
});
for (const on of [onBoard, (type, fn) => source.addEventListener(type, fn)]) {
  on('pointermove', (e) => {
    if (e.isPrimary && brushMove(e) && S.brush?.painting) e.preventDefault();
  });
  for (const type of ['pointerup', 'pointercancel']) {
    on(type, (e) => {
      const b = S.brush;
      if (!b || b.id !== e.pointerId) return;
      // A quick flick across a card with parts turns to the next or previous part.
      const [ex, ey] = type === 'pointercancel' && b.lx != null ? [b.lx, b.ly] : [e.clientX, e.clientY];
      const dx = ex - b.x;
      const dy = ey - b.y;
      // (Some browsers end a fast touch drag with pointercancel rather than pointerup.)
      if (b.flick && !b.painting && performance.now() - b.t0 < 450 && Math.max(Math.abs(dx), Math.abs(dy)) > 40) {
        const d = Math.abs(dy) > Math.abs(dx) ? dy : dx;
        dropBrush();
        return goPart(d < 0 ? 1 : -1, { x: ex, y: ey });
      }
      if (S.key === 'intro' && type === 'pointerup' && !b.painting && !b.moved) {
        dropBrush();
        return enter({ x: e.clientX, y: e.clientY });
      }
      dropBrush();
    });
  }
}
onBoard('lostpointercapture', (e) => S.brush && S.brush.id === e.pointerId && dropBrush());
onBoard('contextmenu', (e) => e.preventDefault());
window.addEventListener('blur', dropBrush);

for (const n of nav) {
  n.el.addEventListener('click', (e) => {
    e.preventDefault();
    const cur = pageIndex(goingTo ?? S.key);
    go(n.id, { dir: pageIndex(n.id) >= cur ? 1 : -1, origin: centreOf(n.el) });
  });
}
$('#site-name').addEventListener('click', (e) => {
  e.preventDefault();
  go('intro', { dir: -1, origin: centreOf(e.currentTarget) });
});
$('#enter').addEventListener('click', () => enter());
prevBtn.addEventListener('click', () => step(-1, centreOf(prevBtn)));
nextBtn.addEventListener('click', () => step(1, centreOf(nextBtn)));
for (const t of themeSwitches()) t.addEventListener('click', toggleTheme);
// A click on the board (a quick press: not a hold or drag, which paint) moves the page to its
// next colour combo, rippling out from the click.
let pressedAt = null;
onBoard('pointerdown', (e) => (pressedAt = [e.clientX, e.clientY]));
onBoard('click', (e) => {
  if (S.key === 'intro' || performance.now() - (S.paintedAt || 0) < 300) return;
  if (pressedAt && Math.hypot(e.clientX - pressedAt[0], e.clientY - pressedAt[1]) > 8) return; // (a drag)
  pulseCombo({ x: e.clientX, y: e.clientY });
});
// The page transition: the visitor's choice of sweep or ripple, in the footer.
const waveToggle = $('#wave-toggle');
const showWave = () => {
  $('.fo-v', waveToggle).textContent = MOTIONS[look.motion];
  waveToggle.setAttribute('aria-label', `Page transition: ${MOTIONS[look.motion]}`);
};
showWave();
waveToggle.addEventListener('click', () => {
  const order = Object.keys(MOTIONS);
  look.motion = order[(order.indexOf(look.motion) + 1) % order.length];
  saveLook(look);
  showWave();
  layoutWeb();
});

const options = mountOptions(look, onLookChange);

watchCodes({ konami: playBadApple });
for (const btn of $$('.ascii-btn')) btn.addEventListener('click', toggleAscii);
$('#apple-toggle').addEventListener('click', playBadApple);

window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'D' && e.shiftKey) { // (Shift+D: the design panel, for reviewing the palettes)
    options.toggle();
    return;
  }
  if (e.target.closest?.('#design-options')) return;
  // Enter or Space on a button or link does what that control does (e.g. the theme switch).
  if (e.target.closest?.('a, button, input') && (e.key === ' ' || e.key === 'Enter')) return;
  if (S.key === 'intro') {
    // Any key moves on from the title, except keys that do something else: Tab and its
    // modifiers, lock and function keys, and browser shortcuts.
    if (e.repeat || e.key === 'Tab' || e.key === 'Escape' || /^(Shift|Control|Alt|AltGraph|Meta|OS|Fn|CapsLock|NumLock|ScrollLock|Insert|Unidentified|Dead|ContextMenu)$/.test(e.key) || /^(Audio|Media|Browser|Launch)/.test(e.key) || /^F\d+$/.test(e.key)) return;
    if (/^( |Enter|Arrow\w+|Page\w+|Home|End)$/.test(e.key)) e.preventDefault();
    enter();
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    step(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    step(-1);
  } else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
    // Through a card's parts (the page never scrolls).
    e.preventDefault();
    goPart(1);
  } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault();
    goPart(-1);
  }
});

// Parts: the controls on the card, the mouse wheel over it, and a quick flick on touch screens.
for (const pg of pages) {
  $('.pg-prev', pg.pager).addEventListener('click', (e) => goPart(-1, centreOf(e.currentTarget)));
  $('.pg-next', pg.pager).addEventListener('click', (e) => goPart(1, centreOf(e.currentTarget)));
}
let wheelAt = 0;
let wheelSum = 0;
let wheelFired = 0;
source.addEventListener(
  'wheel',
  (e) => {
    const card = e.target.closest?.('section.paged');
    if (!card) return;
    const now = performance.now();
    if (now - wheelAt > 250) wheelSum = 0;
    wheelAt = now;
    wheelSum += e.deltaY + e.deltaX;
    if (Math.abs(wheelSum) < 40 || now - wheelFired < 650) return;
    wheelFired = now;
    wheelSum = 0;
    goPart(e.deltaY + e.deltaX > 0 ? 1 : -1, { x: e.clientX, y: e.clientY });
  },
  { passive: true },
);

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => build(false), 120);
});
// (The pixel ratio can change with no resize, e.g. on a window moved to another screen.)
const watchRatio = () => matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => (build(false), watchRatio()), { once: true });
watchRatio();

const keyFromHash = () => {
  const h = location.hash.slice(1);
  return pages.some((p) => p.id === h) ? h : null;
};
window.addEventListener('popstate', () => go(keyFromHash() || 'intro', { push: false }));

/** ASCII mode (the header's >_ button): the board ripples out from the middle into coloured characters (or back). */
let asciiWait = 0;
function toggleAscii() {
  // (Once the running transition is done: clicks meanwhile ask for it once, not once each.)
  if (pendingApply || goingTo || S.overlay || S.sweep) return void (asciiWait ||= setTimeout(() => ((asciiWait = 0), toggleAscii()), 250));
  const on = !S.ascii;
  // The new switches start out showing the board as it was; the ripple turns them over into the
  // new look (and size).
  const held = setSmall(S.player ? 'apple' : on ? 'ascii' : false, { smooth: true });
  const sweepFrom = scheme();
  const gapFrom = board.gapColor;
  const fromFrame = S.frame;
  S.ascii = on;
  for (const b of $$('.ascii-btn')) b.setAttribute('aria-pressed', String(S.ascii));
  retintGutter();
  if (reduce.matches) return settleBackground();
  startSweep(sweepFrom, motionField('ripple'), -SWEEP_BAND / 2, gapFrom, fromFrame);
  S.sweep.asciiOld.fill(S.ascii ? 0 : 1); // (ahead of the front, switches keep the old look)
  S.sweep.hold = held; // (and hold the old board's picture until it arrives)
}

/**
 * The Konami code: Bad Apple!! plays on the board, on smaller switches, with the background
 * carrying on around it. Esc, a click or a tap stops it; other keys wait until it is over.
 */
async function playBadApple() {
  if (S.player || reduce.matches) return; // (a flashing video: not with reduced motion)
  if (pendingApply || goingTo || S.overlay) return void setTimeout(playBadApple, 250); // (once the running transition is done)
  S.player = 'loading';
  let frames;
  let Player;
  try {
    const mod = await import('./badapple.js');
    Player = mod.Player;
    frames = await mod.loadFrames('assets/badapple.bin');
  } catch (err) {
    console.warn('Bad Apple!! could not load', err);
    S.player = null;
    return;
  }
  dropBrush();
  restoreBrushBoxes(true);
  document.documentElement.classList.add('playing');
  setSmall('apple', { force: true });
  S.player = new Player(board, frames, { dark: solid('#0b0d10'), light: solid('#eef1f5'), rippleMs: WAVE_MS, onEnd: stopBadApple });
  addEventListener('keydown', playerKeys, true);
  addEventListener('pointerdown', stopBadApple, true);
}
function playerKeys(e) {
  if (e.key === 'Escape') stopBadApple();
  else if (!/^(Tab|F\d+)$/.test(e.key)) e.stopImmediatePropagation(); // (the site's keys wait)
}
function stopBadApple(e) {
  if (!S.player || S.player === 'loading') return;
  // (The click that stopped it does nothing else; a press that makes no click arms nothing for long.)
  if (e?.type === 'pointerdown' && e.button === 0) {
    const eat = (c) => c.stopImmediatePropagation();
    addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', eat, true), 600);
  }
  removeEventListener('keydown', playerKeys, true);
  removeEventListener('pointerdown', stopBadApple, true);
  S.player.release();
  S.player = null;
  setSmall(smallWanted(), { force: true });
  // The page comes back the way it first arrives: switching in from the background.
  webGo(() => {}, { fromNothing: true });
  document.documentElement.classList.remove('playing');
}

/** Without motion: the background takes its new colours and gutters at once. */
function settleBackground() {
  S.frame = paint.frame(S.pt, scheme());
  retarget(allCells(), null, (i) => !faceAt(i));
  for (const c of board.cells) c.gap = null;
  board.redrawAll();
}

/** The board ripples from `origin` into the page's next colour combo. */
function pulseCombo(origin) {
  if (pendingApply || goingTo || S.overlay || S.sweep) return; // (not over a transition still running)
  const page = S.key;
  const n = combosOf(page, look).length || 1;
  const sweepFrom = scheme();
  const gapFrom = board.gapColor;
  const fromFrame = S.frame;
  setCombo(page, (comboOf(page) + 1) % n);
  applyColours();
  retintGutter();
  S.frame = paint.frame(S.pt, scheme());
  if (reduce.matches) settleBackground();
  else startSweep(sweepFrom, motionField('ripple', 1, origin), -SWEEP_BAND / 2, gapFrom, fromFrame);
  schedulePrefetch();
}

/** A design option changed (from the review panel). */
async function onLookChange(key) {
  cancelWeb();
  applyLook();
  shotCache.clear();
  if (key === 'font') await document.fonts.load(`700 64px ${getComputedStyle(document.documentElement).getPropertyValue('--display')}`).catch(() => {});
  if (key === 'palette') board.gapColor = boardGutter();
  syncDom();
  S.frame = paint.frame(S.pt, scheme());
  S.lastStep = performance.now();
  if (key === 'palette' || key === 'bg') {
    // A gentle sweep of the background into the new look.
    const field = motionField('sweep', 1);
    retarget(allCells(), (i) => ({ delay: field.tau(...cellCentre(i)) + rand() * 120, dur: 320, gap: board.gapColor }), () => true);
  }
  schedulePrefetch();
}

// ---------------------------------------------------------------------------
// Start

function loop(now) {
  if (S.lastNow) S.pt += (Math.min(now - S.lastNow, 250) / 1000) * SPEED;
  S.lastNow = now;
  if (!reduce.matches && now - S.lastStep >= stepMs()) paintStep(now);
  if (S.sweep && now - (S.sweepAt || 0) >= (S.lite ? 70 : 34)) {
    S.sweepAt = now;
    sweepStep(now);
  }
  watchFrames(now);
  if (S.player && S.player !== 'loading') S.player.step(now);
  const b = S.brush;
  if (b && b.painting && b.last >= 0 && now - b.lastSplash >= RESPLASH_MS) {
    splash(b.px ?? b.x, b.py ?? b.y, true);
    b.lastSplash = now;
  }
  board.tick(now);
  board.render(now);
  requestAnimationFrame(loop);
}

/** Go lite (once) when the GPU is missing or turns out too slow: rebuild with lighter settings. */
function goLite() {
  if (S.lite) return;
  S.lite = true;
  document.documentElement.dataset.lite = '';
  build(false);
}
paint.onLite = goLite;

// A machine that can't hold a steady frame rate in the first seconds (while nothing else is
// moving much) gets the lighter settings too.
const frameLog = [];
function watchFrames(now) {
  if (S.lite || frameLog.done) return;
  frameLog.push(now);
  if (frameLog.length < 150 || document.hidden) return;
  const d = frameLog.slice(1).map((t, k) => t - frameLog[k]).sort((a, b) => a - b);
  frameLog.done = true;
  if (d[(d.length / 2) | 0] > 28) goLite();
}

window.boardStarting = true; // (index.html's plain-page fallback leaves it to start() from here)

async function start() {
  S.lite = paint.lite;
  if (S.lite) document.documentElement.dataset.lite = '';
  applyLook();
  // (Fonts are local and quick; a slow one doesn't hold the board back for long.)
  await Promise.race([
    Promise.all([
      document.fonts.load('400 13px "IBM Plex Mono"'),
      document.fonts.load('500 13px "IBM Plex Mono"'),
      document.fonts.load('600 13px "IBM Plex Mono"'),
      document.fonts.load(`700 64px ${getComputedStyle(document.documentElement).getPropertyValue('--display')}`),
    ]),
    wait(3000),
  ]).catch(() => {});
  S.key = keyFromHash() || 'intro';
  syncDom();
  build(true);
  // The first screen arrives the same way any other does: switching in from the background.
  webGo(() => {}, { fromNothing: true });
  requestAnimationFrame(loop);
  // Tell the page the board is running (index.html falls back to the plain page otherwise).
  document.documentElement.classList.add('board');
}

start().catch((err) => {
  console.error(err);
  document.documentElement.classList.remove('js');
});
