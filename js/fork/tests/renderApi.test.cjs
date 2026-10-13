// Eseguire dalla root: node --test js/fork/tests/renderApi.test.cjs
// Pack e builder reali; DOM, import Scryfall e canvas simulati (nessuna rete).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');

function session({ autoLoad = 'true', fontDelay = 0, resetDelay = 0, failPack = false } = {}) {
	const elements = new Map();
	const storage = new Map(autoLoad === null ? [] : [['autoLoadFrameVersion', autoLoad]]);
	const loads = [];
	const pending = [];
	const button = { disabled: false, onclick: null, click() {
		if (this.onclick) pending.push(this.onclick());
	} };
	const context = vm.createContext({
		console, Set, Map,
		// Accelera solo gli sleep del renderer, conservando l'ordine delle promise.
		setTimeout: fn => setTimeout(fn, 1), clearTimeout,
		document: {
			querySelector(selector) {
				if (selector === '#loadFrameVersion') return button;
				if (selector.startsWith('#importSetSymbol') || selector === '#deckCollectorToggle') return null;
				if (selector.startsWith('#deckArt') || selector.startsWith('#art-') ||
					selector === '#autoFrame' || selector === '#frame-list') {
					if (!elements.has(selector)) elements.set(selector, { value: '', innerHTML: '', querySelector: () => ({}) });
					return elements.get(selector);
				}
				return { checked: false, value: '', innerHTML: '' };
			},
			fonts: { load: () => new Promise(resolve => setTimeout(resolve, fontDelay)) }
		},
		localStorage: {
			getItem: key => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, String(value)),
			removeItem: key => storage.delete(key)
		},
		card: { width: 1500, height: 2100, frames: [], text: {} },
		availableFrames: [], masks3: [],
		resetCardIrregularities: () => new Promise(resolve => setTimeout(resolve, resetDelay)),
		autoFitArt() { context.card.artX = 0; context.card.artY = 0; context.card.artZoom = 1; },
		resetSetSymbol() {}, resetWatermark() {},
		loadTextOptions(text) {
			const old = context.card.text;
			for (const key of Object.keys(text)) if (old[key]) text[key].text = old[key].text;
			context.card.text = text;
		},
		loadFramePack() {
			if (storage.get('autoLoadFrameVersion') === 'true') button.click();
		},
		async loadScript(url) {
			loads.push(url);
			if (failPack) throw new Error('pack non disponibile');
			vm.runInContext(fs.readFileSync(path.join(root, url), 'utf8'), context, { filename: url });
		},
		addFrame() {}, drawCard() {}, drawFrames() {}, drawText: async () => {},
		cardCanvas: { toDataURL: () => 'data:image/png;base64,dGVzdA==' },
		art: { complete: true, src: 'fixture' },
	});
	context.window = context;
	const creator = fs.readFileSync(path.join(root, 'js/creator-23.js'), 'utf8');
	vm.runInContext(creator.slice(creator.indexOf('function cardFrameProperties('), creator.indexOf('function setAutoframeNyx(')), context);
	for (const file of ['js/autoFrame.js', 'js/fork/deckImport.js']) {
		vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
	}
	// Simula l'importazione: sostituisce i contenuti, conserva il layout corrente.
	context.importCardForDeck = async name => {
		for (const field of Object.values(context.card.text)) field.text = '';
		for (const [key, text] of Object.entries({ title: name, mana: '{W}',
			type: 'Legendary Creature', rules: 'Vigilance', pt: '2/2' })) {
			if (!context.card.text[key]) context.card.text[key] = {};
			context.card.text[key].text = text;
		}
	};
	context.waitForCardReady = async () => {};
	context.clampImportTextWidths = async () => {};
	vm.runInContext(fs.readFileSync(process.env.CC_RENDER_API_SOURCE || path.join(root, 'js/fork/renderApi.js'), 'utf8'), context);
	return { context, loads, storage, pending, async render(frame, extras = {}) {
		const result = await context.proxsmithRenderCard({ name: 'Ajani Steadfast', frame, ...extras });
		assert.equal(result.ok, true, result.error);
		return result.cardconjurer_json;
	} };
}

function japan(card) {
	assert.equal(card.version, 'japanShowcase');
	assert.equal(card.artBounds.height, 0.9224);
	assert.equal(card.text.title.color, 'white');
	assert.equal(card.text.title.outlineWidth, 0.008);
	assert.equal(card.text.rules.font, 'Plantin-MT-Pro-Rg');
	assert.equal(card.text.title.text, 'Ajani Steadfast');
	assert.equal(card.text.rules.text, 'Vigilance');
	assert.equal(card.setSymbolBounds.y, 0.635);
	assert.equal(card.watermarkBounds.height, 0.2305);
}

for (const autoLoad of ['true', 'false', null]) {
	test(`layout nativi per carta, autoLoad=${autoLoad}`, async () => {
		const s = session({ autoLoad });
		await s.render('M15Nickname');
		japan(await s.render('JapanShowcase'));
		await s.render('Borderless');
		japan(await s.render('JapanShowcase'));
		japan(await s.render('JapanShowcase'));
		assert.equal(s.loads.filter(url => url.endsWith('packJapanShowcase.js')).length, 1);
		assert.equal(s.context.autoFramePack, 'JapanShowcase');
		assert.equal(s.storage.get('autoLoadFrameVersion') ?? null, autoLoad);
	});
}

test('IMPORT alternati A, B, A: layout, asset e nickname del pack corretto', async () => {
	const s = session();
	const first = await s.render('M15Nickname', { nickname: 'Primo' });
	await s.render('IkoNicknameShort', { nickname: 'Secondo' });
	const last = await s.render('M15Nickname', { nickname: 'Terzo' });
	assert.equal(last.version, first.version);
	assert.equal(last.text.title.y, first.text.title.y);
	assert.equal(last.text.nickname.text, 'Terzo');
	assert.equal(last.text.title.text, 'Ajani Steadfast');
	assert.deepEqual(last.frames.map(f => f.src), first.frames.map(f => f.src));
	assert.equal(s.loads.filter(url => url.endsWith('packM15Nickname.js')).length, 1);
});

test('layout asincrono completato prima degli offset (#133), anche a cache calda', async () => {
	const s = session({ fontDelay: 25, resetDelay: 25 });
	await s.render('Borderless');
	const extras = { art_offset_x: 12, art_offset_y: -25, art_zoom: 140 };
	const first = await s.render('JapanShowcase', extras);
	await s.render('Borderless');
	const last = await s.render('JapanShowcase', extras);
	await Promise.all(s.pending);
	for (const card of [first, last, s.context.card]) {
		japan(card);
		assert.equal(card.artX, 0.12);
		assert.equal(card.artY, -0.25);
		assert.equal(card.artZoom, 1.4);
	}
});

test('nickname come titolo applicato dopo il layout nativo', async () => {
	const s = session();
	await s.render('M15Nickname');
	const card = await s.render('JapanShowcase', { nickname: 'Ajani personalizzato', render: { title_from_nickname: true } });
	assert.equal(card.text.title.text, 'Ajani personalizzato');
	assert.equal(card.text.title.color, 'white');
	assert.equal(card.text.nickname, undefined);
});

test('errore di caricamento: ripristina la preferenza autoLoad', async () => {
	const s = session({ failPack: true });
	const result = await s.context.proxsmithRenderCard({ name: 'Ajani Steadfast', frame: 'JapanShowcase' });
	assert.equal(result.ok, false);
	assert.equal(s.storage.get('autoLoadFrameVersion'), 'true');
});


test('mazzo misto: alias BorderlessUB e Bloomburrow riapplicano il proprio layout', async () => {
	const s = session();
	const frames = ['Borderless', 'JapanShowcase', 'BorderlessUB', 'BloomburrowBorderlessColored', 'JapanShowcase', 'BloomburrowBorderlessColored'];
	const results = await s.context.proxsmithRenderDeck({ cards: frames.map(frame => ({ name: 'Ajani Steadfast', frame })) });
	results.forEach(result => assert.equal(result.ok, true, result.error));
	assert.equal(results[2].cardconjurer_json.version, 'borderless');
	japan(results[4].cardconjurer_json);
	assert.equal(results[5].cardconjurer_json.version, results[3].cardconjurer_json.version);
	assert.equal(s.loads.filter(url => url.endsWith('packBorderless.js')).length, 1);
});
