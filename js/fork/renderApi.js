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
	async function renderOneCard(spec) {
		if (!spec || typeof spec.name !== 'string' || !spec.name.trim()) {
			throw new Error('spec.name is required');
		}

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

		// 6. Render to canvas and read back PNG.
		drawCard();
		await sleep(CANVAS_RENDER_TIMEOUT_MS);
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
