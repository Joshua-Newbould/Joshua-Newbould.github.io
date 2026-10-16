// Two secrets, typed anywhere on the site: the Konami code plays Bad Apple!! on the board, and
// Mortal Kombat's blood code (A B A C A B B) turns the board's colours into coloured characters.

const CODES = {
  konami: ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'],
  abacabb: ['a', 'b', 'a', 'c', 'a', 'b', 'b'],
};
// From which key of a code its keys stop doing their usual job. (Up, Up alone is ordinary use,
// going back through a card's parts; Up, Up, Down is the code.)
const QUIET_FROM = { konami: 3, abacabb: 2 };
const PAUSE_MS = 1500; // a longer pause between keys starts afresh
const LONGEST = Math.max(...Object.values(CODES).map((c) => c.length));

/**
 * Call `handlers[name]()` when a code has been typed. Once a code is clearly under way its keys
 * do nothing else (so the Konami code doesn't flip through pages on the way); before that they
 * do what they normally do.
 */
export function watchCodes(handlers) {
  const typed = [];
  let lastAt = 0;
  addEventListener(
    'keydown',
    (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (e.timeStamp - lastAt > PAUSE_MS) typed.length = 0;
      lastAt = e.timeStamp;
      typed.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      if (typed.length > LONGEST) typed.shift();
      let swallow = false;
      for (const [name, code] of Object.entries(CODES)) {
        // How much of the code the last keys typed spell out (longest match).
        let got = 0;
        for (let n = Math.min(code.length, typed.length); n > 0 && !got; n--) {
          if (code.slice(0, n).every((k, j) => k === typed[typed.length - n + j])) got = n;
        }
        if (got >= QUIET_FROM[name]) swallow = true;
        if (got === code.length) {
          typed.length = 0;
          handlers[name]?.();
        }
      }
      if (swallow) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true, // (before the site's own keys)
  );
}

// ---------------------------------------------------------------------------
// ASCII mode: each switch shows one character, picked by how light its colour is, drawn in that
// colour on a near-black face, like a colour terminal.

const RAMP = '.,:;=+*#%@';

/** The character for a lightness `t` (0 = the darkest colour on the board now, 1 = the lightest). */
export const rampChar = (t) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(t * RAMP.length)))];

/** Rec. 709 luma of an sRGB colour (0–255 channels), close enough to choose a character. */
export const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
