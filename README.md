# Joshua Newbould — personal website

A personal research site built on an airport split-flap board. Behind the page a grid of
identical flaps shows a slowly moving painted background; the content sits in clean web
sections on top. When you change page or theme, the sections turn into flaps, flip over in a
wave and become web sections again.

## Run it locally

ES modules need a web server (opening `index.html` from disk shows the plain fallback page).
`serve.py` is a tiny static server that stops browsers caching stale copies while you edit:

```sh
python3 serve.py 8420
```

Then open <http://localhost:8420/>.

## Editing content

All content lives in `index.html` inside `#source`. Screen readers and visitors without
JavaScript read it directly.

- **Title screen**: `#intro` (name and role). The `<h1>`'s `data-short` is the short form used on
  very small screens.
- **Pages** are the `<section data-page>` elements: `data-big` is the large title,
  `data-label` the small index label, and each `<p data-strip>` a line under the title.
- **Publications**: one `<li>` per paper with `data-year` and `data-status`
  (`Oral`, `Published`, …).
- **Footer**: the copyright line and the previous/next buttons, labelled automatically.

## Design

Settled: a hairline header and footer with a numbered nav, Inter Tight titles, console-style
sections (an inverted title strip and a `>_` status line, on the title screen too) and a crisp
split-flap fall.

Still open, each with a default and two alternatives in `js/design.js`:

| Decision | Options (default first) |
| --- | --- |
| Palette | Mineral · Graphite · Nebula |
| Background | Silk · Contour · Drift |
| Transition | Sweep · Ripple · Cascade |

Press **D** (or open `?design`) for a panel to switch them live, or set them in the URL, e.g.
`?palette=graphite&bg=contour&motion=ripple`. The choice is remembered in the browser. To settle
on one for good, change `DEFAULT_LOOK` in `js/design.js`.

With the Mineral palette each page also has three colour combos (`COMBOS`): a click on the
background ripples into the next one. Holding or dragging on the background paints it with a
character brush instead (the sections, bars and title window sit on top and aren't painted).

The header (and the title window) has an ASCII mode (`>_`), which turns the background into
coloured characters on finer switches.

Colours are built in OKLCH, so lightness and colourfulness stay even across each page's hue
(by default About apricot, Research indigo, Publications fuchsia, Contact lagoon), held in a soft band
of lightness in both themes; the title screen is cool silver and white.

## How it works

| File | Role |
| --- | --- |
| `js/board.js` | The canvas board: identical flaps, flip animation, timing and gutters |
| `js/paint.js` | The background (three modes): a WebGL shader, or the same field in JavaScript without a GPU |
| `js/design.js` | Colour schemes, the design variations and the options panel |
| `js/main.js` | Layout and parts, section snapshots, transitions, theme switch, brush and input |
| `css/style.css` | The web layer: typography, cards, header/footer variants, phone layout |

Sections are laid out on the flap grid and never scroll. A card that doesn't fit is first
set a little smaller; if that isn't enough it is split into numbered parts (‹ 1 / 3 ›), which
flip like pages: use the arrows on the card, the mouse wheel over it, the Up/Down keys, or a
quick flick on a touch screen. Switch size follows the screen, so phones get many small
switches and plenty of board around a smaller card.

Without a usable GPU (software WebGL, or frames that can't keep up) the site runs lighter: the
background is computed in JavaScript at one sample per switch, switches are a little bigger,
and the board redraws at a lower resolution.

For a transition each visible section is rendered to an image (an SVG `foreignObject`
with the page's own CSS and fonts), cut into one slice per flap and flipped in a wave; the
header and footer change colour continuously with the wave front. Snapshots are prefetched
while the page is idle, so a click starts flipping within a frame or two.

Use the header nav, the footer ‹ › buttons or the arrow keys to move between pages. Any
click or key on the title screen enters (clicking the name in the header returns to it).
Turn on the brush button in the header, then press and hold (or drag) anywhere to paint flaps; they drift back on their own. The sun/moon
switch ripples between light and dark. Reduced-motion preferences are respected.

## Credits

Fonts: IBM Plex Mono, Space Grotesk, Inter Tight and Chakra Petch (SIL Open Font License),
self-hosted in `assets/fonts`.
