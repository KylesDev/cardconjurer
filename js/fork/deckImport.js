/**
 * ============================================================================
 * FORK: IMPORT DECK MODULE
 * ============================================================================
 * This file is fork-only. It was extracted from js/creator-23.js and
 * js/autoFrame.js to minimise merge conflicts with upstream/master.
 * Upstream never touches this file.
 *
 * Requires (from global scope, loaded by upstream scripts before this file):
 *   card, cardCanvas, art, blank, setSymbol, scryfallCard, scryfallArt,
 *   availableFrames, autoFramePack, skipArtFetch,
 *   cardFrameProperties(), addFrame(), loadScript(), autoFrame(),
 *   fetchSetSymbol(), changeCardIndex(), loadTextOptions(),
 *   setBottomInfoStyle(), bottomInfoEdited(), uploadArt(), downloadCard(),
 *   drawCard(), drawTextBuffer(), notify(), toggleCollapse(),
 *   JSZip (from /js/jszip.min.js)
 *
 * Load order: place the <script> tag AFTER creator-23.js and autoFrame.js.
 * ============================================================================
 */

// ============================================================================
// SECTION 1: ELEMENT-NAMED FRAME REGISTRY (from autoFrame.js)
// ============================================================================
// Extendable registry of frame types assembled by element name (autoElementFrame).
// Key = dropdown value = pack<Value>.js filename. Flags:
//   nickname     – pack has a separate Nickname text field
//   crown        – pack has a '<Color> Crown' element for Legendary cards
//   titleElement – pack has a '<Color> Title' element for non-Legendary cards
// See spec §8 for how to add more.
window.IMPORT_FRAME_CONFIG = {
	'M15Nickname':      { pack: 'M15Nickname',      nickname: true,  crown: true,  titleElement: true  },
	'IkoNicknameShort': { pack: 'IkoNicknameShort', nickname: true,  crown: true,  titleElement: true  },
	'PromoRegular-1':   { pack: 'PromoRegular-1',   nickname: false, crown: false, titleElement: false },
	'IkoShort':         { pack: 'IkoShort',         nickname: false, crown: false, titleElement: false }
};

// ============================================================================
// SECTION 2: DECK GENERATION STATE & CONSTANTS (from creator-23.js)
// ============================================================================

// DECK IMPORT FUNCTIONALITY
var deckGenerationState = {
	isGenerating: false,
	currentIndex: 0,
	cards: [],
	zip: null,
	cancelled: false
};

// Timeout constants for card generation
const AUTOFRAME_TIMEOUT_MS = 1500; // Time to wait for autoframe to complete
const CANVAS_RENDER_TIMEOUT_MS = 1000; // Time to wait for canvas rendering to complete
const ART_LOAD_TIMEOUT_MS = 3000; // Time to wait for art image to load
const ART_LOAD_POLL_INTERVAL_MS = 250; // Interval for polling art load status

// ZIP Upload functionality for Import Deck
let zipCardImages = {}; // Global variable to store card images from ZIP
let singleImageUpload = null; // Global variable to store single image upload

// ============================================================================
// SECTION 3: AUTOFRAME HELPERS (from autoFrame.js)
// ============================================================================

// Import-only polish: long auto-imported card names / type lines would otherwise overlap the
// mana cost or run under the set symbol, and long rules text can run under the Power/Toughness
// plate (this is stock frame behaviour — the text boxes are as wide/tall as on the "Regular"
// frame, which was never designed to reserve room for auto-imported content). Title/type get
// narrowed BOXES so writeText's own shrink-to-fit makes the text smaller (never clipped)
// instead of overlapping its neighbour. Rules text vs. the PT plate instead keeps the box at
// FULL height and forces an early line break so the last line dodges the plate while staying
// full-size -- see dodgePtPlateWithLineBreaks() below; only falls back to shrinking the box if
// no break clears the plate. Content-aware: space/breaks are applied only when a mana cost /
// set symbol / PT plate is actually present. Widths/height/text are clamped from a stored
// pristine default so repeated calls don't compound. Applies during Import Deck generation AND
// proxsmith's headless render API path (window.__ccRenderApiActive, set for the duration of a
// card render by js/fork/renderApi.js — that path never sets deckGenerationState.isGenerating,
// which is Import Deck-only). Manual interactive editing of a single card in the Card Conjurer
// UI sets neither flag, so it remains completely untouched.
//
// Async: the PT-plate dodge probes candidate strings by actually painting them to a scratch
// canvas (writeText() is only synchronous internally today -- js/creator-23.js's own drawText()
// already `await`s it defensively, presumably in case that changes -- so this function follows
// the same defensive pattern). Every caller must await this.
window.clampImportTextWidths = async function clampImportTextWidths(topNameKey) {
	var driving = (typeof deckGenerationState !== 'undefined' && deckGenerationState.isGenerating)
		|| window.__ccRenderApiActive;
	if (!driving) { return; }
	if (!card.text) { return; }
	var aspect = card.height / card.width; // px height / px width (~1.4); converts a height-sized square to width units

	// Top name (nickname or title) vs. mana cost (mana is right-aligned to mana.x + mana.width)
	var nameField = card.text[topNameKey];
	var mana = card.text.mana;
	if (nameField) {
		if (nameField._importFullWidth == null) { nameField._importFullWidth = nameField.width; }
		var fullW = nameField._importFullWidth;
		var manaSymbols = (mana && mana.text) ? (mana.text.match(/{[^}]+}/g) || []) : [];
		if (manaSymbols.length > 0) {
			var symbolW = (mana.size || 0.043) * aspect; // one pip ≈ a square of height mana.size
			var manaRight = (mana.x || 0) + (mana.width || 1);
			var reserve = manaSymbols.length * symbolW + 0.012; // pips + a small gap
			var avail = (manaRight - reserve) - (nameField.x || 0);
			nameField.width = Math.max(0.2, Math.min(fullW, avail));
		} else {
			nameField.width = fullW; // no mana cost → full width available
		}
	}

	// Type line vs. set symbol (optional). The symbol is scaled to fit setSymbolBounds and can
	// occupy up to the full bounds WIDTH, so reserve the whole bounds width (the symbol's left
	// edge can reach setSymbolBounds.x - width) to guarantee the type clears it regardless of the
	// symbol's aspect ratio — a height-based square estimate under-reserved for wider symbols.
	var typeField = card.text.type;
	var ssb = card.setSymbolBounds;
	var setCodeEl = document.querySelector('#set-symbol-code');
	// A set symbol is shown if a code is entered OR a (non-blank) symbol image is loaded — the
	// latter catches CardConjurer's default symbol, which renders even with an empty code field.
	var hasSetSymbol = (setCodeEl && setCodeEl.value) ||
		(card.setSymbolSource && card.setSymbolSource.indexOf('/img/blank.png') === -1);
	if (typeField) {
		if (typeField._importFullWidth == null) { typeField._importFullWidth = typeField.width; }
		var fullTW = typeField._importFullWidth;
		if (ssb && hasSetSymbol) {
			var reserveW = ssb.width || ((ssb.height || 0.04) * aspect);
			var ssLeft;
			if (ssb.horizontal === 'right') { ssLeft = (ssb.x || 1) - reserveW; }
			else if (ssb.horizontal === 'center') { ssLeft = (ssb.x || 1) - reserveW / 2; }
			else { ssLeft = (ssb.x || 1); }
			var availT = ssLeft - (typeField.x || 0) - 0.008;
			typeField.width = Math.max(0.2, Math.min(fullTW, availT));
		} else {
			typeField.width = fullTW; // no set symbol → full width available
		}
	}

	// Rules text vs. Power/Toughness plate. The rules box is vertically centered by default
	// (js/creator-23.js honours noVerticalCenter), so SHORT rules text never reaches the bottom
	// of the box and is unaffected — this only bites when the text is long enough to fill the
	// box. Several frame packs size the rules box taller than the actual gap above the plate
	// (e.g. packM15Nickname.js: rules bottom 0.6303+0.2875=0.9178 vs. the plate's own bounds.y
	// of 0.8848), so long rules text runs under the plate. Detect the plate the same way
	// js/creator-23.js (~line 1946) does for its own bottom-info {ptshift} logic — by frame
	// element NAME, not by card type/version (a planeswalker has no PT plate frame element, so
	// it naturally never matches here; the planeswalker/version special-cases at that line are
	// for the unrelated {ptshift} code and don't apply to this box). Read the matched element's
	// OWN bounds (rather than hardcoding a y) so this adapts to whichever frame pack is applied.
	//
	// Ordering note: this function can run BEFORE card.frames has been rebuilt for the current
	// card (autoElementFrame calls it while card.frames still holds the PREVIOUS card's frames,
	// then rebuilds afterwards — see that function below) as well as after, via the explicit
	// call js/fork/renderApi.js makes once the final frame set is in place. Every call
	// independently re-derives the clamp from the CURRENT card.frames and the stored full-height
	// default, so a stale-frames call is always corrected by a later accurate one; a leftover
	// shrink from a previous card's creature is never left behind on a later noncreature card.
	var rulesField = card.text.rules;
	if (rulesField) {
		var ptFrameIdx = (card.frames || []).findIndex(function (el) {
			return el.name.toLowerCase().includes('power/toughness');
		});
		var ptEl = ptFrameIdx >= 0 ? card.frames[ptFrameIdx] : null;
		if (!ptEl) {
			// No PT plate on this render -- restore full height AND the pristine text (undoes
			// any shrink/line-break applied while a stale/previous card's PT frame was still
			// sitting in card.frames).
			if (rulesField._importFullHeight != null) { rulesField.height = rulesField._importFullHeight; }
			// Only undo a break WE injected: restore the pristine text solely when the field
			// still holds exactly the string we last derived from it. Restoring unconditionally
			// would write a previous card's rules over this one whenever card.text.rules turns
			// out to be a reused object (see dodgePtPlateWithLineBreaks's own cache comment).
			if (rulesField._importOriginalText != null && rulesField._importDerivedText === rulesField.text) {
				rulesField.text = rulesField._importOriginalText;
				rulesField._importDerivedText = rulesField._importOriginalText;
			}
		} else if (!ptEl.bounds) {
			// Plate present but its frame element carries no bounds -- don't guess a position;
			// leave the rules box exactly as it is.
		} else {
			if (rulesField._importFullHeight == null) { rulesField._importFullHeight = rulesField.height; }
			var GAP = 0.004; // small clearance so the last text line doesn't kiss the plate edge
			await dodgePtPlateWithLineBreaks(rulesField, ptEl, GAP);
		}
	}

	// Re-render the text with the adjusted widths (debounced). Needed for the Bloomburrow path,
	// whose earlier scheduled render may have already fired before these width changes.
	if (typeof drawTextBuffer === 'function') { drawTextBuffer(); }
};

// ----------------------------------------------------------------------------
// PT-plate dodge: ink-oracle + bounded {lns} search (used by clampImportTextWidths above)
// ----------------------------------------------------------------------------

// Scratch canvas for the ink-oracle probes below, module-level so it's created once and
// reused across every probe of every card (a bounded search is up to ~11 writeText() calls
// per card -- allocating a full-card-sized canvas per probe would be wasteful). Sized to
// mirror the real textCanvas (js/creator-23.js: sizeCanvas('text'), default width/height =
// card.width/height inflated by the marginX/marginY bleed border) so scaleX/scaleY/scaleWidth/
// scaleHeight -- which bake that same margin into every pixel coordinate -- line up exactly
// with what a real drawText() would paint. Resized lazily if card dimensions ever change
// (different card size mid-session), not on every probe.
var __ptDodgeScratchCanvas = null;
var __ptDodgeScratchContext = null;
function getPtDodgeScratchContext() {
	var w = Math.round(card.width * (1 + 2 * (card.marginX || 0)));
	var h = Math.round(card.height * (1 + 2 * (card.marginY || 0)));
	if (!__ptDodgeScratchCanvas) {
		__ptDodgeScratchCanvas = document.createElement('canvas');
		__ptDodgeScratchContext = __ptDodgeScratchCanvas.getContext('2d');
	}
	if (__ptDodgeScratchCanvas.width !== w || __ptDodgeScratchCanvas.height !== h) {
		__ptDodgeScratchCanvas.width = w;
		__ptDodgeScratchCanvas.height = h;
	}
	return __ptDodgeScratchContext;
}

// Ink-oracle: answers "does THIS candidate rules string actually collide with the PT plate?"
// by painting ONLY the rules field, in isolation, to the scratch canvas -- writeText() takes an
// arbitrary target context (js/creator-23.js ~line 1436, `function writeText(textObject,
// targetContext)`), so this never touches the real textCanvas/textContext the live card paints
// to. Reads back the plate's own bounds rect (not a hardcoded geometry guess) with a small
// clearance margin, same GAP idea as the old height-clamp. "Collides" = any pixel in that rect
// with alpha above a small threshold, to ignore antialiasing fringe. Guarded: caller only
// invokes this once rulesField/ptEl/ptEl.bounds are all confirmed present, but the guards stay
// here too so this is safe to call standalone.
async function rulesTextCollidesWithPlate(rulesField, candidateText, ptEl) {
	if (!rulesField || !ptEl || !ptEl.bounds) { return false; }
	var ctx = getPtDodgeScratchContext();
	ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	// Shallow clone with the candidate text swapped in -- writeText() only reads textObject
	// fields, but clone anyway so probing can never mutate the real field.
	var probeField = Object.assign({}, rulesField, { text: candidateText });
	await writeText(probeField, ctx);
	var CLEARANCE = 0.004; // same small clearance idea as the height-clamp's own GAP
	var clearW = scaleWidth(CLEARANCE);
	var clearH = scaleHeight(CLEARANCE);
	var px = Math.max(0, scaleX(ptEl.bounds.x || 0) - clearW);
	var py = Math.max(0, scaleY(ptEl.bounds.y || 0) - clearH);
	var pw = Math.min(ctx.canvas.width - px, scaleWidth(ptEl.bounds.width || 1) + 2 * clearW);
	var ph = Math.min(ctx.canvas.height - py, scaleHeight(ptEl.bounds.height || 1) + 2 * clearH);
	if (pw <= 0 || ph <= 0) { return false; }
	var pixels = ctx.getImageData(px, py, pw, ph).data;
	var ALPHA_THRESHOLD = 8;
	for (var i = 3; i < pixels.length; i += 4) {
		if (pixels[i] > ALPHA_THRESHOLD) { return true; }
	}
	return false;
}

// Finds indices of literal space characters in `text` that are safe insertion points for a
// forced {lns} break: outside any {...} code (mana symbols {T}/{G}, {i}/{/i} italics, {bar},
// {ptshift...}, etc. -- this DSL's codes are always flat/non-nested, so a simple brace-depth
// counter is enough) and not immediately touching an existing {line}/{lns}/{linenospace}/{bar}
// code (inserting right next to one of those would just add a redundant/empty extra line, not
// a useful wrap point).
function findSafeLineBreakPoints(text) {
	var BLOCKED = { line: true, lns: true, linenospace: true, bar: true };
	var points = [];
	var codes = [];
	var depth = 0, codeStart = -1;
	for (var i = 0; i < text.length; i++) {
		var ch = text[i];
		if (ch === '{') {
			if (depth === 0) { codeStart = i; }
			depth++;
		} else if (ch === '}') {
			depth = Math.max(0, depth - 1);
			if (depth === 0 && codeStart >= 0) {
				codes.push({ start: codeStart, end: i + 1, name: text.slice(codeStart + 1, i).toLowerCase() });
				codeStart = -1;
			}
		} else if (ch === ' ' && depth === 0) {
			points.push(i);
		}
	}
	return points.filter(function (idx) {
		var before = codes.filter(function (c) { return c.end === idx; })[0];
		var after = codes.filter(function (c) { return c.start === idx + 1; })[0];
		return !(before && BLOCKED[before.name]) && !(after && BLOCKED[after.name]);
	});
}

// Builds the candidate string for "push the trailing k words onto their own final line":
// replaces the space immediately before the k-th-from-last safe split point with {lns} (a line
// break WITHOUT the extra inter-paragraph spacing {line} adds -- js/creator-23.js ~line 1706 --
// the right tool for forcing a wrap mid-paragraph). k=1 breaks before the last word, k=2 before
// the second-to-last word (pushing the last two words onto the new line), etc. Returns null if
// there aren't k usable split points, so the caller can stop the search early.
function insertLineBreakBeforeLastKWords(text, k) {
	var points = findSafeLineBreakPoints(text);
	if (points.length < k) { return null; }
	var idx = points[points.length - k];
	return text.slice(0, idx) + '{lns}' + text.slice(idx + 1);
}

// Import-only: keep the rules box at FULL height and force an early line break so long rules
// text wraps clear of the PT plate, instead of shrinking the whole paragraph (real MTG cards do
// this too -- the last line stops short of the plate rather than every line shrinking to make
// room). Idempotent: always starts the search from the PRISTINE rules text, stored once per
// card in rulesField._importOriginalText, so repeated calls (this runs once from inside
// autoElementFrame/autoBloomburrowFrame and again explicitly from renderApi.js -- see
// clampImportTextWidths's own ordering comment above) never compound their own {lns}
// injections. Caller (clampImportTextWidths) has already confirmed ptEl.bounds exists.
async function dodgePtPlateWithLineBreaks(rulesField, ptEl, GAP) {
	// Cache-invalidation, and it MUST be this strict: card.text.rules may or may not be a fresh
	// object per card (frame packs rebuild card.text, the importer only overwrites .text), so a
	// pristine string cached on the field alone could outlive the card it came from and get
	// written back over the NEXT card's rules -- wrong text on the card, far worse than the
	// overlap this is fixing. So the cache is only trusted when the field still holds EXACTLY
	// the string we last derived from it; any other value (a new card's text, a manual edit)
	// invalidates it and becomes the new pristine.
	if (rulesField._importOriginalText == null || rulesField._importDerivedText !== rulesField.text) {
		rulesField._importOriginalText = rulesField.text;
	}
	var pristine = rulesField._importOriginalText;
	var fullH = rulesField._importFullHeight;

	// k=0: pristine text at full height. The common case for short rules text, and strictly
	// better than the old behaviour, which shrunk EVERY creature's rules box regardless of
	// whether it actually needed the room.
	rulesField.text = pristine;
	rulesField.height = fullH;
	rulesField._importDerivedText = pristine;
	if (!(await rulesTextCollidesWithPlate(rulesField, pristine, ptEl))) { return; }

	var K = 10; // bounded search -- at most 10 more probes (11 total) per card
	for (var k = 1; k <= K; k++) {
		var candidate = insertLineBreakBeforeLastKWords(pristine, k);
		if (candidate == null) { break; } // ran out of safe split points -- stop early
		if (!(await rulesTextCollidesWithPlate(rulesField, candidate, ptEl))) {
			// writeText()'s own 1px auto-shrink (js/creator-23.js ~line 2312) already covered
			// "the extra line overflows the box -> shrink slightly and retry" as part of the
			// probe that just succeeded -- commit the winning text, box stays at full height.
			rulesField.text = candidate;
			rulesField.height = fullH;
			rulesField._importDerivedText = candidate;
			return;
		}
	}

	// Fallback: no k up to K cleared the plate -- restore the pristine text and fall back to
	// the ORIGINAL height-clamp behaviour (the safety net; kept, not deleted).
	rulesField.text = pristine;
	rulesField._importDerivedText = pristine;
	var desiredBottom = ptEl.bounds.y - GAP;
	rulesField.height = ((rulesField.y || 0) + fullH > desiredBottom)
		? Math.max(0.05, desiredBottom - (rulesField.y || 0))
		: fullH;
}

// Assembles a frame whose layers are picked by element name from the pack's availableFrames.
// Imitates autoBloomburrowFrame: snapshot text, apply the pack's text layout, restore text,
// (optionally) set the nickname, then build base + Crown/Title + P/T layers. Config flags:
//   nickname     – pack has a separate Nickname text field (set it; clamp the nickname box)
//   crown        – pack has a '<Color> Crown' element to add for Legendary cards
//   titleElement – pack has a '<Color> Title' element to add for non-Legendary cards
// Borderless frames set all three false (just base + P/T, title in the normal title field).
window.autoElementFrame = async function autoElementFrame(config, colors, mana_cost, type_line, power, nickname) {
	// Map color letter → full color name used in element names
	const colorNameMap = {
		'W': 'White', 'U': 'Blue', 'B': 'Black', 'R': 'Red', 'G': 'Green',
		'M': 'Multicolored', 'A': 'Artifact', 'L': 'Land', 'C': 'Colorless',
		'V': 'Artifact'  // Vehicle → use Artifact frame
	};
	// For PT the pack has no "Land" variant; use Colorless instead
	const ptColorNameMap = Object.assign({}, colorNameMap, { 'L': 'Colorless' });

	// Determine color letter using cardFrameProperties
	var properties = cardFrameProperties(colors, mana_cost, type_line, power);
	var colorLetter = properties.frame ? properties.frame.toUpperCase() : 'A';
	var colorName = colorNameMap[colorLetter] || 'Artifact';
	var ptColorName = ptColorNameMap[colorLetter] || 'Colorless';

	// Snapshot text values set by importCardForDeck before the layout is overwritten
	var snapshot = {};
	if (card.text) {
		Object.keys(card.text).forEach(key => {
			snapshot[key] = card.text[key].text;
		});
	}

	// Apply the pack's nickname text layout (creates the nickname field, repositions title, etc.)
	// The pack must be loaded before this is called (preloaded in generateDeck/generateDeckFromZip).
	var loadBtn = document.querySelector('#loadFrameVersion');
	if (loadBtn && typeof loadBtn.onclick === 'function') {
		await loadBtn.onclick();
	}

	// Restore snapshotted text values (loadTextOptions preserves existing keys automatically,
	// but an explicit restore ensures correctness even if the field names changed)
	if (card.text) {
		Object.keys(snapshot).forEach(key => {
			if (card.text[key]) {
				card.text[key].text = snapshot[key];
			}
		});
	}

	// Set the nickname field (nickname frames only): provided nickname or fall back to the title
	if (config.nickname && card.text && card.text.nickname) {
		card.text.nickname.text = nickname || (card.text.title ? card.text.title.text : '');
	}

	// Import-only: keep the top name clear of the mana cost and the type line clear of the set
	// symbol. The big top name is the nickname on nickname frames, otherwise the title.
	await clampImportTextWidths(config.nickname ? 'nickname' : 'title');

	// Preserve extension/holo frames (same pattern as autoBloomburrowFrame)
	var preservedFrames = card.frames.filter(frame =>
		frame.name.includes('Extension') ||
		frame.name.includes('Gray Holo Stamp') ||
		frame.name.includes('Gold Holo Stamp')
	);

	card.frames = [];
	document.querySelector('#frame-list').innerHTML = null;

	// Helper: find a frame element by name in availableFrames and clone it.
	// The pack's `masks` array on each element is the list of SELECTABLE masks
	// (meant for the user to pick one); drawFrames() applies every mask in the
	// array via 'source-in', i.e. as an intersection, which for the base frame's
	// [Pinline, Type, Rules, Border] is ~empty and masks the whole layer out.
	// These nickname PNGs are standalone, already-shaped images shown whole at
	// their bounds, so we drop the masks entirely (same as autoBloomburrowFrame).
	function findFrameElement(name) {
		if (!availableFrames) return null;
		var el = availableFrames.find(f => f.name === name);
		if (!el) return null;
		var clone = JSON.parse(JSON.stringify(el));
		clone.masks = [];
		return clone;
	}

	// Push order = z-order top→bottom (card.frames[0] is drawn last/on top), matching
	// autoBloomburrowFrame: the base frame is pushed LAST so it sits at the bottom, and
	// the Crown/Title and Power/Toughness layers sit ON TOP of it (otherwise the base
	// frame's opaque bottom border would hide the P/T box).
	var newFrames = [...preservedFrames];

	// 1. Power/Toughness (topmost; only if card has P/T)
	if (power) {
		var ptEl = findFrameElement(ptColorName + ' Power/Toughness');
		if (ptEl) newFrames.push(ptEl);
	}

	// 2. Crown (Legendary) or Title element, when the pack provides them
	var isLegendary = type_line.toLowerCase().includes('legendary');
	if (config.crown && isLegendary) {
		var crownEl = findFrameElement(colorName + ' Crown');
		if (crownEl) newFrames.push(crownEl);
	} else if (config.titleElement) {
		var titleEl = findFrameElement(colorName + ' Title');
		if (titleEl) newFrames.push(titleEl);
	}

	// 3. Base frame (bottommost)
	var baseEl = findFrameElement(colorName + ' Frame');
	if (baseEl) newFrames.push(baseEl);

	card.frames = newFrames;
	card.frames.reverse();
	await card.frames.forEach(item => addFrame([], item));
	card.frames.reverse();
};

window.autoBloomburrowFrame = async function autoBloomburrowFrame(colors, mana_cost, type_line, power) {
	var frames = card.frames.filter(frame => frame.name.includes('Extension') || frame.name.includes('Gray Holo Stamp') || frame.name.includes('Gold Holo Stamp'));

	card.frames = [];
	document.querySelector('#frame-list').innerHTML = null;

	var properties = cardFrameProperties(colors, mana_cost, type_line, power);

	var hasPT = properties.pt != null;
	if (type_line.toLowerCase().includes('legendary')) {
		if (properties.pinlineRight) {
			frames.push(makeBloomburrowFrameByLetter(properties.pinlineRight, 'Crown', true, hasPT));
		}
		frames.push(makeBloomburrowFrameByLetter(properties.pinline, "Crown", false, hasPT));
	}
	if (!(properties.frame == 'V' && properties.pinline == 'A')) {
		if (properties.pinlineRight) {
			frames.push(makeBloomburrowFrameByLetter(properties.pinlineRight, 'Pinline', true, hasPT));
		}
		frames.push(makeBloomburrowFrameByLetter(properties.pinline, 'Pinline', false, hasPT));
	}
	frames.push(makeBloomburrowFrameByLetter(properties.frame, null, false, hasPT));

	card.frames = frames;
	card.frames.reverse();
	await card.frames.forEach(item => addFrame([], item));
	card.frames.reverse();

	// Bloomburrow frames darken the art behind the text, so the text must be white. This handler
	// doesn't apply the pack's text layout (which sets white), so without this the M15-default
	// black is used and the text is unreadable.
	['title', 'type', 'rules', 'pt'].forEach(function(key) {
		if (card.text && card.text[key]) { card.text[key].color = 'white'; }
	});
	if (typeof drawTextBuffer === 'function') { drawTextBuffer(); }

	// Import-only: keep the title clear of the mana cost and the type line clear of the set symbol
	await clampImportTextWidths('title');
};

window.makeBloomburrowFrameByLetter = function makeBloomburrowFrameByLetter(letter, mask = false, maskToRightHalf = false, hasPT = false) {
	letter = letter.toUpperCase();

	if (letter == 'L') {
		letter = 'C';
	}

	var frameNames = {
		'W': 'White',
		'U': 'Blue',
		'B': 'Black',
		'R': 'Red',
		'G': 'Green',
		'M': 'Multicolored',
		'A': 'Artifact',
		'C': 'Colorless',
		'V': 'Vehicle',
		'WL': 'White',
		'UL': 'Blue',
		'BL': 'Black',
		'RL': 'Red',
		'GL': 'Green',
		'ML': 'Multicolored'
	}

	var frameName = frameNames[letter];

	if (mask == "Crown") {
		var frame = {
			'name': frameName + ' Legendary Accents',
			'src': '/img/frames/custom/bloomburrowBorderlessColored/crown' + letter + '.png',
			'masks': [],
		}
		if (maskToRightHalf) {
			frame.masks.push({
				'src': '/img/frames/maskRightHalf.png',
				'name': 'Right Half'
			});
		}
		return frame;
	}

	if (hasPT) {
		frameName = frameName + " Creature"
	} else {
		frameName = frameName + " Noncreature"
	}

	var frame = {
		'name': frameName + ' Frame',
		'src': '/img/frames/custom/bloomburrowBorderlessColored/' + (hasPT ? 'creature' : 'noncreature') + letter + '.png',
	}

	if (mask) {
		if (mask == 'Pinline') {
			frame.masks = [
				{
					'src': '/img/frames/custom/bloomburrowBorderlessColored/' + (hasPT ? 'creature' : 'noncreature') + mask + 'Mask.png',
					'name': mask
				}
			]
		} else {
			frame.masks = [
				{
					'src': '/img/frames/custom/bloomburrowBorderlessColored/' + mask.toLowerCase() + 'Mask.png',
					'name': mask
				}
			]
		}

		if (maskToRightHalf) {
			frame.masks.push({
				'src': '/img/frames/maskRightHalf.png',
				'name': 'Right Half'
			});
		}
	} else {
		frame.masks = [];
	}

	return frame;
};

// ============================================================================
// SECTION 4: INPUT PARSING (from creator-23.js)
// ============================================================================

// Splits a raw card name into { name, nickname }.
// Supports the unified [Nickname] bracket syntax: "Card Name [Nickname]" → { name, nickname }.
// Without brackets, nickname is '' (no-op for non-nickname frames).
function splitNickname(rawName) {
	const m = rawName.match(/^(.*?)\s*\[(.+)\]\s*$/);
	return m ? { name: m[1].trim(), nickname: m[2].trim() }
	         : { name: rawName.trim(), nickname: '' };
}

function parseDeckList(deckListText) {
	const lines = deckListText.trim().split('\n');
	const cards = [];

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (!trimmedLine) continue;

		// Parse format: {numberOfCopies} {cardName [optionalNickname]}
		const match = trimmedLine.match(/^(\d+)\s+(.+)$/);
		if (match) {
			const copies = parseInt(match[1], 10);
			const { name, nickname } = splitNickname(match[2].trim());

			// Validate number of copies
			if (copies >= 1 && copies <= 100) {
				cards.push({ name, nickname, copies });
			} else {
				console.warn(`Invalid number of copies for card: ${line}`);
			}
		} else {
			console.warn(`Invalid deck list format for line: ${line}`);
		}
	}

	return cards;
}

// Returns { name, nickname } from a filename like "Sol Ring [Anello]_(2).png".
// Steps: strip extension → strip copy suffix → splitNickname → replace _ with spaces on both parts.
function parseImageFilename(filename) {
	// Remove file extension
	let raw = filename.substring(0, filename.lastIndexOf('.'));

	// Remove copy number suffix like _(2), (2), -(2), etc. Browsers add " (1)"
	// (with a space) on duplicate downloads, so accept an optional space/underscore/dash
	// before the parenthesised number.
	raw = raw.replace(/[ _-]?\(\d+\)\s*$/, '');

	// Split into name and optional nickname using bracket syntax
	let { name, nickname } = splitNickname(raw);

	// Replace underscores with spaces in both parts
	name = name.replace(/_/g, ' ').trim();
	nickname = nickname.replace(/_/g, ' ').trim();

	return { name, nickname };
}

// ============================================================================
// SECTION 5: SCRYFALL HELPER (from creator-23.js)
// ============================================================================

// Why this exists (proxsmith integration only):
// proxsmith renders each face of a double-faced card (DFC) as its own separate
// card, addressed by that face's exact single-face name (e.g. deck code D21-030
// = "Bala Ged Recovery", D21-031 = "Bala Ged Sanctuary" -- the two faces of one
// physical Zendikar Rising MDFC). It calls fetchScryfallCardByExactName() with
// that single face name.
//
// Scryfall, however, has no "give me just this face" endpoint: /cards/named
// always returns the WHOLE card object for a transform / modal_dfc / reversible
// card. The top-level object's `name` is the combined "Front // Back", and
// fields that differ per face (mana_cost, type_line, image_uris, oracle_text,
// colors, power/toughness, etc.) are ABSENT at the top level -- they only exist
// inside `card_faces[0]` / `card_faces[1]`. Feeding that raw object into
// CardConjurer's importCard() leaves mana cost/type blank and the name reading
// "A // B", so the card never auto-completes.
//
// Split, adventure, and flip cards are a different shape and must NOT be
// touched here: their two "faces" share a single printed image and the
// top-level object already carries the correct combined mana_cost/type_line/
// image_uris for the one physical card face proxsmith actually wants (each
// half is still one image, not two). The reliable way to tell them apart is
// image_uris: true DFC faces each carry their OWN `image_uris` (because each
// face is visually a separate card face/back), while split/adventure/flip
// faces do not (only the top-level card has image_uris). So: flatten only
// when the matched face has its own image_uris.
//
// flattenDfcFaceIfNeeded() takes the raw Scryfall card plus the exact face
// name that was requested and, if it looks like a true DFC face match, returns
// a flattened object built from a shallow copy of the top-level card (keeps
// top-level-only fields like set/set_name/collector_number/released_at/rarity/
// lang) with the matching face's own fields overlaid on top. Any other shape
// (normal single-faced card, split/adventure/flip, or no matching face name)
// is returned unchanged. This function is defensive by design -- Scryfall's
// card_faces entries can omit fields (e.g. a land back face has no mana_cost)
// -- and never throws; on anything unexpected it just hands back the original
// card so a normal (non-DFC) render is never affected.
function flattenDfcFaceIfNeeded(card, cardName) {
	try {
		if (!card || !Array.isArray(card.card_faces) || card.card_faces.length === 0) {
			return card;
		}

		const face = card.card_faces.find(f => f && f.name === cardName);
		if (!face || !face.image_uris) {
			// No exact-name face match, or the faces don't carry their own
			// images (split/adventure/flip) -- leave the card untouched.
			return card;
		}

		const flattened = Object.assign({}, card);
		const FACE_OVERRIDE_FIELDS = [
			'name', 'mana_cost', 'type_line', 'oracle_text', 'colors',
			'color_indicator', 'power', 'toughness', 'loyalty', 'flavor_text',
			'image_uris', 'artist', 'illustration_id', 'printed_name'
		];
		for (const key of FACE_OVERRIDE_FIELDS) {
			if (face[key] !== undefined) {
				flattened[key] = face[key];
			}
		}

		return flattened;
	} catch (error) {
		// Never let a flatten bug break a render -- fall back to the raw card.
		console.warn('flattenDfcFaceIfNeeded: falling back to unflattened card', error);
		return card;
	}
}

function fetchScryfallCardByExactName(cardName) {
	return new Promise((resolve, reject) => {
		const xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function() {
			if (this.readyState == 4) {
				if (this.status == 200) {
					try {
						const card = JSON.parse(this.responseText);
						// Flatten true DFC faces (transform/modal_dfc/reversible) down to
						// the single requested face -- see flattenDfcFaceIfNeeded() above.
						// Split/adventure/flip cards and normal cards pass through as-is.
						const resolvedCard = flattenDfcFaceIfNeeded(card, cardName);
						// Wrap single card in array to maintain compatibility with existing code
						resolve([resolvedCard]);
					} catch (error) {
						reject(new Error(`Failed to parse card data: ${error.message}`));
					}
				} else if (this.status == 404) {
					reject(new Error(`Card not found: ${cardName}`));
				} else {
					reject(new Error(`Failed to fetch card: ${this.status} ${this.statusText}`));
				}
			}
		};

		// Use the exact name endpoint for precise matching
		// URL encode the card name properly
		const encodedName = encodeURIComponent(cardName);
		const url = `https://api.scryfall.com/cards/named?exact=${encodedName}`;

		xhttp.open('GET', url, true);
		try {
			xhttp.send();
		} catch (error) {
			reject(new Error(`Scryfall API request failed: ${error.message}`));
		}
	});
}

// ============================================================================
// SECTION 6: SET SYMBOL & COLLECTOR INFO OVERRIDES (from creator-23.js)
// ============================================================================

// Import Deck set symbol handling. Call right after importCardForDeck, before the card is rendered.
// Driven by the "Insert set symbol" toggle:
//   - OFF: no set symbol at all (blank it out).
//   - ON + code entered: that code on every card.
//   - ON + no code: each card's OWN Scryfall set code.
// This also avoids CardConjurer's 'cmd' default: changeCardIndex leaves #set-symbol-code unset on
// import (its code assignment is commented out) yet still calls fetchSetSymbol(), which falls back
// to 'cmd' — so without this the wrong symbol shows and the empty code field hides it from the
// type-line clamp. The per-card rarity set by changeCardIndex is always kept.
function applyDeckSetSymbolOverride() {
	const insert = document.querySelector('#importSetSymbolToggleDeck');
	const codeEl = document.querySelector('#importSetSymbolCodeDeck');

	// Toggle off → no set symbol: clear the code and blank the symbol image.
	if (!insert || !insert.checked) {
		document.querySelector('#set-symbol-code').value = '';
		setSymbol.src = blank.src;
		card.setSymbolSource = blank.src;
		return;
	}

	let code = '';
	if (codeEl && codeEl.value.trim()) {
		code = codeEl.value.trim(); // explicit code for every card
	} else if (!document.querySelector('#lockSetSymbolCode').checked) {
		// Use the imported card's own set code instead of the 'cmd' default.
		try {
			const idx = document.querySelector('#import-index').value || 0;
			const c = (typeof scryfallCard !== 'undefined' && scryfallCard) ? scryfallCard[idx] : null;
			if (c && c.set) { code = c.set; }
		} catch (e) { /* leave code empty */ }
	}
	if (code) {
		document.querySelector('#set-symbol-code').value = code;
		fetchSetSymbol(); // re-fetches with this code + the per-card rarity
	}
}

// Import Deck collector info. Call right after importCardForDeck (await it), before rendering.
// When the "Add collector info" toggle is on, forces the new (post-ONE) style + shows collector
// info, then fills the #info-* fields used by the render: card number (auto-progressive or the
// entered value), rarity (from each card or the entered value), artist (from each card or the
// entered value), and the uniform set/language/year/notes. Empty fields are left blank.
// entryNumber is the 1-based position used for the auto-progressive card number.
async function applyDeckCollectorInfo(entryNumber) {
	const enable = document.querySelector('#deckCollectorToggle');
	if (!enable || !enable.checked) { return; }

	const card0 = (() => {
		try {
			const idx = document.querySelector('#import-index').value || 0;
			return (typeof scryfallCard !== 'undefined' && scryfallCard) ? scryfallCard[idx] : null;
		} catch (e) { return null; }
	})();
	const val = id => { const el = document.querySelector(id); return el ? el.value.trim() : ''; };

	// Force the new (post-ONE) collector style and make collector info visible.
	document.querySelector('#enableNewCollectorStyle').checked = true;
	document.querySelector('#enableCollectorInfo').checked = true;
	localStorage.setItem('enableNewCollectorStyle', 'true');
	localStorage.setItem('enableCollectorInfo', 'true');

	// Card number: auto-progressive (zero-padded) or the entered value.
	const autoNum = document.querySelector('#deckCollectorAutoNumber');
	document.querySelector('#info-number').value =
		(autoNum && autoNum.checked) ? String(entryNumber).padStart(3, '0') : val('#deckCollectorNumber');

	// Rarity: from the card (first letter, uppercase) or the entered value.
	const rarFromCard = document.querySelector('#deckCollectorRarityFromCard');
	document.querySelector('#info-rarity').value =
		(rarFromCard && rarFromCard.checked) ? (card0 && card0.rarity ? card0.rarity.charAt(0).toUpperCase() : '')
		                                     : val('#deckCollectorRarity');

	// Artist: from the card or the entered value.
	const artFromCard = document.querySelector('#deckCollectorArtistFromCard');
	document.querySelector('#info-artist').value =
		(artFromCard && artFromCard.checked) ? (card0 && card0.artist ? card0.artist : '')
		                                     : val('#deckCollectorArtist');

	// Uniform fields (left blank when empty).
	document.querySelector('#info-set').value = val('#deckCollectorSet');
	document.querySelector('#info-language').value = val('#deckCollectorLanguage');
	document.querySelector('#info-year').value = val('#deckCollectorYear');
	document.querySelector('#info-note').value = val('#deckCollectorNote');
	document.querySelector('#info-note-extra-1').value = val('#deckCollectorNoteExtra1');
	document.querySelector('#info-note-extra-2').value = val('#deckCollectorNoteExtra2');

	// Rebuild the bottom-info layout for the new style, then render with the values above.
	await setBottomInfoStyle();
	bottomInfoEdited();
}

// Import Deck art override. Call AFTER waitForCardReady() (i.e. after auto-fit has already run
// on the loaded art), not right after import like the two functions above.
// Each of the three fields (#deckArtOffsetX/Y, #deckArtZoom) is independently optional: an empty
// field leaves auto-fit's value for that property untouched. When set, it directly replaces the
// auto-fitted value, mirroring how the Art panel's own #art-x/#art-y/#art-zoom fields work
// (#art-x/#art-y are pixel offsets stored as a fraction of card.width/card.height; #art-zoom is
// already a percentage). Offsets here are given as a percentage of card.width/card.height instead
// of pixels, so they stay correct across different art/card resolutions.
function applyDeckArtOverride() {
	const xEl = document.querySelector('#deckArtOffsetX');
	const yEl = document.querySelector('#deckArtOffsetY');
	const zoomEl = document.querySelector('#deckArtZoom');

	const xPercent = xEl ? xEl.value.trim() : '';
	const yPercent = yEl ? yEl.value.trim() : '';
	const zoomPercent = zoomEl ? zoomEl.value.trim() : '';

	if (xPercent !== '') {
		card.artX = parseFloat(xPercent) / 100;
		document.querySelector('#art-x').value = Math.round(card.artX * card.width);
	}
	if (yPercent !== '') {
		card.artY = parseFloat(yPercent) / 100;
		document.querySelector('#art-y').value = Math.round(card.artY * card.height);
	}
	if (zoomPercent !== '') {
		card.artZoom = parseFloat(zoomPercent) / 100;
		document.querySelector('#art-zoom').value = parseFloat(zoomPercent);
	}

	if (xPercent !== '' || yPercent !== '' || zoomPercent !== '') {
		drawCard();
	}
}

// ============================================================================
// SECTION 7: CARD IMPORT ENGINE (from creator-23.js)
// ============================================================================

function importCardForDeck(cardName) {
	return new Promise((resolve, reject) => {
		let importResolved = false;
		const timeout = setTimeout(() => {
			if (!importResolved) {
				importResolved = true;
				reject(new Error(`Timeout importing card: ${cardName}`));
			}
		}, 15000); // 15 second timeout for import

		// Set the flavor text checkbox state from the deck import checkbox
		const deckFlavorTextCheckbox = document.querySelector('#importFlavorTextDeck');
		const importFlavorTextCheckbox = document.querySelector('#importFlavorText');
		if (deckFlavorTextCheckbox && importFlavorTextCheckbox) {
			importFlavorTextCheckbox.checked = deckFlavorTextCheckbox.checked;
		}

		// Hook into the importCard callback
		const originalImportCard = window.importCard;
		window.importCard = function(cardObject) {
			// Call original function
			if (originalImportCard && typeof originalImportCard === 'function') {
				originalImportCard(cardObject);
			}

			// Restore original
			window.importCard = originalImportCard;

			// Wait a bit for the UI to update and changeCardIndex to be called
			setTimeout(() => {
				if (!importResolved) {
					clearTimeout(timeout);
					importResolved = true;
					resolve();
				}
			}, 500);
		};

		// Use exact name search for deck imports
		fetchScryfallCardByExactName(cardName)
			.then(cardData => {
				// Set the scryfallCard and populate the UI
				scryfallCard = cardData;
				const importIndex = document.querySelector('#import-index');
				importIndex.innerHTML = '';

				const card = cardData[0];
				if (card && card.type_line && card.type_line !== 'Card') {
					const option = document.createElement('option');
					option.innerHTML = `${card.name} (${card.type_line})`;
					option.value = 0;
					importIndex.appendChild(option);
				}

				// Also set up the art data with the exact matched card
				// This prevents the art from being fetched from a different card
				scryfallArt = [];
				const artIndex = document.querySelector('#art-index');
				artIndex.innerHTML = '';

				if (card && card.image_uris && card.artist) {
					scryfallArt.push(card);
					const artOption = document.createElement('option');
					artOption.innerHTML = `${card.name} (${card.set.toUpperCase()} - ${card.artist})`;
					artOption.value = 0;
					artIndex.appendChild(artOption);
				}

				// Set flag to skip art fetching since we already have the exact art
				skipArtFetch = true;

				// Trigger the card import
				if (window.importCard) {
					window.importCard(cardData);
				}
				// Don't call changeCardIndex() here - it's already called by importCard
			})
			.catch(error => {
				if (!importResolved) {
					clearTimeout(timeout);
					importResolved = true;
					reject(error);
				}
			});
	});
}

function waitForCardReady() {
	return new Promise((resolve) => {
		let checksRemaining = 100; // 10 seconds max
		let lastArtSrc = null;
		let artStableCount = 0;

		const checkInterval = setInterval(() => {
			checksRemaining--;

			// Check if art has loaded and is stable
			const artLoaded = art && art.src && !art.src.includes('/img/blank.png');
			const artComplete = art && art.complete;
			// art.complete can flip true slightly before the queued 'load' event actually runs
			// the uploadArt(...,'autoFit') onload chain (autoFitArt -> artEdited), which is what
			// writes card.artX/artY/artZoom. artEdited() always ends by setting card.artSource to
			// art.src, so requiring them to match confirms that chain has actually finished —
			// otherwise a caller relying on card.artX/Y/Zoom right after this resolves (e.g. an
			// art override) can race a still-pending autoFitArt() and get clobbered.
			const artFitApplied = art && card.artSource === art.src;

			// Track if art source is stable (not changing)
			if (art && art.src === lastArtSrc) {
				artStableCount++;
			} else {
				artStableCount = 0;
				lastArtSrc = art ? art.src : null;
			}

			// Check if frames have been added
			const framesAdded = card.frames && card.frames.length > 0;

			// Card is ready when:
			// 1. Art is loaded and complete
			// 2. The autoFit->artEdited chain has actually run for this art source
			// 3. Art source has been stable for at least 3 checks (300ms)
			// 4. Frames have been added
			const isReady = artLoaded && artComplete && artFitApplied && artStableCount >= 3 && framesAdded;

			if (isReady || checksRemaining <= 0) {
				clearInterval(checkInterval);
				resolve();
			}
		}, 100);
	});
}

function sanitizeFilename(name) {
	// Remove or replace invalid filename characters
	return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
}

// ============================================================================
// SECTION 8: FILE UPLOAD HANDLERS (from creator-23.js)
// ============================================================================

// Handle file upload - supports both single images and ZIP files
async function handleFileUpload(event) {
	const file = event.target.files[0];
	if (!file) return;

	const extension = file.name.split('.').pop().toLowerCase();

	// Check if it's a ZIP file
	if (extension === 'zip') {
		return handleZipUpload(event);
	}

	// Check if it's a single image file
	if (['jpg', 'jpeg', 'png'].includes(extension)) {
		return handleSingleImageUpload(event);
	}

	notify('Please upload a valid image file (PNG, JPG, JPEG) or ZIP file.', 3);
}

async function handleSingleImageUpload(event) {
	const file = event.target.files[0];
	if (!file) return;

	try {
		// Clear any existing uploads
		clearUploadedFiles();

		const { name: cardName, nickname: cardNickname } = parseImageFilename(file.name);
		const imageUrl = URL.createObjectURL(file);

		// Store single image upload
		singleImageUpload = {
			cardName: cardName,
			nickname: cardNickname,
			imageUrl: imageUrl,
			fileName: file.name
		};

		notify(`Loaded single image: ${cardName}`, 3);

		// Show the clear button
		const clearButton = document.querySelector('#clear-zip-button');
		if (clearButton) {
			clearButton.style.display = 'block';
		}

		// Clear the file input so the same file can be uploaded again if needed
		event.target.value = '';
	} catch (error) {
		console.error('Error processing single image:', error);
		notify('Failed to process image file: ' + error.message, 5);
	}
}

async function handleZipUpload(event) {
	const file = event.target.files[0];
	if (!file) return;

	try {
		// Clear any existing uploads
		clearUploadedFiles();

		const zip = await JSZip.loadAsync(file);
		zipCardImages = {};
		const imageFiles = [];

		// Extract all image files
		zip.forEach((relativePath, zipEntry) => {
			const fileName = relativePath.split('/').pop(); // Get filename without path
			const extension = fileName.split('.').pop().toLowerCase();

			// Check if it's an image file
			if (['jpg', 'jpeg', 'png'].includes(extension) && !fileName.startsWith('.')) {
				imageFiles.push({ fileName, zipEntry });
			}
		});

		if (imageFiles.length === 0) {
			notify('No valid image files found in ZIP. Please include JPG or PNG files.', 5);
			return;
		}

		// Process each image
		for (const { fileName, zipEntry } of imageFiles) {
			const { name: cardName, nickname: cardNickname } = parseImageFilename(fileName);
			const blob = await zipEntry.async('blob');
			const imageUrl = URL.createObjectURL(blob);

			// Store image URL and nickname by card name
			if (!zipCardImages[cardName]) {
				zipCardImages[cardName] = { nickname: cardNickname, urls: [] };
			}
			zipCardImages[cardName].urls.push(imageUrl);
		}

		notify(`Loaded ${imageFiles.length} image(s) from ZIP for ${Object.keys(zipCardImages).length} unique card(s).`, 3);

		// Show the clear button
		const clearButton = document.querySelector('#clear-zip-button');
		if (clearButton) {
			clearButton.style.display = 'block';
		}

		// Clear the file input so the same file can be uploaded again if needed
		event.target.value = '';
	} catch (error) {
		console.error('Error processing ZIP:', error);
		notify('Failed to process ZIP file: ' + error.message, 5);
	}
}

function clearUploadedFiles() {
	// Clear single image upload
	if (singleImageUpload) {
		URL.revokeObjectURL(singleImageUpload.imageUrl);
		singleImageUpload = null;
	}

	// Clear ZIP images
	clearZipImages();
}

function clearZipImages() {
	// Release object URLs to free memory
	for (const cardName in zipCardImages) {
		for (const url of zipCardImages[cardName].urls) {
			URL.revokeObjectURL(url);
		}
	}

	zipCardImages = {};
}

function clearUploadedFilesUI() {
	// Call the actual clear function
	clearUploadedFiles();

	// Hide the clear button
	const clearButton = document.querySelector('#clear-zip-button');
	if (clearButton) {
		clearButton.style.display = 'none';
	}

	// Clear the file input
	const zipInput = document.querySelector('#deck-zip-input');
	if (zipInput) {
		zipInput.value = '';
	}

	notify('Uploaded files cleared.', 2);
}

// ============================================================================
// SECTION 9: DECK GENERATORS (from creator-23.js)
// ============================================================================

async function generateDeck() {
	if (deckGenerationState.isGenerating) {
		notify('Deck generation already in progress!', 3);
		return;
	}

	// Check if we have a single image uploaded
	if (singleImageUpload) {
		return generateSingleCard();
	}

	// Check if we have ZIP images uploaded
	if (Object.keys(zipCardImages).length > 0) {
		return generateDeckFromZip();
	}

	// Otherwise, use the text decklist
	const deckListInput = document.querySelector('#deck-list-input');
	const deckListText = deckListInput.value;

	if (!deckListText.trim()) {
		notify('Please enter a deck list or upload an image file!', 3);
		return;
	}

	const cards = parseDeckList(deckListText);

	if (cards.length === 0) {
		notify('No valid cards found in the deck list. Please check the format.', 5);
		return;
	}

	// Calculate total cards to generate
	const totalCards = cards.reduce((sum, card) => sum + card.copies, 0);

	// Ask user for confirmation
	const confirmed = confirm(
		`This will generate ${totalCards} card image(s) from ${cards.length} unique card(s).\n\n` +
		`The browser will download a ZIP file containing all cards.\n\n` +
		`Continue?`
	);

	if (!confirmed) {
		return;
	}

	// Initialize state
	deckGenerationState.isGenerating = true;
	deckGenerationState.currentIndex = 0;
	deckGenerationState.cards = cards;
	deckGenerationState.cancelled = false;
	deckGenerationState.zip = new JSZip();

	// Get frame style selection
	const selectedFrameStyle = document.querySelector('#deck-autoframe').value;

	// Save current autoframe setting to restore later
	const previousAutoFrame = document.querySelector('#autoFrame').value;

	// Set the autoframe for deck generation
	if (selectedFrameStyle !== 'false') {
		document.querySelector('#autoFrame').value = selectedFrameStyle;
		localStorage.setItem('autoFrame', selectedFrameStyle);
	}

	// Preload nickname frame pack before the loop to avoid async-timing issues (spec §6)
	if (typeof IMPORT_FRAME_CONFIG !== 'undefined' && IMPORT_FRAME_CONFIG[selectedFrameStyle]) {
		loadScript('/js/frames/pack' + selectedFrameStyle + '.js');
		await new Promise(resolve => setTimeout(resolve, 800));
	}

	// Show progress UI
	const progressDiv = document.querySelector('#deck-progress');
	const progressText = document.querySelector('#deck-progress-text');
	const progressBar = document.querySelector('#deck-progress-bar');
	const generateButton = document.querySelector('#generate-deck-button');

	progressDiv.style.display = 'block';
	generateButton.disabled = true;
	progressBar.max = totalCards;
	progressBar.value = 0;

	try {
		let cardIndex = 0;

		for (const cardEntry of cards) {
			if (deckGenerationState.cancelled) break;

			progressText.textContent = `Importing: ${cardEntry.name}...`;

			try {
				// Import the card from Scryfall
				await importCardForDeck(cardEntry.name);
				applyDeckSetSymbolOverride();
				await applyDeckCollectorInfo(cards.indexOf(cardEntry) + 1);

				progressText.textContent = `Loading: ${cardEntry.name}...`;

				// Wait for art and frames to be fully loaded
				await waitForCardReady();

				// Trigger autoframe if enabled
				if (selectedFrameStyle !== 'false') {
					progressText.textContent = `Framing: ${cardEntry.name}...`;
					window.deckImportNickname = cardEntry.nickname || '';
					autoFrame();
					window.deckImportNickname = '';
					// Wait for autoframe to complete
					await new Promise(resolve => setTimeout(resolve, 1000));
				}

				// Frame packs re-run autoFitArt() against their own artBounds when applied
				// (see e.g. js/frames/packPromoRegular-1.js), so the art override must run
				// after autoFrame(), not before, or it gets clobbered by that re-fit.
				applyDeckArtOverride();

				// Ensure canvas is fully drawn
				progressText.textContent = `Rendering: ${cardEntry.name}...`;
				if (typeof drawCard === 'function') {
					drawCard();
				}

				// Wait for canvas to finish rendering
				await new Promise(resolve => setTimeout(resolve, 800));

				// Get the card image data
				const imageData = cardCanvas.toDataURL('image/png');
				const imageBlob = await (await fetch(imageData)).blob();

			// Add to ZIP multiple times based on copies
			for (let copy = 1; copy <= cardEntry.copies; copy++) {
				if (deckGenerationState.cancelled) break;

				cardIndex++;
				progressBar.value = cardIndex;
				progressText.textContent = `Adding: ${cardEntry.name} (${copy}/${cardEntry.copies})`;

				// Create filename with copy number if multiple copies
				let filename;
				if (cardEntry.copies > 1) {
					filename = `${sanitizeFilename(cardEntry.name)}_${copy}.png`;
				} else {
					filename = `${sanitizeFilename(cardEntry.name)}.png`;
				}

				deckGenerationState.zip.file(filename, imageBlob);
			}
			} catch (cardError) {
				console.error(`Error processing card ${cardEntry.name}:`, cardError);
				notify(`Failed to process "${cardEntry.name}": ${cardError.message}`, 3);
				// Continue with next card instead of failing completely
			}
		}

		if (!deckGenerationState.cancelled) {
			// Generate and download ZIP
			progressText.textContent = 'Creating ZIP file...';
			const zipBlob = await deckGenerationState.zip.generateAsync({ type: 'blob' });

			// Download ZIP
			const downloadElement = document.createElement('a');
			downloadElement.href = URL.createObjectURL(zipBlob);
			downloadElement.download = 'deck_cards.zip';
			document.body.appendChild(downloadElement);
			downloadElement.click();
			downloadElement.remove();

			progressText.textContent = `Complete! Downloaded ${totalCards} card(s).`;
			notify('Deck generation complete!', 3);
		} else {
			progressText.textContent = 'Generation cancelled.';
			notify('Deck generation cancelled.', 3);
		}
	} catch (error) {
		console.error('Error generating deck:', error);
		notify('Error generating deck: ' + error.message, 5);
		progressText.textContent = 'Error occurred during generation.';
	} finally {
		// Restore previous autoframe setting
		document.querySelector('#autoFrame').value = previousAutoFrame;
		localStorage.setItem('autoFrame', previousAutoFrame);

		// Reset state
		deckGenerationState.isGenerating = false;
		generateButton.disabled = false;

		// Hide progress after a delay
		setTimeout(() => {
			progressDiv.style.display = 'none';
		}, 3000);
	}
}

async function generateSingleCard() {
	if (deckGenerationState.isGenerating) {
		notify('Card generation already in progress!', 3);
		return;
	}

	if (!singleImageUpload) {
		notify('No image uploaded!', 3);
		return;
	}

	const cardName = singleImageUpload.cardName;
	const cardNickname = singleImageUpload.nickname || '';

	// Ask user for confirmation
	const confirmed = confirm(
		`This will generate a card for: ${cardName}\n\n` +
		`The card will be downloaded as a single image file.\n\n` +
		`Continue?`
	);

	if (!confirmed) {
		return;
	}

	// Initialize state
	deckGenerationState.isGenerating = true;
	deckGenerationState.cancelled = false;

	// Get frame style selection
	const selectedFrameStyle = document.querySelector('#deck-autoframe').value;

	// Save current autoframe setting to restore later
	const previousAutoFrame = document.querySelector('#autoFrame').value;

	// Set the autoframe for card generation
	if (selectedFrameStyle !== 'false') {
		document.querySelector('#autoFrame').value = selectedFrameStyle;
		localStorage.setItem('autoFrame', selectedFrameStyle);
	}

	// Preload nickname frame pack before the loop to avoid async-timing issues (spec §6)
	if (typeof IMPORT_FRAME_CONFIG !== 'undefined' && IMPORT_FRAME_CONFIG[selectedFrameStyle]) {
		loadScript('/js/frames/pack' + selectedFrameStyle + '.js');
		await new Promise(resolve => setTimeout(resolve, 800));
	}

	// Show progress UI
	const progressDiv = document.querySelector('#deck-progress');
	const progressText = document.querySelector('#deck-progress-text');
	const progressBar = document.querySelector('#deck-progress-bar');
	const generateButton = document.querySelector('#generate-deck-button');

	progressDiv.style.display = 'block';
	generateButton.disabled = true;
	progressBar.max = 100;
	progressBar.value = 0;

	try {
		progressText.textContent = `Importing: ${cardName}...`;
		progressBar.value = 20;

		// Import the card from Scryfall
		await importCardForDeck(cardName);
		applyDeckSetSymbolOverride();
		await applyDeckCollectorInfo(1);

		progressText.textContent = `Loading: ${cardName}...`;
		progressBar.value = 40;

		// Replace the art with the provided image and auto-fit it
		uploadArt(singleImageUpload.imageUrl, 'autoFit');

		// Wait for art to be fully loaded
		await new Promise((resolve) => {
			let checkInterval = null;

			const cleanup = () => {
				if (checkInterval) {
					clearInterval(checkInterval);
					checkInterval = null;
				}
			};

			// Require card.artSource to match too: it's only set once the autoFit ->
			// artEdited chain has actually run, not just once art.complete flips true
			// (see waitForCardReady's artFitApplied for why that gap matters here).
			if (art.complete && art.src === singleImageUpload.imageUrl && card.artSource === art.src) {
				resolve();
			} else {
				// Poll for art completion
				checkInterval = setInterval(() => {
					if (art.complete && art.src === singleImageUpload.imageUrl && card.artSource === art.src) {
						cleanup();
						resolve();
					}
				}, ART_LOAD_POLL_INTERVAL_MS);

				// Timeout fallback
				setTimeout(() => {
					cleanup();
					resolve();
				}, ART_LOAD_TIMEOUT_MS);
			}
		});

		// Wait for card and frames to be fully loaded
		await waitForCardReady();

		progressText.textContent = `Framing: ${cardName}...`;
		progressBar.value = 60;

		// Trigger autoframe if enabled
		if (selectedFrameStyle !== 'false') {
			window.deckImportNickname = cardNickname;
			autoFrame();
			window.deckImportNickname = '';
			// Wait for autoframe to complete - use longer timeout for complex frames
			await new Promise(resolve => setTimeout(resolve, AUTOFRAME_TIMEOUT_MS));
		}

		// Frame packs re-run autoFitArt() against their own artBounds when applied
		// (see e.g. js/frames/packPromoRegular-1.js), so the art override must run
		// after autoFrame(), not before, or it gets clobbered by that re-fit.
		applyDeckArtOverride();

		// Ensure canvas is fully drawn
		progressText.textContent = `Rendering: ${cardName}...`;
		progressBar.value = 80;

		if (typeof drawCard === 'function') {
			drawCard();
		}

		// Wait for canvas to finish rendering - increased timeout for complex cards
		await new Promise(resolve => setTimeout(resolve, CANVAS_RENDER_TIMEOUT_MS));

		progressBar.value = 90;

		// Download the single card image
		progressText.textContent = `Downloading: ${cardName}...`;

		// Use the existing downloadCard function
		downloadCard();

		progressBar.value = 100;
		progressText.textContent = `Complete! Card downloaded.`;
		notify('Card generation complete!', 3);

	} catch (error) {
		console.error('Error generating card:', error);
		notify('Error generating card: ' + error.message, 5);
		progressText.textContent = 'Error occurred during generation.';
	} finally {
		// Restore previous autoframe setting
		document.querySelector('#autoFrame').value = previousAutoFrame;
		localStorage.setItem('autoFrame', previousAutoFrame);

		// Reset state
		deckGenerationState.isGenerating = false;
		generateButton.disabled = false;

		// Hide progress after a delay
		setTimeout(() => {
			progressDiv.style.display = 'none';
		}, 3000);
	}
}

async function generateDeckFromZip() {
	if (deckGenerationState.isGenerating) {
		notify('Deck generation already in progress!', 3);
		return;
	}

	if (Object.keys(zipCardImages).length === 0) {
		notify('Please upload a ZIP file first!', 3);
		return;
	}

	// Create card list from ZIP images
	const cards = [];

	for (const [cardName, cardData] of Object.entries(zipCardImages)) {
		const { nickname, urls } = cardData;
		// Each image represents one copy
		for (let i = 0; i < urls.length; i++) {
			cards.push({
				name: cardName,
				nickname: nickname,
				copies: 1,
				imageUrl: urls[i],
				copyNumber: i + 1,  // Track which copy this is (1-indexed)
				totalCopies: urls.length  // Total copies of this card
			});
		}
	}

	const totalCards = cards.length;
	const uniqueCards = Object.keys(zipCardImages).length;

	// Ask user for confirmation
	const confirmed = confirm(
		`This will generate ${totalCards} card image(s) from ${uniqueCards} unique card(s).\n\n` +
		`The browser will download a ZIP file containing all cards.\n\n` +
		`Continue?`
	);

	if (!confirmed) {
		return;
	}

	// Initialize state
	deckGenerationState.isGenerating = true;
	deckGenerationState.currentIndex = 0;
	deckGenerationState.cards = cards;
	deckGenerationState.cancelled = false;
	deckGenerationState.zip = new JSZip();

	// Get frame style selection
	const selectedFrameStyle = document.querySelector('#deck-autoframe').value;

	// Save current autoframe setting to restore later
	const previousAutoFrame = document.querySelector('#autoFrame').value;

	// Set the autoframe for deck generation
	if (selectedFrameStyle !== 'false') {
		document.querySelector('#autoFrame').value = selectedFrameStyle;
		localStorage.setItem('autoFrame', selectedFrameStyle);
	}

	// Preload nickname frame pack before the loop to avoid async-timing issues (spec §6)
	if (typeof IMPORT_FRAME_CONFIG !== 'undefined' && IMPORT_FRAME_CONFIG[selectedFrameStyle]) {
		loadScript('/js/frames/pack' + selectedFrameStyle + '.js');
		await new Promise(resolve => setTimeout(resolve, 800));
	}

	// Show progress UI
	const progressDiv = document.querySelector('#deck-progress');
	const progressText = document.querySelector('#deck-progress-text');
	const progressBar = document.querySelector('#deck-progress-bar');
	const generateButton = document.querySelector('#generate-deck-button');

	progressDiv.style.display = 'block';
	generateButton.disabled = true;
	progressBar.max = totalCards;
	progressBar.value = 0;

	const failedCards = [];
	const successCount = { value: 0 };

	try {
		let cardIndex = 0;

		for (const cardEntry of cards) {
			if (deckGenerationState.cancelled) break;

			progressText.textContent = `Importing: ${cardEntry.name}...`;

			try {
				// Import the card from Scryfall
				await importCardForDeck(cardEntry.name);
				applyDeckSetSymbolOverride();
				await applyDeckCollectorInfo(cards.indexOf(cardEntry) + 1);

				progressText.textContent = `Loading: ${cardEntry.name}...`;

				// Replace the art with the provided image and auto-fit it
				if (cardEntry.imageUrl) {
					uploadArt(cardEntry.imageUrl, 'autoFit');
				}

				// Wait for art and frames to be fully loaded
				await waitForCardReady();

				// Trigger autoframe if enabled
				if (selectedFrameStyle !== 'false') {
					progressText.textContent = `Framing: ${cardEntry.name}...`;
					window.deckImportNickname = cardEntry.nickname || '';
					autoFrame();
					window.deckImportNickname = '';
					// Wait for autoframe to complete
					await new Promise(resolve => setTimeout(resolve, 1000));
				}

				// Frame packs re-run autoFitArt() against their own artBounds when applied
				// (see e.g. js/frames/packPromoRegular-1.js), so the art override must run
				// after autoFrame(), not before, or it gets clobbered by that re-fit.
				applyDeckArtOverride();

				// Ensure canvas is fully drawn
				progressText.textContent = `Rendering: ${cardEntry.name}...`;
				if (typeof drawCard === 'function') {
					drawCard();
				}

				// Wait for canvas to finish rendering
				await new Promise(resolve => setTimeout(resolve, 800));

				// Get the card image data
				const imageData = cardCanvas.toDataURL('image/png');
				const imageBlob = await (await fetch(imageData)).blob();

				cardIndex++;
				progressBar.value = cardIndex;
				progressText.textContent = `Adding: ${cardEntry.name}`;

				// Create filename with copy number if multiple copies
				let filename;
				if (cardEntry.totalCopies > 1) {
					filename = `${sanitizeFilename(cardEntry.name)}_${cardEntry.copyNumber}.png`;
				} else {
					filename = `${sanitizeFilename(cardEntry.name)}.png`;
				}
				deckGenerationState.zip.file(filename, imageBlob);
				successCount.value++;

			} catch (cardError) {
				console.error(`Error processing card ${cardEntry.name}:`, cardError);
				failedCards.push(cardEntry.name);
				cardIndex++;
				progressBar.value = cardIndex;
				// Continue with next card instead of failing completely
			}
		}

		if (!deckGenerationState.cancelled) {
			// Generate and download ZIP
			progressText.textContent = 'Creating ZIP file...';
			const zipBlob = await deckGenerationState.zip.generateAsync({ type: 'blob' });

			// Download ZIP
			const downloadElement = document.createElement('a');
			downloadElement.href = URL.createObjectURL(zipBlob);
			downloadElement.download = 'deck_cards.zip';
			document.body.appendChild(downloadElement);
			downloadElement.click();
			downloadElement.remove();

			progressText.textContent = `Complete! Downloaded ${successCount.value} card(s).`;

			// Show summary notification
			if (failedCards.length > 0) {
				notify(
					`Generation complete!<br>` +
					`Successfully created: ${successCount.value} card(s)<br>` +
					`Failed: ${failedCards.length} card(s)<br>` +
					`Failed cards: ${failedCards.join(', ')}`,
					10
				);
			} else {
				notify(`Deck generation complete! Successfully created ${successCount.value} card(s).`, 3);
			}
		} else {
			progressText.textContent = 'Generation cancelled.';
			notify('Deck generation cancelled.', 3);
		}
	} catch (error) {
		console.error('Error generating deck:', error);
		notify('Error generating deck: ' + error.message, 5);
		progressText.textContent = 'Error occurred during generation.';
	} finally {
		// Restore previous autoframe setting
		document.querySelector('#autoFrame').value = previousAutoFrame;
		localStorage.setItem('autoFrame', previousAutoFrame);

		// Reset generation state
		deckGenerationState.isGenerating = false;
		generateButton.disabled = false;

		// Hide progress after 5 seconds
		setTimeout(() => {
			progressDiv.style.display = 'none';
		}, 5000);
	}
}

// ============================================================================
// SECTION 10: JS-INJECT FORK OPTIONS INTO #autoFrame SELECT
// ============================================================================
// The four fork options for the shared upstream #autoFrame select are injected
// here at load time so the HTML stays clean of fork edits on a shared element.
// Guarded to avoid double-insertion across page reloads.
(function injectAutoFrameOptions() {
	var sel = document.querySelector('#autoFrame');
	if (!sel) { return; }
	// Guard: don't add twice
	if (sel.querySelector('option[value="M15Nickname"]')) { return; }

	// Find the Bloomburrow option and insert our options right after it
	var bloomburrowOption = sel.querySelector('option[value="BloomburrowBorderlessColored"]');
	var insertAfter = bloomburrowOption || null;

	var options = [
		{ value: 'M15Nickname',    label: 'Nickname Frames' },
		{ value: 'IkoNicknameShort', label: 'Nickname Frames (Extra Short)' },
		{ value: 'PromoRegular-1', label: 'Borderless Frames' },
		{ value: 'IkoShort',       label: 'Borderless Frames (Extra Short)' }
	];

	options.forEach(function(opt) {
		var el = document.createElement('option');
		el.value = opt.value;
		el.textContent = opt.label;
		if (insertAfter && insertAfter.nextSibling) {
			sel.insertBefore(el, insertAfter.nextSibling);
		} else {
			sel.appendChild(el);
		}
		insertAfter = el;
	});
})();
