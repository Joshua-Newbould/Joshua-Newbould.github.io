// Joshua Newbould's site: a normal web page whose sections sit snapped onto a board of
// split-flap switches. The board shows a slow moving background; when the page changes, the
// sections turn into switches, flip across to the next page in a wave, and become web sections
// again. Everything here is built for that: the board (board.js), the background (paint.js),
// the design system and its variations (design.js), and the transitions below.

import { Board, blank, solid, source as imageSource, slice } from './board.js';
import { Paint } from './paint.js';
import { loadLook, saveLook, scheme as makeScheme, gutter, bgMode, mountOptions, COMBOS, comboOf, setCombo, boardHue, oklch as oklchHex } from './design.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const canvas = $('#board');
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
const brushToggle = $('#brush-toggle');
const cardToggle = $('#card-toggle');
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
  // The sun/moon switch, here too, so the theme can be chosen before entering.
  const sw = themeToggle.cloneNode(true);
  sw.id = 'intro-theme';
  bar.removeAttribute('aria-hidden');
  for (const n of bar.querySelectorAll('.w-dot, .w-path, .w-stripes')) n.setAttribute('aria-hidden', 'true');
  bar.append(sw);
  introEl.prepend(bar);
  const status = document.createElement('div');
  status.className = 'w-statusline';
  status.setAttribute('aria-hidden', 'true');
  status.innerHTML = `<span>SEC 00/${String(pages.length).padStart(2, '0')}</span><span>READY</span>`;
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
  $('.pg-num', pg.pager).textContent = `${pg.part + 1} / ${parts.length}`;
  const prev = $('.pg-prev', pg.pager);
  const next = $('.pg-next', pg.pager);
  const focused = document.activeElement;
  prev.disabled = pg.part === 0;
  next.disabled = pg.part === parts.length - 1;
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
  brushOn: false, // the paint brush works only while its button is on (off on every visit)
};

const SPEED = 0.032; // background time per second: a steady drift
// How often the background is re-sampled, and how far a switch's colour may drift before it
// flips. Without a GPU ("lite") both relax, so there is less to compute and to draw.
// While a wave is crossing, the background updates more often so its drift keeps pace on both
// sides of the front (no lull ahead of it, none in its wake).
const stepMs = () => (S.lite ? 900 : 500);
const paintThreshold = () => (S.lite ? 22 : 16);

const board = new Board(canvas);
const paint = new Paint();
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
  board.flipStyle = look.flip;
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

function paintHex(i) {
  const k = i * 3;
  const rgb = S.frame.rgb;
  return rgbHex(rgb[k], rgb[k + 1], rgb[k + 2]);
}
const concrete = (f, i) => f || solid(paintHex(i));
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
  const size = `${cssW}x${cssH}@${dpr}${S.lite ? 'L' : ''}`;
  if (size === S.size) return;
  S.size = size;
  dropBrush();
  if (!first) cancelWeb(); // a wave's switches belong to the old grid
  board.gapColor = gutter(S.dark, look, S.key);
  shadeBoard();
  board.configure(Board.metrics(cssW, cssH, dpr, cellTarget(cssW, cssH), 1.9), solid(board.gapColor));
  paint.resize(board);
  S.frame = paint.frame(S.pt, scheme());
  S.lastStep = performance.now();
  retarget(allCells(), null);
  layoutWeb();
  shotCache.clear();
  schedulePrefetch();
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
  // Window-size classes for the CSS (copied into snapshots, which media queries can't see).
  {
    const w = board.cssW;
    const h = board.cssH;
    const short = h <= 560 && w > h;
    document.documentElement.dataset.vp = [w < 640 && 'phone', (w >= 1000 || (w >= 800 && short)) && 'wide', short && 'short'].filter(Boolean).join(' ');
  }
  const dpr = board.dpr;
  const cw = board.cw / dpr;
  const ch = board.ch / dpr;
  const gap = board.gap / dpr;
  const x0 = board.ox / dpr;
  const y0 = board.oy / dpr;
  const rows = board.fullRows;
  const all = board.cols;
  const narrow = board.cssW < 640;
  const margin = narrow ? 1 : 2;
  // Cards are a comfortable reading width (up to ~880px) and centred, leaving plenty of board;
  // on phones too there is a band of board either side.
  const span = Math.min(board.cols - (narrow ? 8 : 2 * margin * 2), Math.ceil(880 / cw));
  const c0 = Math.floor((board.cols - span) / 2);
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

  // Title screen: a box in the centre, shrink-wrapped to the name.
  {
    const hid = introEl.hidden;
    introEl.hidden = false;
    Object.assign(introEl.style, { width: 'max-content', height: 'auto' });
    const w = Math.min(all - 2 * (narrow ? 2 : 3), Math.ceil((introEl.offsetWidth + gap) / cw) + 2);
    introEl.hidden = hid;
    const h = Math.min(rows - 2, measure(introEl, w) + 2);
    place(introEl, Math.floor((all - w) / 2), Math.floor((rows - h) / 2), w, h);
  }

  const bw = inset ? span : all;
  const bc = inset ? c0 : 0;
  // Header and footer: the roomiest layout that fits on one line each (short screens keep
  // the nav on the header's row as long as they can, since height is what they lack).
  const short = board.cssH <= 560 && board.cssW > board.cssH;
  fitBar(headerEl(), bw * cw - gap, short ? [[], ['compact'], ['compact', 'tight'], ['stack', 'tight'], ['stack', 'tight', 'abbr']] : [[], ['compact'], ['stack'], ['stack', 'tight'], ['stack', 'tight', 'abbr']]);
  fitBar(footerEl(), bw * cw - gap, [[], ['compact'], ['nocopy'], ['nocopy', 'compact'], ['nocopy', 'compact', 'arrows'], ['nocopy', 'compact', 'arrows', 'tight']]);
  {
    // Header and footer share one inset.
    const hd = headerEl();
    const ft = footerEl();
    const tight = ['compact', 'stack'].some((c) => hd.classList.contains(c)) || ['compact', 'nocopy'].some((c) => ft.classList.contains(c));
    hd.classList.toggle('pad-tight', tight);
    ft.classList.toggle('pad-tight', tight);
  }
  const hh = measure(headerEl(), bw);
  footerEl().style.paddingBottom = ''; // measured without the overhang padding (set below)
  const fh = measure(footerEl(), bw);
  const top0 = inset ? 1 : 0;
  place(headerEl(), bc, top0, bw, hh);
  // The full-width footer also covers a part-visible last row; its text stays centred in the visible part.
  const over = inset ? 0 : board.rows - rows;
  if (over) footerEl().style.paddingBottom = `${(over * board.ch) / board.dpr - (board.cssH - (board.oy + rows * board.ch) / board.dpr)}px`;
  if (inset) place(footerEl(), bc, rows - 1 - fh, bw, fh);
  else place(footerEl(), 0, rows - fh, all, fh + over);

  // Board shows all round the card: a gap under the header and over the footer, and a card
  // no taller than about three quarters of the space (more than that is split into parts).
  const vgap = narrow ? 2 : 1;
  const top = top0 + hh + vgap;
  const room = rows - (inset ? 1 : 0) - fh - vgap - top;
  const maxRows = Math.max(6, Math.floor(room * (narrow ? 0.8 : 0.76)));
  // Every card's top sits at the same spot: where the tallest card allowed would be centred.
  const topOff = short ? 0 : Math.max(0, Math.floor((room - maxRows) / 2));
  for (const p of pages) {
    if (p.el.hidden) continue;
    const key = [span, maxRows, cw, look.font, look.chrome, look.card, document.documentElement.dataset.vp].join('|');
    if (p.fitKey !== key) {
      p.fitKey = key;
      // Short screens may use their whole height; elsewhere a card leaves board above and below.
      // Every card starts at the same top, so it has only the space below that to fill.
      fitCard(p, (r) => rowsFor(p.el, span) <= r, short ? room : maxRows, room - topOff, narrow);
    }
    const h = p.rows(rowsFor, span);
    place(p.el, c0, top + Math.max(0, Math.min(topOff, room - h)), span, h); // (never into the footer)
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
let themeRippling = false; // the running transition is a theme ripple

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
  return [el.id || el.tagName, extra, accent, S.dark, look.palette, look.chrome, look.font, document.documentElement.dataset.card + ('console' in document.documentElement.dataset ? '+c' : ''), board.dpr, r.left, r.top, r.width, r.height].join('|');
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

/** Faces showing a snapshot cut into one slice per switch (each with its average colour). */
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
  const small = document.createElement('canvas');
  small.width = nc;
  small.height = nr;
  const sx = small.getContext('2d', { willReadFrequently: true });
  sx.imageSmoothingQuality = 'high';
  sx.drawImage(shot.canvas, 0, 0, nc * board.cw, nr * board.ch, 0, 0, nc, nr);
  const px = sx.getImageData(0, 0, nc, nr).data;
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const f = slice(src, c * board.cw, r * board.ch, bgHex);
      const k = (r * nc + c) * 4;
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
async function prefetchShots() {
  const busy = () => S.overlay || S.brush || goingTo || brushBoxes.size;
  if (busy()) return;
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
  for (const job of jobs) {
    if (busy()) return;
    await Promise.all([].concat(job()));
  }
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
const WAVE_MS = 850;
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
  Object.assign(layer.style, { left: r.left - PAD + 'px', top: r.top - PAD + 'px', width: r.width + 2 * PAD + 'px', height: r.height + 2 * PAD + 'px' });
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
    if (oldOn) setMask(oldL, field.edge(oldL.getBoundingClientRect(), t - hideLag, 'transparent', '#000', -soft));
    if (hasShadow(newBox)) setMask(newL, field.edge(newL.getBoundingClientRect(), t - showLag, '#000', 'transparent', soft));
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
    for (const c of themeVeil.children) setVeilMask(c, field.edge(c.getBoundingClientRect(), t, 'transparent', '#000', 110));
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
  retarget(added, null, () => true);
  for (const i of added) board.setEdges(i, 0);
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
async function webGo(go, { dir = 1, toKey = null, fromNothing = false, origin = null } = {}) {
  const token = ++morphToken;
  const fromKey = S.key;
  // Until the next screen is applied, a cancel (theme switch, resize) applies it straight away.
  const apply = () => {
    if (pendingApply === apply) pendingApply = null;
    go();
  };
  pendingApply = apply;
  themeRippling = false;
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
  if (!samePage) startSweep(sweepFrom, motionField(look.motion, dir, origin), 100 - SWEEP_BAND / 2, gapFrom, fromFrame); // (half-way through its blend as the cards flip)
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
  const ahead = 100; // edges fade in over this long, reaching full strength as the switch flips
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
}

/** End (or cut short) a transition: real sections visible, the board back to plain background. */
function finishWeb() {
  goingTo = null;
  themeRippling = false;
  clearThemeVeil();
  for (const el of [introEl, headerEl(), footerEl(), ...pages.map((p) => p.el)]) el.style.opacity = '';
  S.overlay = null;
  layoutWeb();
  resetEdges();
  // Every switch settles at once (nothing left half-flipped), in this theme's gutter (unless a
  // sweep is still crossing the board: it hands the gutters over as it goes).
  if (!S.sweep) for (const c of board.cells) c.gap = null;
  // Only switches still showing (or on their way to) a piece of a card are settled at once;
  // background switches already drifting again are left to finish their flips.
  const onCard = (i) => {
    const c = board.cells[i];
    return c.cur?.t === 'slice' || c.anim?.to?.t === 'slice' || c.q.some((n) => n.f?.t === 'slice');
  };
  retarget(allCells(), null, onCard);
  board.redrawAll();
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
  board.gapColor = gutter(S.dark, look, S.key);
  shadeBoard();
  if (old !== board.gapColor) for (const c of board.cells) c.gap = c.gap || old;
}

/** The flip's shading takes a deep tint of the page's colour (pure black muddies pastels). */
function shadeBoard() {
  const hue = boardHue(S.key, look);
  board.shade = S.dark ? oklchHex(0.16, 0.05, hue) : oklchHex(0.38, 0.09, hue);
  board.shadeK = S.dark ? 1 : 0.6;
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
  board.gapColor = gutter(S.dark, look, S.key);
  shadeBoard();
  S.frame = paint.frame(S.pt, scheme());
}

/** Every click counts: a click mid-ripple turns it round from wherever the switches are. */
function toggleTheme(e) {
  const from = e?.currentTarget || liveSwitch();
  S.wantDark = !(S.wantDark ?? S.dark);
  // Copy the bars as they are (usually already cached), before the switch moves: the copy
  // covers the old bars until the ripple passes, with a hole where the live switch shows.
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
async function switchTheme(dark, preShots = null, from = liveSwitch()) {
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
  themeRippling = true;
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
  startSweep(sweepFrom, motionField('ripple', 1, origin), 70 - SWEEP_BAND / 2, gapFrom, fromFrame); // the background ripples into the new theme
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
  const ahead = 70; // the switch has already answered; the ripple follows straight away
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
}

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
// never pauses. (The gutter changes as the front passes, so every switch turns over there.)

const SWEEP_BAND = 260; // ms the blend takes to pass a point

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
  // (The maps it starts from are the frame the board was showing and the one just computed for
  // the new colours, so starting a sweep computes nothing new.)
  S.sweep = { from, to: scheme(), t0: performance.now(), lag, tau, end: lag + last + SWEEP_BAND + 60, gapTo: board.gapColor, at: -Infinity, fromRgb: fromFrame?.rgb, toRgb: S.frame?.rgb };
}

function sweepStep(now) {
  const sw = S.sweep;
  // The two maps, refreshed as the pattern moves (in OKLab, so blends never dip through grey).
  // (Without a GPU the maps are computed in JavaScript: the old one once, the new one less often.)
  if (now - sw.at > (S.lite ? 600 : 120)) {
    sw.at = now;
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
    if (!sw.a || !S.lite) sw.a = toLab(first && sw.fromRgb ? sw.fromRgb : paint.frame(S.pt, sw.from).rgb);
    sw.b = toLab(first && sw.toRgb ? sw.toRgb : S.frame.rgb);
  }
  const el = now - sw.t0 - sw.lag;
  const th = paintThreshold();
  for (const c of board.cells) {
    // (A switch mid-flip finishes first; one only waiting to drift can be taken by the front.)
    if (!isPaint(c.abs) || c.anim) continue;
    const i = c.i;
    const k = i * 3;
    const x = Math.min(1, Math.max(0, (el - sw.tau[i]) / SWEEP_BAND));
    const w = x * x * (3 - 2 * x);
    const inBand = x > 0 && x < 1;
    const [r, g, b] = labToRgb(sw.a[k] + (sw.b[k] - sw.a[k]) * w, sw.a[k + 1] + (sw.b[k + 1] - sw.a[k + 1]) * w, sw.a[k + 2] + (sw.b[k + 2] - sw.a[k + 2]) * w);
    const d2 = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
    const regap = w >= 0.5 && c.gap && c.gap !== sw.gapTo;
    if (c.q.length && !inBand && !regap) continue; // (already due to drift)
    // In the band the colours move fast: a coarser step keeps it to one or two flips.
    if (d2 > (inBand ? 1.5 * th : th) ** 2 || regap) {
      c.r = r;
      c.g = g;
      c.b = b;
      const atFront = inBand || regap;
      // (Ahead of the front, drift flips are kept short so the front never waits on one; behind
      // it they are the ordinary drift, so handing back to paintStep shows no seam.)
      const drift = x === 0 ? { delay: rand() * 250, dur: 320 + rand() * 120 } : { delay: rand() * 500, dur: 440 + rand() * 240 };
      board.flip(c, solid(rgbHex(r, g, b)), atFront ? { dur: FLIP_DUR, gap: w >= 0.5 ? sw.gapTo : null } : drift);
      // Every switch turns over at the front; leave each a random way towards its next drift
      // flip (as in steady drift), so they don't all come due again together.
      if (atFront && w >= 0.5) staggerMemory(c, k);
    }
  }
  if (el > sw.end) {
    S.sweep = null;
    for (const c of board.cells) c.gap = null;
    board.redrawAll();
    paintStep(now); // the ordinary drift carries straight on
  }
}

// ---------------------------------------------------------------------------
// Brush: pressing and dragging flips nearby switches through colours, then they return.
// Over a section, the section quietly becomes switches of itself while it is being brushed.

const HOLD_MS = 200; // press this long without moving (or drag) to start painting
const RESPLASH_MS = 420; // a still, held pointer keeps re-painting its patch

const brushBoxes = new Map(); // element -> { ready, cells, waiting }
const brushable = () => [headerEl(), footerEl(), morphBox()].filter((el) => el && el !== introEl && !el.closest('[hidden]'));
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
/** Put a section into switch mode (once); calls back when its switches are on the board. */
function brushBox(el, then) {
  let st = brushBoxes.get(el);
  if (st) return st.ready ? then() : st.waiting.push(then);
  st = { ready: false, cells: new Set(), waiting: [then] };
  brushBoxes.set(el, st);
  snapshot(el).then((shot) => {
    if (brushBoxes.get(el) !== st || !shot) return brushBoxes.delete(el);
    S.brushMap ||= new Map();
    for (const [i, f] of slicesOf(shot, cardBg(el))) {
      S.brushMap.set(i, f);
      st.cells.add(i);
    }
    retarget([...st.cells], null, () => true);
    for (const i of st.cells) board.setEdges(i, 0);
    el.style.opacity = '0'; // still receives clicks; the switches show it
    st.ready = true;
    for (const f of st.waiting.splice(0)) f();
  });
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
function brushPath() {
  const pal = scheme().brush;
  const c = () => solid(pick(pal));
  return [c(), { f: c(), w: 220 + rand() * 260 }, ...Array.from({ length: randInt(1, 3) }, c)];
}

function splash(i, again = false) {
  const col = i % board.cols;
  const row = (i / board.cols) | 0;
  const now = performance.now();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr && dc && rand() < 0.5) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= board.rows || c >= board.cols) continue;
      const j = r * board.cols + c;
      const s = board.cells[j];
      if (now - s.splash < 200 || (again && board.busy(s))) continue;
      s.splash = now;
      const delay = (Math.abs(dr) + Math.abs(dc)) * 25;
      const box = boxAtCell(j);
      if (box) {
        brushBox(box, () => board.flip(s, concrete(s.abs, s.i), { delay: delay + 50, steps: brushPath(), stepDur: 85, dur: 190, edgesIn: 50, edgesOut: 110 }));
        continue;
      }
      if (isPaint(s.abs)) rememberPaint(s);
      board.flip(s, concrete(s.abs, s.i), { delay, steps: brushPath(), stepDur: 85, dur: 190 });
    }
  }
}

/** Every cell on the line between two cells, so fast strokes leave no gaps. */
function* cellsBetween(a, b) {
  let x0 = a % board.cols;
  let y0 = (a / board.cols) | 0;
  const x1 = b % board.cols;
  const y1 = (b / board.cols) | 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    yield y0 * board.cols + x0;
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function startPainting(b) {
  if (b.painting || S.brush !== b || b.noPaint) return;
  b.painting = true;
  S.paintedAt = Infinity; // (a paint stroke's release isn't a pulse click)
  clearTimeout(b.timer);
  document.documentElement.classList.add('painting');
  document.getSelection()?.removeAllRanges();
  if (b.last >= 0) splash(b.last);
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

function startBrush(e) {
  dropBrush();
  const b = { id: e.pointerId, x: e.clientX, y: e.clientY, last: board.cellAt(e.clientX, e.clientY), painting: false, moved: false, lastSplash: 0, t0: performance.now() };
  // On a touch screen, a press on a card with parts may be a flick: don't paint straight away.
  b.flick = e.pointerType !== 'mouse' && !!e.target.closest?.('section.paged');
  // The brush paints only while its button is on (and never with reduced motion); a press
  // still counts when it might be a flick on a card, which turns the card's part.
  b.noPaint = !S.brushOn || reduce.matches;
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
  if (b.painting && i >= 0 && i !== b.last) {
    if (b.last >= 0) for (const j of cellsBetween(b.last, i)) splash(j);
    else splash(i);
    b.lastSplash = performance.now();
  }
  if (i >= 0) b.last = i;
  return true;
}

// ---------------------------------------------------------------------------
// Input

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.isPrimary) return;
  if (S.key === 'intro') return enter({ x: e.clientX, y: e.clientY });
  startBrush(e);
});
// On the sections a press-and-hold (or drag) paints too; clicks on links and buttons work as usual.
source.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.isPrimary || e.target.closest('button')) return;
  // Links work as usual, except that a touch on a card with parts may also be a flick.
  if (e.target.closest('a') && (e.pointerType === 'mouse' || !e.target.closest('section.paged'))) return;
  if (S.key === 'intro') return enter({ x: e.clientX, y: e.clientY });
  startBrush(e);
});
for (const el of [canvas, source]) {
  el.addEventListener('pointermove', (e) => {
    if (e.isPrimary && brushMove(e) && S.brush?.painting) e.preventDefault();
  });
  for (const type of ['pointerup', 'pointercancel']) {
    el.addEventListener(type, (e) => {
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
      dropBrush();
    });
  }
}
canvas.addEventListener('lostpointercapture', (e) => S.brush && S.brush.id === e.pointerId && dropBrush());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
// (Temporary, while choosing: window or plain sections.)
cardToggle.setAttribute('aria-pressed', String(look.card !== 'plain'));
cardToggle.addEventListener('click', () => {
  const order = ['window', 'plain', 'console'];
  look.card = order[(order.indexOf(look.card) + 1) % order.length];
  saveLook(look);
  options.render();
  onLookChange('card');
});
// (Temporary, while choosing.) The switch flip style, and the colour pulse.
const flipToggle = $('#flip-toggle');
const pulseToggle = $('#pulse-toggle');
const flipNames = { fall: 'Classic', settle: 'Settle', crisp: 'Crisp' };
const showFlip = () => ($('.ft-v', flipToggle).textContent = flipNames[look.flip]);
showFlip();
flipToggle.addEventListener('click', () => {
  const order = Object.keys(flipNames);
  look.flip = order[(order.indexOf(look.flip) + 1) % order.length];
  saveLook(look);
  options.render();
  onLookChange('flip');
});
pulseToggle.addEventListener('click', () => {
  S.pulseOn = !S.pulseOn;
  pulseToggle.setAttribute('aria-pressed', String(S.pulseOn));
  $('.ft-v', pulseToggle).textContent = S.pulseOn ? 'On' : 'Off';
});
// With the pulse on, a click on the board (not a drag or paint stroke) moves the page to its
// next colour combo, rippling out from the click.
canvas.addEventListener('click', (e) => {
  if (!S.pulseOn || S.key === 'intro' || performance.now() - (S.paintedAt || 0) < 300) return;
  pulseCombo({ x: e.clientX, y: e.clientY });
});
brushToggle.addEventListener('click', () => {
  S.brushOn = !S.brushOn;
  brushToggle.setAttribute('aria-pressed', String(S.brushOn));
  document.documentElement.classList.toggle('brush-on', S.brushOn);
  if (!S.brushOn) dropBrush();
});

const options = mountOptions(look, onLookChange);

window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'd' || e.key === 'D') {
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

const keyFromHash = () => {
  const h = location.hash.slice(1);
  return pages.some((p) => p.id === h) ? h : null;
};
window.addEventListener('popstate', () => go(keyFromHash() || 'intro', { push: false }));

/** A design option changed (from the review panel). */
/** Window or plain sections: the visible card flips across to the other style in a wave. */
function switchCards() {
  cardToggle.setAttribute('aria-pressed', String(look.card !== 'plain'));
  if (S.key === 'intro' || !board.cells.length) {
    applyLook();
    return layoutWeb();
  }
  webGo(
    () => {
      if (themeWanted()) applyTheme(S.wantDark);
      applyLook();
      syncDom();
    },
    { dir: 1, toKey: S.key, origin: centreOf(cardToggle) },
  );
}

/** The board ripples from `origin` into the page's next colour combo. */
function pulseCombo(origin) {
  const page = S.key;
  const n = COMBOS[page]?.length || 1;
  const sweepFrom = scheme();
  const gapFrom = board.gapColor;
  const fromFrame = S.frame;
  setCombo(page, (comboOf(page) + 1) % n);
  applyColours();
  retintGutter();
  S.frame = paint.frame(S.pt, scheme());
  startSweep(sweepFrom, motionField('ripple', 1, origin), -SWEEP_BAND / 2, gapFrom, fromFrame);
  schedulePrefetch();
}

async function onLookChange(key) {
  if (key === 'flip') return showFlip(), applyLook();
  if (key === 'card') return switchCards();
  cancelWeb();
  applyLook();
  shotCache.clear();
  if (key === 'font') await document.fonts.load(`700 64px ${getComputedStyle(document.documentElement).getPropertyValue('--display')}`).catch(() => {});
  if (key === 'palette') board.gapColor = gutter(S.dark, look, S.key);
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
  const b = S.brush;
  if (b && b.painting && b.last >= 0 && now - b.lastSplash >= RESPLASH_MS) {
    splash(b.last, true);
    b.lastSplash = now;
  }
  board.tick(now);
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

async function start() {
  S.lite = paint.lite;
  if (S.lite) document.documentElement.dataset.lite = '';
  applyLook();
  await Promise.all([
    document.fonts.load('400 13px "IBM Plex Mono"'),
    document.fonts.load('500 13px "IBM Plex Mono"'),
    document.fonts.load('600 13px "IBM Plex Mono"'),
    document.fonts.load(`700 64px ${getComputedStyle(document.documentElement).getPropertyValue('--display')}`),
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
