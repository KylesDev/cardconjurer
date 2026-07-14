# Render API — fork-only headless render bridge

**Branch:** `develop` · **File:** `js/fork/renderApi.js`
**Companion doc:** `docs/fork/import-deck-extraction.md` (the engine this reuses).

## 1. What it is

A fork-only browser module that exposes a stable, DOM-scrape-free JS API a
headless-browser driver (Playwright, built separately in the sibling proxsmith
project) calls to render one or many MTG cards to PNG. It is the browser side of
proxsmith's "stage render". There is **no user-facing dialog/confirm** and no file
download — the caller gets base64 PNG + the `.cardconjurer` JSON back as data.

It does **not** reimplement the import/frame/render engine. It reuses the Import
Deck engine (`js/fork/deckImport.js`) and upstream primitives, with new
orchestration that avoids the `confirm()` / progress-bar / download machinery that
`generateDeck()` / `generateSingleCard()` carry.

## 2. Public contract (a driver is built against this — do not change silently)

```js
// Single card. Never throws.
//   -> { ok: true, png_base64: "<base64, no data: prefix>", cardconjurer_json: {...} }
//   -> { ok: false, error: "<message>" }
window.proxsmithRenderCard = async function (spec) { ... }

// Batch. manifest.cards is an array of specs (same shape as `spec`).
// Resolves to an array SAME LENGTH AND ORDER as manifest.cards. Each element:
//   -> { card_code: spec.code, ok: true, png_base64: "...", cardconjurer_json: {...} }
//   -> { card_code: spec.code, ok: false, error: "<message>" }
// One card failing does NOT throw or abort the rest.
window.proxsmithRenderDeck = async function (manifest) { ... }

// true once the module has finished loading (all functions defined).
// Driver: page.waitForFunction(() => window.proxsmithRenderReady === true)
window.proxsmithRenderReady = true;
```

Both entry points share one internal `renderOneCard(spec)`; `proxsmithRenderCard`
calls it once, `proxsmithRenderDeck` loops over `manifest.cards` calling it once per
card sequentially, each wrapped in try/catch.

### `spec` shape (all optional except `name`)

| field | meaning |
|---|---|
| `code` | opaque id, echoed back as `card_code` in batch results; may be absent |
| `name` | **required** — original MTG name, used for the exact-name Scryfall fetch |
| `nickname` | optional — proxy nickname text (used by nickname frames) |
| `frame` | optional — `#autoFrame` dropdown value. If falsy, `autoFrame()` is NOT called (card keeps its import-default frame) |
| `art_data_uri` | optional — `data:image/png;base64,...`; if present, replaces art via `uploadArt(..., 'autoFit')`; if absent, the Scryfall-fetched default art is kept |
| `set_code` | optional — set-symbol code override |

## 3. What it reuses (from `deckImport.js` / `creator-23.js` / `autoFrame.js`)

- `importCardForDeck(name)` — Scryfall exact-name fetch + import (text + default art).
- `uploadArt(dataUri, 'autoFit')` — art replacement (only when `art_data_uri` present),
  followed by the same art-load poll `generateSingleCard()` uses
  (`art.complete && art.src === dataUri && card.artSource === art.src`, with
  `ART_LOAD_TIMEOUT_MS` / `ART_LOAD_POLL_INTERVAL_MS`).
- `waitForCardReady()` — waits for art + frames to stabilize before framing.
- Frame application: set `window.deckImportNickname`, set `#autoFrame`, call
  `autoFrame()`, clear `deckImportNickname`, wait `AUTOFRAME_TIMEOUT_MS`.
- Render: `drawCard()`, wait `CANVAS_RENDER_TIMEOUT_MS`, `cardCanvas.toDataURL('image/png')`
  (the `data:image/png;base64,` prefix is stripped from `png_base64`).
- `.cardconjurer` export: deep-clone `card`, strip `frame.image` / `mask.image`
  (mirrors `bulkDownloadZip()`), return as a plain object.

The timeout `const`s and `window.IMPORT_FRAME_CONFIG` are reused from
`deckImport.js` (not redeclared) — sibling classic `<script>` tags share the global
lexical/global scope.

## 4. Per-distinct-frame pack preload (non-obvious — keep it)

`autoFrame()`'s fork dispatch calls `autoElementFrame()` in the SAME tick it kicks off
`loadScript()` for the frame's pack, so the FIRST use of a given frame in a page
session can race the pack not being ready. `generateDeck()` / `generateSingleCard()`
sidestep this by preloading the pack + a fixed 800ms settle **before** their loop —
but they only ever use ONE frame per batch.

`proxsmithRenderDeck` can **mix frames per card**, so this module preloads per
**distinct** frame: a module-scoped `Set` of already-loaded frame keys (persists
across calls in the page session), and before framing a card whose `spec.frame` is a
key in `window.IMPORT_FRAME_CONFIG` and not yet loaded, it `await loadScript(...)`
then `await sleep(800)` then records the key. Frames outside `IMPORT_FRAME_CONFIG`
(plain upstream frames, `BloomburrowBorderlessColored`) are NOT preloaded here —
matching exactly what the existing code does.

## 5. Deviation from the original design note

The design note suggested driving the set-symbol override via
`applyDeckSetSymbolOverride()` after setting `#set-symbol-code`. In the actual source
that function is driven by the Import Deck **tab** controls
(`#importSetSymbolToggleDeck` / `#importSetSymbolCodeDeck`), not by `#set-symbol-code`,
and would clear/overwrite the symbol. This module instead drives the same underlying
mechanism that function uses internally: set `#set-symbol-code` + call
`fetchSetSymbol()`. Behaviour matches the contract (override when `set_code` is given,
otherwise leave the import default).

## 5b. Blank-session bootstrap (non-obvious — keep it)

A totally fresh session (no localStorage, no prior UI clicks — exactly what a headless
render always is) never gets a default frame template loaded: `creator-23.js`'s own
tail init throws on `bindInputs(...)` (only defined in `js/main-1.js`, which
`creator/index.html` never loads), aborting everything after it in that script,
including the `loadScript('/js/frames/groupStandard-3.js')` call that would normally
populate `card.text`. `changeCardIndex()` (called by every import) then crashes on the
very first card ("Cannot read properties of undefined (reading 'title')") because it
assumes `card.text` already exists. This is a **pre-existing bug in the fork itself**
(present before this module), not something introduced here — real interactive users
rarely hit it because they usually resume a previously saved card instead of starting
from a blank session.

Fix, contained entirely to this file: `ensureDefaultCardInitialized()` loads
`/js/frames/packM15Regular-1.js` once per session before the first import.
That pack already has a self-healing guard for exactly this case at its own top level
(`if (!card.text) { setTimeout(() => loadFrameVersionBtn.click()); }`), so simply
getting it loaded is enough — no need to replicate its internals here, and no need to
touch `js/creator-23.js`.

## 6. Upstream hook

One added line in `creator/index.html`, immediately after the `deckImport.js` tag,
before `frameSearch.js`:

```html
<!-- FORK: render-api -->
<script defer src='/js/fork/renderApi.js'></script>
```

Same minimal, marked, single-line pattern as `deckImport.js`'s own tag — safe for
future `upstream/master` merges (see `import-deck-extraction.md` §4.2 reasoning).

## 7. Manual browser smoke test

1. Serve the site and open `/creator/`.
2. Open the devtools console.
3. Run: `await window.proxsmithRenderCard({name: "Sol Ring"})`.
4. Expect `{ ok: true, png_base64: "<long base64>", cardconjurer_json: {...} }`.
5. Optional batch check:
   `await window.proxsmithRenderDeck({cards: [{code:"A", name:"Sol Ring"}, {code:"B", name:"Lightning Bolt", frame:"M15Nickname", nickname:"Bolt"}]})`
   → array of length 2, same order, each `{ card_code, ok:true, ... }`.
