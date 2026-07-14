/**
 * ============================================================================
 * FORK: RENDER API MODULE
 * ============================================================================
 * This file is fork-only. It exposes a stable, DOM-scrape-free JS API that a
 * headless-browser driver (Playwright, built separately) calls to render one
 * or many MTG cards to PNG. It is the browser side of proxsmith's "stage
 * render". Upstream never touches this file.
 *
 * It does NOT reimplement the import/frame/render engine — it reuses the
 * Import Deck engine already extracted into js/fork/deckImport.js (and the
 * upstream primitives in js/creator-23.js / js/autoFrame.js), just with new
 * orchestration that avoids the confirm() dialogs, progress-bar DOM and file
 * downloads that generateDeck()/generateSingleCard() do.
 *
 * Requires (from global scope, loaded by earlier scripts before this file):
 *   card, art, cardCanvas                                (creator-23.js)
 *   importCardForDeck, waitForCardReady                  (fork/deckImport.js)
 *   applyDeckSetSymbolOverride, applyDeckCollectorInfo,
 *   applyDeckArtOverride                                 (fork/deckImport.js)
 *   AUTOFRAME_TIMEOUT_MS, CANVAS_RENDER_TIMEOUT_MS,
 *   ART_LOAD_TIMEOUT_MS, ART_LOAD_POLL_INTERVAL_MS       (fork/deckImport.js)
 *   window.IMPORT_FRAME_CONFIG                           (fork/deckImport.js)
 *   uploadArt, drawCard, loadScript, fetchSetSymbol,
 *   autoFrame                                            (creator-23.js / autoFrame.js)
 *
 * Deck-wide + per-card render settings (proxsmith issue #11): the manifest
 * handed to proxsmithRenderDeck() may carry a top-level "render" object
 * (flavor_text, set_symbol_mode/set_code, collector.*, art_offset_x/y,
 * art_zoom -- see proxsmith/adapters/render_cardconjurer.py's build_manifest())
 * plus, per card, resolved override fields (art_offset_x/y, art_zoom, artist,
 * rarity, collector_* -- proxsmith/core/model.py's Deck resolvers). This file
 * does not reimplement any of that logic -- it only sets the same DOM fields
 * the human "Import Deck" tab uses, then calls the SAME deckImport.js engine
 * functions (applyDeckSetSymbolOverride / applyDeckCollectorInfo /
 * applyDeckArtOverride) that tab already relies on. Every step below is
 * defensive: an absent/undefined "render" block (older manifest shape, or a
 * bare proxsmithRenderCard(spec) call with no render info) skips the
 * corresponding DOM writes entirely rather than throwing.
 *
 * Load order: place the <script> tag AFTER creator-23.js, autoFrame.js and
 * deckImport.js (all `defer`). See docs/fork/render-api.md.
 *
 * Public contract (a driver is built against this — do not change silently):
 *   window.proxsmithRenderCard(spec)   -> Promise<{ ok, png_base64, cardconjurer_json, warning? } | { ok:false, error }>
 *   window.proxsmithRenderDeck(manifest) -> Promise<Array< per-card result >>
 *   window.proxsmithRenderReady        -> true once this file has finished loading
 *
 * ``warning`` (issue #16): present, on an otherwise-``ok:true`` result, only
 * when the requested artwork failed to load in time (or fell back to
 * upstream's own default/blank art) -- see waitForArtSource()'s doc comment.
 * Its absence does NOT guarantee the requested art rendered correctly, only
 * that this specific known failure mode wasn't detected.
 * ============================================================================
 */
(function () {
	'use strict';

	function sleep(ms) {
		return new Promise(function (resolve) { setTimeout(resolve, ms); });
	}

	// Frame packs (pack<Name>.js) already preloaded this page session. Module-scoped
	// so it PERSISTS across proxsmithRenderCard/proxsmithRenderDeck calls: once a pack
	// is loaded it stays loaded.
	//
	// Why this exists (non-obvious — keep it): autoFrame()'s fork dispatch (see
	// js/autoFrame.js §IMPORT_FRAME_CONFIG) calls autoElementFrame() in the SAME tick
	// as it kicks off loadScript() for the frame's pack, so the FIRST use of a given
	// frame in a session can race the pack not being ready yet. generateDeck()/
	// generateSingleCard() sidestep this by preloading the pack + a fixed 800ms settle
	// BEFORE their loop — but they only ever use ONE frame for the whole batch.
	// proxsmithRenderDeck can mix frames per card, so we must preload per DISTINCT
	// frame (only for frames in IMPORT_FRAME_CONFIG — exactly what the existing code
	// preloads; plain upstream frames and BloomburrowBorderlessColored are excluded).
	var loadedFramePacks = new Set();

	// Bootstrap for a totally fresh headless session (no prior localStorage / UI clicks).
	//
	// Why this exists (non-obvious — keep it): js/creator-23.js's own top-level tail init
	// (after DOM parse) is supposed to loadScript('/js/frames/groupStandard-3.js'), which
	// eventually loads the default 'M15Regular-1' pack and populates `card.text` with a base
	// text template — changeCardIndex() (called by every card import) assumes `card.text` is
	// already a real object and crashes ("Cannot read properties of undefined (reading
	// 'title')") if it isn't. But that tail init calls bindInputs(...) first, a function only
	// defined in js/main-1.js — which creator/index.html never loads — so it throws and
	// aborts everything after it in that script, INCLUDING the groupStandard-3.js load. This
	// is a pre-existing bug in the fork itself (not introduced here, not caused by renderApi.js)
	// that a real interactive user rarely notices because they usually resume a previously
	// saved card (card.text already restored) rather than starting from a truly blank session.
	// A headless render session always starts blank, so it always hits this.
	//
	// Fix, contained entirely to this fork-only file: explicitly load packM15Regular-1.js
	// ourselves. That pack script already has a self-healing guard for exactly this situation
	// at its own top level: `if (!card.text) { setTimeout(() => loadFrameVersionBtn.click()); }`
	// — so simply getting it loaded once is enough; no need to replicate its internals here.
	var defaultCardBootstrapped = false;

	async function ensureDefaultCardInitialized() {
		if (defaultCardBootstrapped || card.text) { return; }
		await loadScript('/js/frames/packM15Regular-1.js');
		await sleep(800); // let its self-click -> loadTextOptions() chain settle
		defaultCardBootstrapped = true;
	}

	async function ensureFramePackLoaded(frameKey) {
		if (!frameKey) { return; }
		// Only IMPORT_FRAME_CONFIG frames have a pack that needs preloading here —
		// mirror exactly what generateDeck()/generateSingleCard() preload.
		if (!window.IMPORT_FRAME_CONFIG || !window.IMPORT_FRAME_CONFIG[frameKey]) { return; }
		if (loadedFramePacks.has(frameKey)) { return; }
		// loadScript() resolves on the script's onload; still do the proven 800ms settle
		// afterwards, exactly like the existing code (onload doesn't guarantee the pack's
		// internal registration — e.g. availableFrames — has fully settled).
		await loadScript('/js/frames/pack' + frameKey + '.js');
		await sleep(800);
		loadedFramePacks.add(frameKey);
	}

	// Wait until the just-uploaded art has actually finished the autoFit -> artEdited
	// chain. Mirrors the poll in generateSingleCard(): require art.complete AND the src
	// to be the one we set AND card.artSource === art.src (that last equality only holds
	// once artEdited() has run, not merely when art.complete flips true).
	//
	// Resolves { ok: true } once that condition holds, or { ok: false } if
	// ART_LOAD_TIMEOUT_MS elapses first (issue #16: previously this resolved
	// silently either way, so a caller had no way to tell "art loaded" from
	// "gave up waiting" -- the render would just quietly finish with whatever
	// art.src happened to be, including upstream's own onerror fallback to
	// /img/blank.png (creator-23.js). See renderOneCardTracked's own extra
	// art.src check right after the await, which catches that onerror case
	// too (it can finish -- i.e. art.complete -- well within the timeout).
	function waitForArtSource(expectedSrc) {
		return new Promise(function (resolve) {
			if (art.complete && art.src === expectedSrc && card.artSource === art.src) {
				resolve({ ok: true });
				return;
			}
			var checkInterval = setInterval(function () {
				if (art.complete && art.src === expectedSrc && card.artSource === art.src) {
					clearInterval(checkInterval);
					resolve({ ok: true });
				}
			}, ART_LOAD_POLL_INTERVAL_MS);
			// Timeout fallback so a card can never hang the render.
			setTimeout(function () {
				clearInterval(checkInterval);
				resolve({ ok: false });
			}, ART_LOAD_TIMEOUT_MS);
		});
	}

	// --- Deck-wide + per-card render settings (issue #11) ----------------------
	//
	// Split into four small step functions instead of one monolithic helper,
	// because each targets a DOM group that must be touched at a DIFFERENT
	// point in renderOneCardTracked's existing sequence (flavor text before
	// importCardForDeck; set-symbol/collector right after it; art
	// offset/zoom only after autoFrame has run -- see the call sites below
	// and deckImport.js's own generateDeck() loop, which uses this same
	// ordering). A single function called from one place could not satisfy
	// all of those timing constraints at once.

	// Step: flavor text. Must run BEFORE importCardForDeck() -- that function
	// reads #importFlavorTextDeck into #importFlavorText itself (see
	// deckImport.js), so setting it any later would be a no-op for this card.
	function applyFlavorTextSetting(render) {
		if (!render || typeof render.flavor_text !== 'boolean') { return; }
		var el = document.querySelector('#importFlavorTextDeck');
		if (el) { el.checked = render.flavor_text; }
	}

	// Step: set-symbol tri-state (off / auto / code). Replaces the old bespoke
	// "#set-symbol-code + fetchSetSymbol()" block with the real Import Deck
	// controls + applyDeckSetSymbolOverride(), now that the deck-wide setting
	// actually distinguishes "no symbol" from "each card's own set". When no
	// render block is present at all, falls back to the legacy per-spec
	// set_code behaviour so older manifests (or a bare proxsmithRenderCard
	// call) keep working unchanged.
	function applySetSymbolSetting(render, spec) {
		if (!render) {
			if (spec && spec.set_code) {
				var legacyCodeEl = document.querySelector('#set-symbol-code');
				if (legacyCodeEl) { legacyCodeEl.value = spec.set_code; }
				if (typeof fetchSetSymbol === 'function') { fetchSetSymbol(); }
			}
			return;
		}
		var toggle = document.querySelector('#importSetSymbolToggleDeck');
		var codeEl = document.querySelector('#importSetSymbolCodeDeck');
		var lockEl = document.querySelector('#lockSetSymbolCode');
		if (!toggle || !codeEl || !lockEl) { return; }
		var mode = render.set_symbol_mode || 'auto';
		if (mode === 'off') {
			toggle.checked = false;
		} else if (mode === 'code') {
			toggle.checked = true;
			codeEl.value = render.set_code || '';
			lockEl.checked = true;
		} else {
			// "auto" -- each card's own set, per applyDeckSetSymbolOverride()'s
			// own fallback when the code field is empty and the lock is off.
			toggle.checked = true;
			codeEl.value = '';
			lockEl.checked = false;
		}
		if (typeof applyDeckSetSymbolOverride === 'function') { applyDeckSetSymbolOverride(); }
	}

	// Step: collector info. Deck-wide fields, with per-card collector fields,
	// rarity, and artist overrides taking priority over the deck's
	// "from card" checkboxes when present -- mirroring how spec.frame already
	// overrides render.frame for framing. entryNumber is only the render-batch
	// position for deck-wide Card Conjurer auto-number fallback; proxsmith
	// supplies deck-position numbers through spec.collector_number.
	async function applyCollectorInfoSetting(render, entryNumber, spec) {
		var toggle = document.querySelector('#deckCollectorToggle');
		if (!toggle) { return; }
		var collector = (render && render.collector) || {};
		var hasSpecCollectorInfo = spec && spec.collector_info !== undefined && spec.collector_info !== null;
		toggle.checked = hasSpecCollectorInfo ? !!spec.collector_info : !!(render && render.collector_info);
		if (!toggle.checked) { return; }

		var setField = function (id, value) {
			var el = document.querySelector(id);
			if (el) { el.value = value || ''; }
		};
		var pick = function (specValue, deckValue) {
			return specValue !== undefined && specValue !== null ? specValue : deckValue;
		};

		var autoNumEl = document.querySelector('#deckCollectorAutoNumber');
		if (spec && typeof spec.collector_number === 'string' && spec.collector_number !== '') {
			if (autoNumEl) { autoNumEl.checked = false; }
			setField('#deckCollectorNumber', spec.collector_number);
		} else {
			if (autoNumEl) { autoNumEl.checked = collector.auto_number !== false; }
			setField('#deckCollectorNumber', collector.number);
		}
		setField('#deckCollectorSet', pick(spec && spec.collector_set, collector.set));
		setField('#deckCollectorLanguage', pick(spec && spec.collector_language, collector.language));
		setField('#deckCollectorYear', pick(spec && spec.collector_year, collector.year));
		setField('#deckCollectorNote', pick(spec && spec.collector_note, collector.note));
		setField('#deckCollectorNoteExtra1', pick(spec && spec.collector_note_extra1, collector.note_extra1));
		setField('#deckCollectorNoteExtra2', pick(spec && spec.collector_note_extra2, collector.note_extra2));

		var rarityFromCardEl = document.querySelector('#deckCollectorRarityFromCard');
		if (spec && spec.rarity) {
			if (rarityFromCardEl) { rarityFromCardEl.checked = false; }
			setField('#deckCollectorRarity', spec.rarity);
		} else {
			if (rarityFromCardEl) { rarityFromCardEl.checked = collector.rarity_from_card !== false; }
			setField('#deckCollectorRarity', '');
		}

		var artistFromCardEl = document.querySelector('#deckCollectorArtistFromCard');
		if (spec && spec.artist) {
			if (artistFromCardEl) { artistFromCardEl.checked = false; }
			setField('#deckCollectorArtist', spec.artist);
		} else {
			if (artistFromCardEl) { artistFromCardEl.checked = collector.artist_from_card !== false; }
			setField('#deckCollectorArtist', collector.artist_from_card === false ? collector.artist : '');
		}

		if (typeof applyDeckCollectorInfo === 'function') {
			await applyDeckCollectorInfo(entryNumber || 1);
		}
	}

	// Step: art offset/zoom. Per-card values (spec.art_offset_x/y/art_zoom)
	// win over the deck defaults (render.art_offset_x/y/art_zoom); either can
	// be absent, in which case the corresponding field is left blank (i.e.
	// applyDeckArtOverride() leaves auto-fit's value untouched for it). Must
	// run AFTER autoFrame(), not right after waitForCardReady() -- frame packs
	// re-run their own autoFitArt() when applied (see deckImport.js's
	// generateDeck() comment on this exact ordering), which would otherwise
	// clobber the override.
	function applyArtOverrideSetting(render, spec) {
		var xEl = document.querySelector('#deckArtOffsetX');
		var yEl = document.querySelector('#deckArtOffsetY');
		var zoomEl = document.querySelector('#deckArtZoom');
		if (!xEl || !yEl || !zoomEl) { return; }

		var pick = function (specVal, renderVal) {
			if (specVal !== undefined && specVal !== null) { return specVal; }
			if (renderVal !== undefined && renderVal !== null) { return renderVal; }
			return null;
		};
		var x = pick(spec && spec.art_offset_x, render && render.art_offset_x);
		var y = pick(spec && spec.art_offset_y, render && render.art_offset_y);
		var zoom = pick(spec && spec.art_zoom, render && render.art_zoom);

		xEl.value = x !== null ? String(x) : '';
		yEl.value = y !== null ? String(y) : '';
		zoomEl.value = zoom !== null ? String(zoom) : '';

		if (typeof applyDeckArtOverride === 'function') { applyDeckArtOverride(); }
	}

	// Build the .cardconjurer export object. Mirrors bulkDownloadZip() in creator-23.js:
	// deep-clone the live card and strip the in-memory decoded images (they're huge and
	// not part of the saved format — src paths are kept). Returns a plain object; the
	// driver JSON.stringify's it if it wants a file.
	function exportCardJson() {
		var cardToSave = JSON.parse(JSON.stringify(card));
		(cardToSave.frames || []).forEach(function (frame) {
			delete frame.image;
			(frame.masks || []).forEach(function (mask) { delete mask.image; });
		});
		return cardToSave;
	}

	// The single shared implementation used by BOTH entry points. Does the real work
	// for one card; may throw (the entry points catch and convert to { ok:false }).
	//
	// Why ImageLoadTracker/FontLoadTracker (non-obvious — keep it): the ONLY other place
	// in this codebase that reads cardCanvas back programmatically (the "Download all as
	// ZIP" bulk export, creator-23.js's bulkDownloadZip) starts both trackers, calls
	// drawText(), then awaits Promise.all([ImageLoadTracker.waitForAll(),
	// FontLoadTracker.waitForAll()]) before its OWN drawCard() -- it never trusts a fixed
	// sleep. This function used to (fixed AUTOFRAME_TIMEOUT_MS/CANVAS_RENDER_TIMEOUT_MS
	// sleeps only, no tracker), which mostly worked interactively but not headless: (1)
	// drawTextBuffer() (called from deep inside the import/autoFrame chain) only
	// SCHEDULES the real drawText() 500ms later via setTimeout, and Playwright's headless
	// pages can throttle background-tab timers past that window; (2) even when drawText()
	// does fire, its own @font-face files (10+ per session, fetched over the network for a
	// remote instance) can still be mid-download when the fixed sleep expires. Either way
	// renderApi.js's own drawCard() call read a stale/blank frameCanvas and a textCanvas
	// drawn with the browser's fallback font instead of the MTG font files -- reproduced
	// end-to-end via the proxsmith web app's per-card render feature (missing frame
	// artwork + wrong font). Explicitly awaiting drawText() + both trackers removes the
	// race entirely; the fixed sleeps stay as a defense-in-depth settle, not the only wait.
	async function renderOneCard(spec, render, entryNumber) {
		if (!spec || typeof spec.name !== 'string' || !spec.name.trim()) {
			throw new Error('spec.name is required');
		}

		if (typeof ImageLoadTracker !== 'undefined') { ImageLoadTracker.start(); }
		if (typeof FontLoadTracker !== 'undefined') { FontLoadTracker.start(); }

		// js/fork/deckImport.js's clampImportTextWidths() (title/mana-cost, type/set-symbol,
		// rules/PT-plate overlap fixes) only runs while it believes a headless/batch render is
		// "driving" the card -- normally that's deckGenerationState.isGenerating, but that flag
		// is Import Deck-only and is never set on this renderApi.js path. This flag is the
		// render-API equivalent, read by that same guard. Set for the duration of this one
		// card's render only; cleared in `finally` so a render that throws partway through
		// never leaves it stuck on for a later render or for manual interactive editing
		// afterwards (see clampImportTextWidths's own doc comment for why manual editing must
		// stay untouched).
		window.__ccRenderApiActive = true;

		try {
			return await renderOneCardTracked(spec, render, entryNumber);
		} finally {
			window.__ccRenderApiActive = false;
			if (typeof ImageLoadTracker !== 'undefined') { ImageLoadTracker.stop(); }
			if (typeof FontLoadTracker !== 'undefined') { FontLoadTracker.stop(); }
		}
	}

	async function renderOneCardTracked(spec, render, entryNumber) {
		// 0. One-time per-session bootstrap so changeCardIndex() has a card.text to write into
		//    (see ensureDefaultCardInitialized() above for why this is needed at all).
		await ensureDefaultCardInitialized();

		// 0b. Deck-wide flavor-text setting (issue #11) — must be set before
		//     importCardForDeck() reads it. No-op when render is absent.
		applyFlavorTextSetting(render);

		// 1. Import from Scryfall (exact name). Fetches mana/type/P/T text and applies
		//    Card Conjurer's own default Scryfall art.
		await importCardForDeck(spec.name);

		// 1b. Set-symbol tri-state (off/auto/code) + collector info (issue #11).
		//     Both reuse deckImport.js's own Import Deck engine functions, driven
		//     via the same DOM fields the human tab uses, so behaviour matches
		//     exactly. Falls back to the legacy per-spec set_code path when no
		//     render block is present (see applySetSymbolSetting()).
		applySetSymbolSetting(render, spec);
		await applyCollectorInfoSetting(render, entryNumber, spec);

		// 3. Optional art override. Only touch art when a data URI is supplied — otherwise
		//    keep Card Conjurer's Scryfall-fetched default art.
		//
		//    Issue #16: a selected-artwork URL/data URI that the browser can't load
		//    (unreachable endpoint, bucket CORS, or just a slow/stalled fetch) used to
		//    fail SILENTLY -- upstream's own art.onerror handler (creator-23.js) resets
		//    art.src to '/img/blank.png' and the render just... finishes, with default
		//    or blank art, no signal anywhere. `artWarning` (checked below, surfaced in
		//    the returned result) turns that into a loud, per-card warning instead.
		var artWarning = null;
		if (spec.art_data_uri) {
			uploadArt(spec.art_data_uri, 'autoFit');
			var artWait = await waitForArtSource(spec.art_data_uri);
			if (!artWait.ok || art.src !== spec.art_data_uri) {
				artWarning = 'selected artwork failed to load (timed out or fell back to ' +
					'default/blank art) -- rendered card may not show the requested artwork';
			}
		}

		// 4. Wait for art + frames to stabilize before framing.
		await waitForCardReady();

		// 5. Optional frame application. If spec.frame is falsy, do NOT apply a frame at
		//    all — leave the card on whatever frame the import assigned.
		//
		//    Why this calls window.autoElementFrame() directly instead of autoFrame()
		//    (non-obvious -- found by reproducing against the REAL remote instance, not
		//    just a local loopback checkout -- keep this):
		//
		//    autoFrame()'s own IMPORT_FRAME_CONFIG branch (js/autoFrame.js) is
		//    fire-and-forget -- `packReady.then(function () { window.autoElementFrame(...) })`
		//    with no returned promise -- so a caller has NO way to know when framing has
		//    actually finished. The old code compensated with a fixed
		//    `await sleep(AUTOFRAME_TIMEOUT_MS)` (1500ms), which was usually enough
		//    against a local-loopback cardconjurer/ checkout (pack script load is
		//    near-instant) but reliably NOT enough against a real deployed instance over
		//    a real network -- reproduced end-to-end: card.frames stayed empty (no
		//    border/texture at all, and since there's no frame there's no art-window
		//    bounds either, so art fills the whole canvas unclipped instead of sitting in
		//    its normal window). EVERY frame proxsmith itself ever renders with
		//    (M15Nickname, IkoNicknameShort, PromoRegular-1, IkoShort) is in
		//    IMPORT_FRAME_CONFIG, so this covers the real path completely; a frame NOT in
		//    that config (hypothetical, not used by proxsmith today) falls back to the
		//    original autoFrame()+fixed-sleep behavior below.
		//
		//    This also fixes a second, independent bug: the OLD code set the global
		//    `window.deckImportNickname` then immediately cleared it back to '' on the
		//    very next (synchronous) line -- autoElementFrame() only reads that global
		//    from INSIDE the async packReady.then() callback, which always ran after the
		//    clear, so the nickname text field was silently always empty. Passing
		//    `spec.nickname` as a real function argument (autoElementFrame's own last
		//    parameter) removes the global/timing dependency entirely.
		if (spec.frame) {
			await ensureFramePackLoaded(spec.frame);
			var frameConfig = window.IMPORT_FRAME_CONFIG && window.IMPORT_FRAME_CONFIG[spec.frame];
			if (frameConfig && typeof window.autoElementFrame === 'function') {
				var frameColors = typeof window.detectAutoFrameColors === 'function'
					? window.detectAutoFrameColors(card)
					: [];
				await window.autoElementFrame(
					frameConfig, frameColors,
					card.text.mana.text, card.text.type.text, card.text.pt.text,
					spec.nickname || ''
				);
			} else {
				window.deckImportNickname = spec.nickname || '';
				var autoFrameEl = document.querySelector('#autoFrame');
				if (autoFrameEl) { autoFrameEl.value = spec.frame; }
				autoFrame();
				window.deckImportNickname = '';
				await sleep(AUTOFRAME_TIMEOUT_MS);
			}
		}

		// 5b. Art offset/zoom (deck default + per-card override, issue #11). Must run
		//     AFTER frame application, not right after waitForCardReady() -- frame packs
		//     re-run their own art auto-fit when applied, which would otherwise clobber
		//     this (see applyArtOverrideSetting()'s own comment, mirroring
		//     deckImport.js's generateDeck() ordering).
		applyArtOverrideSetting(render, spec);

		// 5c. Import-only text-overlap clamp (title/mana-cost, type/set-symbol, rules/PT-plate --
		//     see js/fork/deckImport.js's clampImportTextWidths() for what/why). Step 5 above only
		//     invokes this indirectly, via window.autoElementFrame(), when spec.frame is truthy AND
		//     the frame is in IMPORT_FRAME_CONFIG -- so a card rendered with no frame spec at all,
		//     or one that falls to the autoFrame()-fallback branch just above, would otherwise skip
		//     it entirely. Call it explicitly here so it always runs exactly once with the FINAL
		//     text/frame state, after frame application (step 5, so the PT-plate detection sees the
		//     actually-applied card.frames) and before the deterministic text paint (step 7).
		//     Harmless to also have already run from inside autoElementFrame() above -- the function
		//     clamps/dodges from its own stored *_importFullWidth/_importFullHeight/*_importOriginalText
		//     defaults rather than from the current (possibly already-adjusted) values, so a second
		//     call never compounds. topNameKey mirrors autoElementFrame's own choice: the nickname
		//     field when the applied frame left one on card.text (a nickname frame), else the title.
		//     MUST be awaited: the PT-plate part probes candidate rules strings by actually painting
		//     them to a scratch canvas (js/fork/deckImport.js's dodgePtPlateWithLineBreaks()) before
		//     picking one, so an un-awaited call here would race the deterministic text paint at step 7
		//     below -- exactly the kind of drawTextBuffer race warned about elsewhere in this file (see
		//     the module-level comment on renderOneCard).
		if (typeof window.clampImportTextWidths === 'function') {
			var clampNameKey = (card.text && card.text.nickname) ? 'nickname' : 'title';
			await window.clampImportTextWidths(clampNameKey);
		}

		// 6. Pre-warm every font this card's CURRENT text fields need, BEFORE the real
		//    paint pass below.
		//
		//    Why (non-obvious, found by tracing a real headless render -- keep it):
		//    writeText() (called per text field, from inside drawText()) does
		//    `var textFont = textObject.font || 'mplantin'; FontLoadTracker.track(textFont);`
		//    THEN IMMEDIATELY sets `lineContext.font = ... + textFont + ...` and paints --
		//    in the SAME synchronous call. Tracking a font and waiting for
		//    FontLoadTracker.waitForAll() AFTERWARDS (as step 7 below does, and as the only
		//    other caller of this tracker -- creator-23.js's bulkDownloadZip -- also does)
		//    only guarantees the font is ready for the NEXT paint, not the one that just
		//    registered it: canvas silently keeps whatever font was already current when
		//    you assign an unloaded font-family string, i.e. the browser's default
		//    (confirmed: cardContext.font read back after a from-cold render was literally
		//    "10px sans-serif"). bulkDownloadZip "works" only because every card after the
		//    first reuses fonts the previous card's cold paint already triggered loading of
		//    -- the browser's font cache masks the very same bug for cards 2..N in one
		//    session. A single-card render (proxsmith's per-card "Render this card") is
		//    always session-cold, so it hits this every time. Fix: discover every distinct
		//    font this card's CURRENT card.text needs and document.fonts.load() them all
		//    BEFORE the paint that actually needs them ready, not after.
		if (typeof card !== 'undefined' && card.text && typeof document !== 'undefined' && document.fonts) {
			var neededFonts = new Set();
			Object.values(card.text).forEach(function (t) { neededFonts.add((t && t.font) || 'mplantin'); });
			await Promise.all(
				Array.from(neededFonts).map(function (f) {
					return document.fonts.load('12px ' + f).catch(function () { /* best-effort */ });
				})
			);
		}

		// 7. Deterministically (re)draw the text layer -- NOT via drawTextBuffer(), which
		//    only schedules drawText() 500ms later and would race the rest of this
		//    function in a headless/backgrounded page (see the module-level comment on
		//    renderOneCard). Fonts are pre-warmed (step 6) so THIS paint uses them
		//    correctly -- unlike the pre-fix version, we don't depend on a subsequent
		//    waitForAll() to fix up a paint that already happened. drawText() itself calls
		//    drawFrames()/drawCard() at its own tail in some cases; harmless to also do so
		//    explicitly below.
		if (typeof drawText === 'function') { await drawText(); }
		if (typeof drawFrames === 'function') { drawFrames(); }

		// 8. Wait for every image (frame art, set symbol, watermark, ...) still in flight,
		//    THEN read the canvas back. This is what the fixed sleeps alone could not
		//    guarantee.
		var waits = [];
		if (typeof ImageLoadTracker !== 'undefined') { waits.push(ImageLoadTracker.waitForAll()); }
		if (typeof FontLoadTracker !== 'undefined') { waits.push(FontLoadTracker.waitForAll()); }
		if (waits.length) { await Promise.all(waits); }
		await sleep(CANVAS_RENDER_TIMEOUT_MS);

		// 8b. ImageLoadTracker.track(src) (used by addFrame() for every frame/mask image,
		//     see creator-23.js) fetches `src` into its OWN throwaway Image object purely
		//     to produce a waitable promise -- it is NOT the same Image instance addFrame()
		//     actually assigns to card.frames[i].image (whose OWN onload is what calls
		//     drawFrames() and actually paints frameCanvas). The browser cache makes the
		//     throwaway copy resolve around the same time as the real one, but "around the
		//     same time" is not "happens-after": waitForAll() above can resolve before the
		//     real image's onload -> drawFrames() has actually run, so the drawCard() below
		//     would composite a frameCanvas that's still one paint behind (confirmed by
		//     reproducing headless: card.frames[i].image.complete was already true and
		//     frameCanvas itself, read in isolation, was already correct at that point --
		//     yet the cardCanvas this function returned was missing the frame entirely; a
		//     manual drawFrames()+drawCard() called moments later, with nothing else
		//     changed, produced the correct output). ALSO tried polling
		//     `image.complete` -- didn't fix it, because `.complete` can be `true` before
		//     the browser has actually finished DECODING the bitmap into something
		//     drawImage() can use (a documented gap; HTMLImageElement.decode() is the
		//     spec's own answer to exactly this ambiguity). Decode the REAL image objects
		//     directly instead of trusting the tracker for this specific layer, then
		//     repaint once more ourselves so drawCard() below is guaranteed to run after,
		//     not racing, the last frame image's own onload.
		if (typeof card !== 'undefined' && Array.isArray(card.frames)) {
			var frameImages = card.frames.map(function (f) { return f && f.image; }).filter(Boolean);
			await Promise.all(
				frameImages.map(function (img) {
					return (typeof img.decode === 'function' ? img.decode() : Promise.resolve()).catch(function () {
						/* best-effort -- an image that fails to decode just stays whatever drawFrames() already drew */
					});
				})
			);
			if (typeof drawFrames === 'function') { drawFrames(); }
			await sleep(50);
		}

		// 9. Render to canvas and read back PNG.
		drawCard();
		var dataUrl = cardCanvas.toDataURL('image/png');
		var pngBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');

		var result = { png_base64: pngBase64, cardconjurer_json: exportCardJson() };
		if (artWarning) { result.warning = artWarning; }
		return result;
	}

	// --- Public entry points --------------------------------------------------

	// Single card. Never throws; resolves to { ok:true, png_base64, cardconjurer_json }
	// or { ok:false, error }. ``spec.render`` is an optional deck-settings block
	// (same shape as manifest.render below) for callers that want issue #11
	// settings applied to a lone card; absent for a bare {name: "..."} call.
	window.proxsmithRenderCard = async function (spec) {
		try {
			var result = await renderOneCard(spec, spec && spec.render, 1);
			var out = { ok: true, png_base64: result.png_base64, cardconjurer_json: result.cardconjurer_json };
			if (result.warning) { out.warning = result.warning; }
			return out;
		} catch (err) {
			return { ok: false, error: (err && err.message) ? err.message : String(err) };
		}
	};

	// Batch. Resolves to an array SAME LENGTH AND ORDER as manifest.cards. Each card is
	// rendered sequentially and isolated in try/catch so one failure never aborts the rest.
	// ``manifest.render`` (optional -- see proxsmith/adapters/render_cardconjurer.py's
	// build_manifest()) carries the deck-wide render settings from issue #11; each
	// card's own spec carries its resolved per-card overrides (art_offset_x/y,
	// art_zoom, artist, rarity, collector_*).
	window.proxsmithRenderDeck = async function (manifest) {
		var cards = (manifest && Array.isArray(manifest.cards)) ? manifest.cards : [];
		var render = manifest && manifest.render;
		var results = [];
		for (var i = 0; i < cards.length; i++) {
			var spec = cards[i];
			var cardCode = spec ? spec.code : undefined;
			try {
				var result = await renderOneCard(spec, render, i + 1);
				var entry = {
					card_code: cardCode,
					ok: true,
					png_base64: result.png_base64,
					cardconjurer_json: result.cardconjurer_json
				};
				if (result.warning) { entry.warning = result.warning; }
				results.push(entry);
			} catch (err) {
				results.push({
					card_code: cardCode,
					ok: false,
					error: (err && err.message) ? err.message : String(err)
				});
			}
		}
		return results;
	};

	// Signals to a Playwright driver that this module finished loading (all
	// functions/entry points above are defined). Set at the very end of top-level
	// execution — a driver can page.waitForFunction(() => window.proxsmithRenderReady === true).
	window.proxsmithRenderReady = true;
})();
