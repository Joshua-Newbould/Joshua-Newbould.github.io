// The design system: colour schemes built in OKLCH (so lightness and colourfulness stay even
// across hues), plus three variations for each open design decision. The chosen "look" is kept
// in localStorage and can be set from the URL (e.g. ?palette=graphite&bg=drift) or, while the
// options are under review, from a small panel opened with the D key or ?design.

export const DECISIONS = {
  palette: { label: 'Palette', options: { mineral: 'Mineral', graphite: 'Graphite', nebula: 'Nebula' } },
  bg: { label: 'Background', options: { silk: 'Silk', contour: 'Contour', drift: 'Drift' } },
  motion: { label: 'Transition', options: { sweep: 'Sweep', ripple: 'Ripple', cascade: 'Cascade' } },
};

// Settled by the owner (16 October 2026): hairline header and footer (with the frame style's
// numbered nav), Inter Tight titles, console sections; the switches' crisp fall is built in.
const SETTLED = { chrome: 'hairline', font: 'inter', card: 'console' };

export const DEFAULT_LOOK = { palette: 'mineral', bg: 'silk', motion: 'sweep', ...SETTLED };

const valid = (k, v) => DECISIONS[k] && Object.hasOwn(DECISIONS[k].options, v);

export function loadLook() {
  const look = { ...DEFAULT_LOOK };
  try {
    Object.assign(look, JSON.parse(localStorage.getItem('look') || '{}'));
  } catch {}
  const q = new URLSearchParams(location.search);
  for (const k of Object.keys(DECISIONS)) if (q.has(k)) look[k] = q.get(k);
  for (const k of Object.keys(DECISIONS)) if (!valid(k, look[k])) look[k] = DEFAULT_LOOK[k];
  Object.assign(look, SETTLED); // (whatever an earlier visit chose)
  delete look.flip;
  return look;
}

export function saveLook(look) {
  try {
    localStorage.setItem('look', JSON.stringify(look));
  } catch {}
}

// ---------------------------------------------------------------------------
// OKLCH → sRGB hex

const toByte = (v) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

export function oklch(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return '#' + [r, g, bl].map((v) => toByte(v).toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Schemes

// Each page's hue identity (degrees, OKLCH).
// Each page's base hue (its card tint and accent), spread round the colour wheel.
const PAGE_HUE = { about: 48, research: 268, publications: 335, contact: 192 };

// Each page's colour combos for the board (Mineral palette): a default and two alternatives,
// each an arc round the colour wheel. A click on the board (with the pulse on) moves to the
// next one.
export const COMBOS = {
  about: [{ name: 'Apricot', arc: [25, 75] }, { name: 'Sunset', arc: [345, 45] }, { name: 'Flare', arc: [300, 40] }],
  research: [{ name: 'Indigo', arc: [245, 290] }, { name: 'Ultramarine', arc: [215, 260] }, { name: 'Twilight', arc: [270, 320] }],
  publications: [{ name: 'Fuchsia', arc: [310, 360] }, { name: 'Rose', arc: [330, 20] }, { name: 'Orchid', arc: [285, 335] }],
  contact: [{ name: 'Lagoon', arc: [170, 215] }, { name: 'Aurora', arc: [175, 290] }, { name: 'Prism', arc: [190, 330] }],
};
const combo = (() => {
  try {
    return { about: 0, research: 0, publications: 0, contact: 0, ...JSON.parse(localStorage.getItem('combos') || '{}') };
  } catch {
    return { about: 0, research: 0, publications: 0, contact: 0 };
  }
})();
export const comboOf = (page) => combo[page] ?? 0;
export function setCombo(page, k) {
  combo[page] = k;
  try {
    localStorage.setItem('combos', JSON.stringify(combo));
  } catch {}
}
const arcOf = (page) => COMBOS[page]?.[comboOf(page)]?.arc;
const arcMid = ([a, b]) => (a + ((b - a + 360) % 360) / 2) % 360;
/** The hue a page's board centres on (its combo's middle). */
export const boardHue = (page, look) => (page === 'intro' || !(page in PAGE_HUE) ? 255 : look.palette === 'mineral' && arcOf(page) ? arcMid(arcOf(page)) : PAGE_HUE[page]);

/** A combo's six pigments: along its arc and back (so neighbours always blend cleanly). */
function comboPigments([a, b], dark) {
  const span = (b - a + 360) % 360;
  const hues = [0, 1 / 3, 2 / 3, 1, 2 / 3, 1 / 3].map((f) => (a + span * f) % 360);
  const L = dark ? [0.42, 0.48, 0.54, 0.46, 0.58, 0.38] : [0.76, 0.81, 0.86, 0.8, 0.89, 0.73];
  const C = dark ? [0.1, 0.1, 0.09, 0.11, 0.08, 0.1] : [0.1, 0.095, 0.085, 0.11, 0.07, 0.105];
  return hues.map((h, k) => {
    // Warm hues go brown when dark: they keep a lighter, clearer tone, the more so the
    // nearer they are to yellow (an orange or gold below about L 0.7 reads as ochre).
    if (!dark) return oklch(L[k], C[k], h);
    // A weight rising smoothly from plum (330) to red (0) and falling from orange (70) to
    // yellow-green (110): warm colours are lifted towards L 0.58 and nudged towards coral.
    const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const hu = h >= 330 ? h - 360 : h; // -30 … 330
    const w = sm((hu + 30) / 30) * (1 - sm((hu - 70) / 40));
    const hh = h - w * Math.min(20, Math.max(0, hu - 30));
    return oklch(L[k] + w * (0.58 - L[k]) * 0.8, C[k] + 0.04 * w, hh);
  });
}

// Per palette: the hue the neutrals lean towards, and how each page's paint is built.
const PALETTES = {
  // Per-page families of clean colour (rose, blue, violet, sea green): clearly coloured, never
  // brown or grey, and held in a narrow band of lightness so the board is soft on the eyes.
  mineral: {
    neutral: (h) => h,
    pigments(h, dark) {
      // Warm hues (apricot, coral) go brown when dark, so a warm page keeps a lighter, clearer
      // band in dark mode than the cool pages do.
      const warm = h > 15 && h < 100;
      const hues = warm ? (dark ? [h - 20, h - 12, h - 2, h + 6, h - 16, h] : [h - 14, h - 4, h + 6, h + 16, h - 9, h + 11]) : [h - 18, h - 6, h + 6, h + 18, h - 12, h + 12];
      const L = dark
        ? warm ? [0.6, 0.65, 0.7, 0.57, 0.62, 0.68] : [0.4, 0.45, 0.5, 0.37, 0.43, 0.48]
        : warm ? [0.77, 0.82, 0.87, 0.9, 0.8, 0.85] : [0.74, 0.79, 0.84, 0.87, 0.77, 0.82];
      const C = dark
        ? warm ? [0.125, 0.12, 0.1, 0.11, 0.12, 0.1] : [0.075, 0.08, 0.075, 0.06, 0.07, 0.065]
        : warm ? [0.095, 0.09, 0.08, 0.065, 0.095, 0.075] : [0.085, 0.08, 0.075, 0.06, 0.085, 0.07];
      return hues.map((x, k) => oklch(L[k], C[k], x));
    },
  },
  // Near-neutral graphite with a single quiet note of the page's hue.
  graphite: {
    neutral: (h, dark) => (dark ? 255 : 75),
    pigments(h, dark) {
      const n = dark ? 255 : 75;
      const L = dark ? [0.2, 0.24, 0.29, 0.34, 0.26, 0.17] : [0.78, 0.84, 0.9, 0.95, 0.86, 0.72];
      const out = L.map((l) => oklch(l, 0.014, n));
      out[3] = oklch(dark ? 0.38 : 0.8, dark ? 0.08 : 0.085, h);
      out[1] = oklch(dark ? 0.27 : 0.86, dark ? 0.04 : 0.04, h + 20);
      return out;
    },
  },
  // Cool, deep-space tones shared by every page; the page hue appears as one pigment.
  nebula: {
    neutral: () => 270,
    pigments(h, dark) {
      const hues = [265, 290, 235, 205, h, 250];
      const L = dark ? [0.23, 0.29, 0.35, 0.31, 0.37, 0.18] : [0.8, 0.86, 0.9, 0.84, 0.83, 0.93];
      const C = dark ? [0.1, 0.1, 0.09, 0.085, 0.1, 0.05] : [0.08, 0.075, 0.07, 0.07, 0.085, 0.03];
      return hues.map((x, k) => oklch(L[k], C[k], x));
    },
  },
};

const cache = new Map();

/** The title screen's paint: cool, bright whites and silver greys (gunmetal in the dark). */
function introPigments(palette, dark) {
  const hue = palette === 'graphite' ? (dark ? 255 : 75) : 255;
  const L = dark ? [0.24, 0.31, 0.38, 0.45, 0.28, 0.35] : [0.985, 0.93, 0.87, 0.8, 0.955, 0.9];
  const C = dark ? 0.014 : 0.008;
  return L.map((l) => oklch(l, C, hue));
}

/** The colours for one page (or 'intro') in one theme under a look. */
export function scheme(page, dark, look) {
  const id = [page, dark ? 'd' : 'l', look.palette, comboOf(page)].join('|');
  if (cache.has(id)) return cache.get(id);
  const pal = PALETTES[look.palette];
  const intro = page === 'intro';
  const h = intro ? (look.palette === 'graphite' ? pal.neutral(70, dark) : 255) : PAGE_HUE[page] ?? 60;
  const hs = pal.neutral(h, dark); // hue the neutral surfaces lean towards
  const tint = look.palette === 'graphite' ? 0.006 : 0.012;
  const sc = {
    name: page + (intro ? '' : '#' + comboOf(page)),
    pigments: intro ? introPigments(look.palette, dark) : look.palette === 'mineral' && arcOf(page) ? comboPigments(arcOf(page), dark) : pal.pigments(h, dark),
    surface: dark ? oklch(0.205, tint, hs) : oklch(0.975, tint * 0.6, hs),
    bar: dark ? oklch(0.175, tint, hs) : oklch(0.955, tint * 0.8, hs),
    line: dark ? oklch(0.32, tint * 1.2, hs) : oklch(0.88, tint * 1.2, hs),
    text: dark ? oklch(0.94, 0.01, hs) : oklch(0.24, 0.02, hs),
    soft: dark ? oklch(0.82, 0.012, hs) : oklch(0.38, 0.02, hs),
    muted: dark ? oklch(0.66, 0.012, hs) : oklch(0.52, 0.015, hs),
    accent: intro ? (dark ? oklch(0.8, 0.02, hs) : oklch(0.4, 0.02, hs)) : dark ? oklch(0.8, 0.1, h) : oklch(0.5, 0.12, h),
    // A gentle relief on the paint; brighter highlights read as glare on dark backgrounds.
    spec: dark ? 0.08 : 0.14,
    relief: 0.22,
  };
  // Brush colours: the page's hues nudged round the wheel, a touch more colourful, never white.
  sc.brush = intro
    ? [[0.6, 0.02, 255], [0.72, 0.02, 255], [0.62, 0.09, 245], [0.7, 0.11, 25]].map(([l, c, x]) => oklch(dark ? l - 0.08 : l, c, x)) // greys, a steel blue, a signal red
    : [-20, -8, 4, 14].map((d) => oklch(dark ? 0.56 : 0.68, look.palette === 'graphite' ? 0.07 : 0.09, h + d)); // the page's own hues
  cache.set(id, sc);
  return sc;
}

/** Gutter colour between switches: a quiet tint of the page's own colour (neutral for Graphite). */
export const gutter = (dark, look, page = 'intro') => {
  if (look.palette === 'graphite') {
    const hs = PALETTES.graphite.neutral(70, dark);
    return dark ? oklch(0.13, 0.01, hs) : oklch(0.66, 0.012, hs);
  }
  if (page === 'intro' || !(page in PAGE_HUE)) return dark ? oklch(0.15, 0.01, 255) : oklch(0.76, 0.01, 255);
  const h = boardHue(page, look);
  // Light: a clear tint of the page's colour (warm combos take their warmer end, so the lines
  // read coral rather than khaki), a step darker than the lightest paint.
  const hl = look.palette === 'mineral' && arcOf(page) && h > 15 && h < 110 ? arcOf(page)[0] : h;
  return dark ? oklch(0.15, 0.025, h) : oklch(0.72, 0.055, hl);
};

/** Which shader the background uses. */
export const bgMode = (look) => ({ silk: 0, contour: 1, drift: 2 })[look.bg];

// ---------------------------------------------------------------------------
// Options panel (for reviewing the variations)

export function mountOptions(look, onChange) {
  const panel = document.createElement('div');
  panel.id = 'design-options';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Design options');
  panel.hidden = true;
  const render = () => {
    panel.replaceChildren();
    const title = Object.assign(document.createElement('p'), { className: 'do-title', textContent: 'Design options' });
    const hint = Object.assign(document.createElement('p'), { className: 'do-hint', textContent: 'D to close' });
    panel.append(title, hint);
    for (const [key, d] of Object.entries(DECISIONS)) {
      const row = document.createElement('div');
      row.className = 'do-row';
      row.append(Object.assign(document.createElement('span'), { textContent: d.label }));
      for (const [value, name] of Object.entries(d.options)) {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: name });
        b.setAttribute('aria-pressed', String(look[key] === value));
        b.dataset.opt = key + ':' + value;
        b.addEventListener('click', () => {
          if (look[key] === value) return;
          look[key] = value;
          saveLook(look);
          render();
          // Keep keyboard focus on the option just chosen (the panel was rebuilt).
          panel.querySelector(`[data-opt="${key}:${value}"]`)?.focus();
          onChange(key);
        });
        row.append(b);
      }
      panel.append(row);
    }
  };
  render();
  document.body.append(panel);
  const toggle = (show = panel.hidden) => {
    panel.hidden = !show;
  };
  if (new URLSearchParams(location.search).has('design')) toggle(true);
  return { toggle, render };
}
