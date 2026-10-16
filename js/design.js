// The design system: colour schemes built in OKLCH (so lightness and colourfulness stay even
// across hues), from palettes defined as data below. The chosen palette is kept in localStorage
// and can be set from the URL (e.g. ?palette=mineral) or from a small panel opened with the D key
// or ?design.

export const DECISIONS = {
  palette: { label: 'Palette', options: {} }, // (filled from PALETTES below)
};
/** The page transition, chosen by the visitor in the footer. */
export const MOTIONS = { sweep: 'Sweep', ripple: 'Ripple' };

// Settled by the owner (16 October 2026): hairline header and footer (with the frame style's
// numbered nav), Inter Tight titles, console sections, the silk background; the switches' crisp
// fall is built in.
const SETTLED = { chrome: 'hairline', font: 'inter', card: 'console', bg: 'silk' };

export const DEFAULT_LOOK = { palette: 'jewel', motion: 'sweep', ...SETTLED };

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
  if (!Object.hasOwn(MOTIONS, look.motion)) look.motion = DEFAULT_LOOK.motion;
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

// ---------------------------------------------------------------------------
// Palettes, as data. For each page, three colour combos (the first is the default; a click on the
// board moves to the next), each an arc round the colour wheel the board's paint is drawn from.
// Each theme sets the paint's lightness and colourfulness (six pigments: along the arc and back),
// and the accent, gutter and brush tones; a combo or page may override any of those.
//
//   { label, pages: { about: [combo, combo, combo], research, publications, contact },
//     light: theme, dark: theme, warmLift?: true, tint?: 0.012 }
//   combo: { name, arc: [from°, to°], light?: theme part, dark?: theme part }
//   theme: { L: [6], C: [6], accent: [L, C], gutter: [L, C], brush: [L, C] }

export const PALETTES = {
  // Deep, saturated gemstone tones, a family per page (ruby, sapphire, amethyst, emerald): bold and
  // rich but calm enough to sit on; real colour in light, glowing out of the dark in dark.
  jewel: {
    label: 'Jewel',
    warmLift: true,
    tint: 0.014,
    pages: {
      about: [
        { name: 'Ruby', arc: [358, 22], light: { L: [0.46, 0.52, 0.59, 0.49, 0.64, 0.43], C: [0.17, 0.165, 0.15, 0.17, 0.125, 0.165] }, dark: { L: [0.32, 0.38, 0.44, 0.36, 0.48, 0.3], C: [0.14, 0.15, 0.14, 0.15, 0.13, 0.14] } },
        { name: 'Fire opal', arc: [56, 76], light: { L: [0.68, 0.73, 0.79, 0.78, 0.84, 0.66], C: [0.17, 0.16, 0.14, 0.16, 0.12, 0.17], accent: [0.5, 0.16], gutter: [0.55, 0.13] }, dark: { L: [0.84, 0.87, 0.9, 0.85, 0.92, 0.82], C: [0.13, 0.13, 0.12, 0.13, 0.11, 0.13], accent: [0.82, 0.12] } },
        { name: 'Padparadscha', arc: [10, 42], light: { L: [0.66, 0.71, 0.78, 0.72, 0.83, 0.63] }, dark: { L: [0.85, 0.88, 0.92, 0.86, 0.95, 0.82], C: [0.1, 0.105, 0.095, 0.105, 0.09, 0.1] } },
      ],
      research: [
        { name: 'Sapphire', arc: [236, 262] },
        { name: 'Aquamarine', arc: [212, 246], dark: { L: [0.43, 0.5, 0.57, 0.47, 0.61, 0.39] } },
        { name: 'London blue', arc: [236, 262], light: { L: [0.47, 0.53, 0.61, 0.5, 0.67, 0.44], C: [0.15, 0.15, 0.14, 0.15, 0.12, 0.14] }, dark: { L: [0.33, 0.4, 0.48, 0.37, 0.53, 0.3] } },
      ],
      publications: [
        { name: 'Amethyst', arc: [292, 320] },
        { name: 'Tourmaline', arc: [308, 342] },
        { name: 'Iolite', arc: [280, 306], light: { L: [0.52, 0.58, 0.65, 0.55, 0.7, 0.48] } },
      ],
      contact: [
        { name: 'Emerald', arc: [155, 182] },
        { name: 'Jade', arc: [172, 205] },
        { name: 'Tsavorite', arc: [158, 172], light: { L: [0.63, 0.69, 0.76, 0.66, 0.81, 0.59], C: [0.14, 0.14, 0.13, 0.14, 0.11, 0.14] }, dark: { L: [0.5, 0.56, 0.62, 0.53, 0.66, 0.47], C: [0.125, 0.125, 0.12, 0.125, 0.11, 0.12] } },
      ],
    },
    light: { L: [0.55, 0.61, 0.68, 0.58, 0.73, 0.51], C: [0.15, 0.14, 0.125, 0.15, 0.105, 0.15], accent: [0.45, 0.15], gutter: [0.46, 0.09], brush: [0.5, 0.16] },
    dark: { L: [0.4, 0.47, 0.54, 0.44, 0.58, 0.36], C: [0.13, 0.14, 0.13, 0.14, 0.12, 0.12], accent: [0.78, 0.12], gutter: [0.13, 0.035], brush: [0.58, 0.15] },
  },
  // A modernist identity system: each page owns one strong colour family in a tight arc, so it reads
  // as one confident poster colour (vermilion, ultramarine, magenta, signal green).
  signal: {
    label: 'Signal',
    warmLift: true,
    tint: 0.014,
    pages: {
      about: [
        { name: 'Vermilion', arc: [20, 46], dark: { C: [0.125, 0.125, 0.11, 0.13, 0.105, 0.125] } },
        { name: 'Scarlet', arc: [4, 26], dark: { C: [0.14, 0.14, 0.13, 0.145, 0.125, 0.14] } },
        { name: 'Signal Orange', arc: [48, 68], light: { L: [0.7, 0.74, 0.78, 0.765, 0.8, 0.69], C: [0.125, 0.12, 0.11, 0.11, 0.1, 0.125] }, dark: { L: [0.42, 0.49, 0.57, 0.46, 0.61, 0.39], C: [0.115, 0.115, 0.105, 0.12, 0.1, 0.115] } },
      ],
      research: [
        { name: 'Ultramarine', arc: [250, 274] },
        { name: 'Azure', arc: [222, 248] },
        { name: 'Cobalt', arc: [242, 266], light: { L: [0.55, 0.6, 0.66, 0.575, 0.69, 0.52] }, dark: { L: [0.33, 0.4, 0.48, 0.37, 0.52, 0.3] } },
      ],
      publications: [
        { name: 'Magenta', arc: [320, 348] },
        { name: 'Rose', arc: [332, 356], light: { L: [0.59, 0.64, 0.7, 0.615, 0.73, 0.56] }, dark: { C: [0.11, 0.11, 0.1, 0.115, 0.095, 0.11] } },
        { name: 'Purple', arc: [302, 330] },
      ],
      contact: [
        { name: 'Signal Green', arc: [154, 174], light: { accent: [0.45, 0.15] }, dark: { L: [0.56, 0.58, 0.63, 0.53, 0.66, 0.54], C: [0.105, 0.115, 0.11, 0.125, 0.1, 0.105] } },
        { name: 'Teal', arc: [168, 196], light: { accent: [0.45, 0.15] } },
        { name: 'Petrol', arc: [190, 218], light: { accent: [0.45, 0.15] } },
      ],
    },
    light: { L: [0.63, 0.68, 0.74, 0.655, 0.77, 0.6], C: [0.145, 0.14, 0.13, 0.15, 0.12, 0.145], accent: [0.48, 0.16], gutter: [0.56, 0.1], brush: [0.56, 0.15] },
    dark: { L: [0.38, 0.45, 0.53, 0.42, 0.57, 0.35], C: [0.125, 0.125, 0.115, 0.13, 0.11, 0.125], accent: [0.79, 0.12], gutter: [0.17, 0.035], brush: [0.52, 0.13] },
  },
  // Luminous, slightly sci-fi light: each page sweeps across neighbouring hues like an aurora
  // (coral to rose, azure to violet, orchid to magenta, jade to cyan).
  spectra: {
    label: 'Spectra',
    warmLift: true,
    pages: {
      about: [
        { name: 'Solar', arc: [5, 55], light: { accent: [0.52, 0.165], L: [0.62, 0.68, 0.74, 0.69, 0.77, 0.59] }, dark: { L: [0.47, 0.54, 0.64, 0.68, 0.67, 0.46], C: [0.1, 0.1, 0.09, 0.085, 0.08, 0.09] } },
        { name: 'Corona', arc: [15, 62], light: { accent: [0.52, 0.16], L: [0.62, 0.68, 0.74, 0.69, 0.77, 0.59], C: [0.155, 0.15, 0.14, 0.145, 0.125, 0.155] }, dark: { L: [0.52, 0.62, 0.9, 0.98, 0.92, 0.58], C: [0.1, 0.095, 0.085, 0.085, 0.08, 0.09] } },
        { name: 'Flare', arc: [0, 40], light: { accent: [0.52, 0.17], L: [0.62, 0.68, 0.74, 0.69, 0.77, 0.59] }, dark: { L: [0.44, 0.5, 0.57, 0.48, 0.62, 0.41], C: [0.12, 0.12, 0.11, 0.13, 0.1, 0.11] } },
      ],
      research: [
        { name: 'Nebula', arc: [216, 256], light: { L: [0.56, 0.63, 0.7, 0.6, 0.74, 0.53], C: [0.16, 0.155, 0.145, 0.165, 0.13, 0.16] }, dark: { L: [0.4, 0.47, 0.55, 0.44, 0.59, 0.37], C: [0.14, 0.14, 0.13, 0.15, 0.12, 0.13] } },
        { name: 'Ion', arc: [206, 234] },
        { name: 'Cherenkov', arc: [248, 282] },
      ],
      publications: [
        { name: 'Plasma', arc: [305, 345], light: { C: [0.155, 0.15, 0.135, 0.145, 0.12, 0.155] } },
        { name: 'Nova', arc: [326, 2], light: { C: [0.155, 0.145, 0.125, 0.13, 0.115, 0.155] } },
        { name: 'Pulsar', arc: [284, 318] },
      ],
      contact: [
        { name: 'Aurora', arc: [162, 196], light: { accent: [0.46, 0.13] }, dark: { C: [0.115, 0.115, 0.105, 0.125, 0.095, 0.105] } },
        { name: 'Jade', arc: [153, 178], light: { accent: [0.46, 0.13], L: [0.6, 0.66, 0.72, 0.63, 0.745, 0.57], C: [0.15, 0.15, 0.14, 0.16, 0.13, 0.15] }, dark: { C: [0.13, 0.13, 0.12, 0.14, 0.115, 0.12], L: [0.47, 0.54, 0.61, 0.51, 0.64, 0.43] } },
        { name: 'Borealis', arc: [178, 206], light: { accent: [0.46, 0.13] }, dark: { C: [0.115, 0.115, 0.105, 0.125, 0.095, 0.105] } },
      ],
    },
    light: { L: [0.615, 0.675, 0.735, 0.645, 0.765, 0.58], C: [0.155, 0.15, 0.14, 0.165, 0.125, 0.155], accent: [0.5, 0.15], gutter: [0.62, 0.08], brush: [0.6, 0.13] },
    dark: { L: [0.44, 0.52, 0.6, 0.49, 0.64, 0.4], C: [0.13, 0.13, 0.12, 0.14, 0.11, 0.12], accent: [0.82, 0.12], gutter: [0.15, 0.03], brush: [0.6, 0.12] },
  },
  // Per-page families of clean colour (apricot, indigo, fuchsia, lagoon): clearly coloured, never
  // brown or grey, and held in a narrow band of lightness so the board is soft on the eyes.
  mineral: {
    label: 'Mineral',
    warmLift: true,
    pages: {
      about: [{ name: 'Apricot', arc: [25, 75] }, { name: 'Sunset', arc: [345, 45] }, { name: 'Flare', arc: [300, 40] }],
      research: [{ name: 'Indigo', arc: [245, 290] }, { name: 'Ultramarine', arc: [215, 260] }, { name: 'Twilight', arc: [270, 320] }],
      publications: [{ name: 'Fuchsia', arc: [310, 360] }, { name: 'Rose', arc: [330, 20] }, { name: 'Orchid', arc: [285, 335] }],
      contact: [{ name: 'Lagoon', arc: [170, 215] }, { name: 'Aurora', arc: [175, 290] }, { name: 'Prism', arc: [190, 330] }],
    },
    light: { L: [0.76, 0.81, 0.86, 0.8, 0.89, 0.73], C: [0.1, 0.095, 0.085, 0.11, 0.07, 0.105], accent: [0.5, 0.12], gutter: [0.72, 0.055], brush: [0.68, 0.09] },
    dark: { L: [0.42, 0.48, 0.54, 0.46, 0.58, 0.38], C: [0.1, 0.1, 0.09, 0.11, 0.08, 0.1], accent: [0.8, 0.1], gutter: [0.15, 0.025], brush: [0.56, 0.09] },
  },
};

// A palette being designed, to preview (tools/palette): ?palette=draft with localStorage 'palette-draft'.
try {
  const draft = localStorage.getItem('palette-draft');
  if (draft) PALETTES.draft = { label: 'Draft', ...JSON.parse(draft) };
} catch {}

const PAGES = ['about', 'research', 'publications', 'contact'];
const paletteOf = (look) => PALETTES[look.palette] || PALETTES.mineral;
/** A page's colour combos under a look. */
export const combosOf = (page, look) => paletteOf(look).pages[page] || [];

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
const comboFor = (page, look) => {
  const list = combosOf(page, look);
  return list[comboOf(page) % Math.max(1, list.length)];
};
const arcMid = ([a, b]) => (a + ((b - a + 360) % 360) / 2) % 360;
/** The hue a page's board centres on (its combo's middle). */
export const boardHue = (page, look) => {
  const c = PAGES.includes(page) && comboFor(page, look);
  return c ? arcMid(c.arc) : 255;
};
/** One theme's settings for a page: the palette's, with the combo's own on top. */
const themeFor = (page, dark, look) => {
  const pal = paletteOf(look);
  const t = dark ? 'dark' : 'light';
  return { ...pal[t], ...(comboFor(page, look)?.[t] || {}) };
};

/** A combo's six pigments: along its arc and back (so neighbours always blend cleanly). */
function comboPigments([a, b], dark, th, warmLift) {
  const span = (b - a + 360) % 360;
  const hues = [0, 1 / 3, 2 / 3, 1, 2 / 3, 1 / 3].map((f) => (a + span * f) % 360);
  const { L, C } = th;
  return hues.map((h, k) => {
    // Warm hues go brown when dark: they keep a lighter, clearer tone, the more so the
    // nearer they are to yellow (an orange or gold below about L 0.7 reads as ochre).
    if (!dark || !warmLift) return oklch(L[k], C[k], h);
    // A weight rising smoothly from plum (330) to red (0) and falling from orange (70) to
    // yellow-green (110): warm colours are lifted towards L 0.58 and nudged towards coral.
    const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const hu = h >= 330 ? h - 360 : h; // -30 … 330
    const w = sm((hu + 30) / 30) * (1 - sm((hu - 70) / 40));
    const hh = h - w * Math.min(20, Math.max(0, hu - 30));
    return oklch(L[k] + w * (0.58 - L[k]) * 0.8, C[k] + 0.04 * w, hh);
  });
}

for (const [k, p] of Object.entries(PALETTES)) DECISIONS.palette.options[k] = p.label;

const cache = new Map();

/** The title screen's paint: cool, bright whites and silver greys (gunmetal in the dark). */
function introPigments(dark) {
  const L = dark ? [0.24, 0.31, 0.38, 0.45, 0.28, 0.35] : [0.985, 0.93, 0.87, 0.8, 0.955, 0.9];
  return L.map((l) => oklch(l, dark ? 0.014 : 0.008, 255));
}

/** The colours for one page (or 'intro') in one theme under a look. */
export function scheme(page, dark, look) {
  const id = [page, dark ? 'd' : 'l', look.palette, comboOf(page)].join('|');
  if (cache.has(id)) return cache.get(id);
  const pal = paletteOf(look);
  const intro = !PAGES.includes(page);
  const c = intro ? null : comboFor(page, look);
  const h = boardHue(page, look); // the page's hue: its combo's middle (cool blue-grey for the title)
  const th = themeFor(page, dark, look);
  const tint = pal.tint ?? 0.012;
  const sc = {
    name: page + (intro ? '' : '#' + comboOf(page)),
    pigments: intro ? introPigments(dark) : comboPigments(c.arc, dark, th, pal.warmLift),
    surface: dark ? oklch(0.205, tint, h) : oklch(0.975, tint * 0.6, h),
    bar: dark ? oklch(0.175, tint, h) : oklch(0.955, tint * 0.8, h),
    line: dark ? oklch(0.32, tint * 1.2, h) : oklch(0.88, tint * 1.2, h),
    text: dark ? oklch(0.94, 0.01, h) : oklch(0.24, 0.02, h),
    soft: dark ? oklch(0.82, 0.012, h) : oklch(0.38, 0.02, h),
    muted: dark ? oklch(0.66, 0.012, h) : oklch(0.52, 0.015, h),
    accent: intro ? (dark ? oklch(0.8, 0.02, h) : oklch(0.4, 0.02, h)) : oklch(th.accent[0], th.accent[1], h),
    // A gentle relief on the paint; brighter highlights read as glare on dark backgrounds.
    spec: dark ? 0.08 : 0.14,
    relief: 0.22,
  };
  // Brush colours: the page's hues nudged round the wheel, a touch more colourful, never white.
  sc.brush = intro
    ? [[0.6, 0.02, 255], [0.72, 0.02, 255], [0.62, 0.09, 245], [0.7, 0.11, 25]].map(([l, cc, x]) => oklch(dark ? l - 0.08 : l, cc, x)) // greys, a steel blue, a signal red
    : [-20, -8, 4, 14].map((d) => oklch(th.brush[0], th.brush[1], h + d));
  cache.set(id, sc);
  return sc;
}

/** Gutter colour between switches: a quiet tint of the page's own colour. */
export const gutter = (dark, look, page = 'intro') => {
  if (!PAGES.includes(page)) return dark ? oklch(0.15, 0.01, 255) : oklch(0.76, 0.01, 255);
  const c = comboFor(page, look);
  const h = boardHue(page, look);
  const th = themeFor(page, dark, look);
  // (Light: warm combos take their warmer end, so the lines read coral rather than khaki.)
  const hl = !dark && paletteOf(look).warmLift && h > 15 && h < 110 ? c.arc[0] : h;
  return oklch(th.gutter[0], th.gutter[1], hl);
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
