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
 *   AUTOFRAME_TIMEOUT_MS, CANVAS_RENDER_TIMEOUT_MS,
 *   ART_LOAD_TIMEOUT_MS, ART_LOAD_POLL_INTERVAL_MS       (fork/deckImport.js)
 *   window.IMPORT_FRAME_CONFIG                           (fork/deckImport.js)
 *   uploadArt, drawCard, loadScript, fetchSetSymbol,
 *   autoFrame                                            (creator-23.js / autoFrame.js)
 *
 * Load order: place the <script> tag AFTER creator-23.js, autoFrame.js and
 * deckImport.js (all `defer`). See docs/fork/render-api.md.
 *
 * Public contract (a driver is built against this — do not change silently):
 *   window.proxsmithRenderCard(spec)   -> Promise<{ ok, png_base64, cardconjurer_json } | { ok:false, error }>
 *   window.proxsmithRenderDeck(manifest) -> Promise<Array< per-card result >>
 *   window.proxsmithRenderReady        -> true once this file has finished loading
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
	function waitForArtSource(expectedSrc) {
		return new Promise(function (resolve) {
			if (art.complete && art.src === expectedSrc && card.artSource === art.src) {
				resolve();
				return;
			}
			var checkInterval = setInterval(function () {
				if (art.complete && art.src === expectedSrc && card.artSource === art.src) {
					clearInterval(checkInterval);
					resolve();
				}
			}, ART_LOAD_POLL_INTERVAL_MS);
			// Timeout fallback so a card can never hang the render.
			setTimeout(function () {
				clearInterval(checkInterval);
				resolve();
			}, ART_LOAD_TIMEOUT_MS);
		});
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
	async function renderOneCard(spec) {
		if (!spec || typeof spec.name !== 'string' || !spec.name.trim()) {
			throw new Error('spec.name is required');
		}

		if (typeof ImageLoadTracker !== 'undefined') { ImageLoadTracker.start(); }
		if (typeof FontLoadTracker !== 'undefined') { FontLoadTracker.start(); }

		try {
			return await renderOneCardTracked(spec);
		} finally {
			if (typeof ImageLoadTracker !== 'undefined') { ImageLoadTracker.stop(); }
			if (typeof FontLoadTracker !== 'undefined') { FontLoadTracker.stop(); }
		}
	}

	async function renderOneCardTracked(spec) {
		// 0. One-time per-session bootstrap so changeCardIndex() has a card.text to write into
		//    (see ensureDefaultCardInitialized() above for why this is needed at all).
		await ensureDefaultCardInitialized();

		// 1. Import from Scryfall (exact name). Fetches mana/type/P/T text and applies
		//    Card Conjurer's own default Scryfall art.
		await importCardForDeck(spec.name);

		// 2. Optional per-card set-symbol code override.
		//    NOTE: we intentionally do NOT call applyDeckSetSymbolOverride() here — despite
		//    its name it is driven by the Import Deck tab's #importSetSymbolToggleDeck /
		//    #importSetSymbolCodeDeck controls (not by #set-symbol-code), and with the tab
		//    in its default state it would clear the symbol. We instead drive the SAME
		//    underlying mechanism it uses: set #set-symbol-code + fetchSetSymbol(). When
		//    set_code is absent we leave whatever the import assigned by default.
		if (spec.set_code) {
			var setCodeEl = document.querySelector('#set-symbol-code');
			if (setCodeEl) { setCodeEl.value = spec.set_code; }
			if (typeof fetchSetSymbol === 'function') { fetchSetSymbol(); }
		}

		// 3. Optional art override. Only touch art when a data URI is supplied — otherwise
		//    keep Card Conjurer's Scryfall-fetched default art.
		if (spec.art_data_uri) {
			uploadArt(spec.art_data_uri, 'autoFit');
			await waitForArtSource(spec.art_data_uri);
		}

		// 4. Wait for art + frames to stabilize before framing.
		await waitForCardReady();

		// 5. Optional frame application. If spec.frame is falsy, do NOT call autoFrame() at
		//    all — leave the card on whatever frame the import assigned.
		if (spec.frame) {
			await ensureFramePackLoaded(spec.frame);
			window.deckImportNickname = spec.nickname || '';
			var autoFrameEl = document.querySelector('#autoFrame');
			if (autoFrameEl) { autoFrameEl.value = spec.frame; }
			autoFrame();
			window.deckImportNickname = '';
			await sleep(AUTOFRAME_TIMEOUT_MS);
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

		return { png_base64: pngBase64, cardconjurer_json: exportCardJson() };
	}

	// --- Public entry points --------------------------------------------------

	// Single card. Never throws; resolves to { ok:true, png_base64, cardconjurer_json }
	// or { ok:false, error }.
	window.proxsmithRenderCard = async function (spec) {
		try {
			var result = await renderOneCard(spec);
			return { ok: true, png_base64: result.png_base64, cardconjurer_json: result.cardconjurer_json };
		} catch (err) {
			return { ok: false, error: (err && err.message) ? err.message : String(err) };
		}
	};

	// Batch. Resolves to an array SAME LENGTH AND ORDER as manifest.cards. Each card is
	// rendered sequentially and isolated in try/catch so one failure never aborts the rest.
	window.proxsmithRenderDeck = async function (manifest) {
		var cards = (manifest && Array.isArray(manifest.cards)) ? manifest.cards : [];
		var results = [];
		for (var i = 0; i < cards.length; i++) {
			var spec = cards[i];
			var cardCode = spec ? spec.code : undefined;
			try {
				var result = await renderOneCard(spec);
				results.push({
					card_code: cardCode,
					ok: true,
					png_base64: result.png_base64,
					cardconjurer_json: result.cardconjurer_json
				});
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
