// Regressione renderer: import nativo, frame PW awaited, poi offset arte.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const cards = require('./planeswalker-cards.json');

test('renderer PW: batch misto, override per carta e offset dopo builder', { timeout: 360000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('console', message => { if (message.text().startsWith('PW test:')) console.log(message.text()); });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://cardconjurer.test/**', async route => {
            const url = new URL(route.request().url());
            let file = path.join(process.cwd(), decodeURIComponent(url.pathname));
            try {
                if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
                await route.fulfill({ path: file });
            } catch { await route.fulfill({ status: 404, body: '' }); }
        });
        await page.route('https://api.scryfall.com/**', async route => {
            const name = new URL(route.request().url()).searchParams.get('exact');
            const fixture = cards.find(card => card.name === name);
            await route.fulfill({ status: fixture ? 200 : 404, json: fixture || {},
                headers: { 'access-control-allow-origin': '*' } });
        });
        await page.goto('http://cardconjurer.test/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.card?.text?.rules && window.proxsmithRenderReady);
        await page.evaluate(async () => {
            // Canvas ridotto: stessa geometria relativa, costo minore in CI.
            getStandardWidth = () => 744;
            getStandardHeight = () => 1040;
            await resetCardIrregularities();
            const importForDeck = importCardForDeck;
            importCardForDeck = async name => { console.log('PW test: import ' + name); await importForDeck(name); console.log('PW test: imported ' + name); };
            fetchScryfallData = () => {};
            fetchSetSymbol = () => {};
            const original = window.autoPlaneswalkerFrame;
            window.pwEvents = [];
            window.autoPlaneswalkerFrame = async (...args) => {
                window.pwBuilderPending = true;
                // Supera il vecchio sleep: offset non deve scattare nel frattempo.
                await new Promise(resolve => setTimeout(resolve, 1700));
                await original(...args);
                window.pwEvents.push('frame:' + args[0]);
                window.pwBuilderPending = false;
            };
            const apply = applyDeckArtOverride;
            applyDeckArtOverride = () => {
                if (window.pwBuilderPending) throw new Error('Offset applicato prima della fine del builder PW');
                window.pwEvents.push('offset'); return apply();
            };
        });
        const art = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 200; canvas.height = 280;
            canvas.getContext('2d').fillRect(0, 0, 200, 280);
            return canvas.toDataURL();
        });
        const first = await page.evaluate(async ({ name, art }) => window.proxsmithRenderCard({
            name, frame: 'Planeswalker', art_data_uri: art, art_offset_y: -25
        }), { name: cards[0].name, art });
        assert.equal(first.ok, true, first.error);
        // build_manifest risolve frame di mazzo e override in ciascuno spec.
        for (const variant of ['Planeswalker', 'PlaneswalkerBorderless']) {
            const specs = cards.map((card, i) => ({ name: card.name, code: String(i), frame: variant,
                art_data_uri: art, art_offset_y: -25 }));
            specs.push({ name: cards[4].name, code: 'override', frame: 'M15Regular-1', art_data_uri: art });
            const results = await page.evaluate(async specs => {
                window.pwEvents = [];
                return window.proxsmithRenderDeck({ cards: specs });
            }, specs);
            for (let i = 0; i < results.length; i++) {
                assert.equal(results[i].ok, true, results[i].error);
                assert.ok(results[i].png_base64.length > 1000);
                const state = results[i].cardconjurer_json;
                if (specs[i].art_offset_y !== undefined) assert.equal(state.artY, -0.25);
                if (i < 4) {
                    const tall = i < 2;
                    assert.equal(state.version, 'planeswalker' + (tall ? 'Tall' : '') +
                        (variant.endsWith('Borderless') ? 'Borderless' : tall ? '' : 'Regular'));
                    assert.equal(state.text.loyalty.text, cards[i].loyalty);
                    assert.equal(state.planeswalker.abilities.filter(Boolean).length,
                        cards[i].oracle_text.split('\n').filter(line => /^[+−-]?\d+:/.test(line)).length);
                    assert.equal(state.text.ability3.text === '', !tall);
                    assert.ok(!state.frames.some(frame => /Crown/.test(frame.name)));
                } else {
                    assert.equal(state.version, i === 4 && variant.endsWith('Borderless') ? 'borderless' : 'm15Regular');
                    assert.equal(state.text.pt.text, '2/2');
                }
            }
            const events = await page.evaluate(() => window.pwEvents);
            assert.deepEqual(events, specs.flatMap(spec => spec.frame.startsWith('Planeswalker')
                ? ['frame:' + spec.frame, 'offset'] : ['offset']));
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
