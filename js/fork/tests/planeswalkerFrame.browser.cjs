// Eseguire: node --test js/fork/tests/planeswalkerFrame.browser.cjs
// Richiede Playwright + Chromium; nessun server o servizio di produzione.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const cards = require('./planeswalker-cards.json');

test('import UI: quattro PW × due varianti, fallback e builder riutilizzabile', async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://cardconjurer.test/**', async route => {
            const url = new URL(route.request().url());
            let file = path.join(process.cwd(), decodeURIComponent(url.pathname));
            try {
                if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
                // Ritardo intenzionale: la versione deve essere realmente awaited.
                if (url.pathname.endsWith('versionPlaneswalker.js')) await new Promise(resolve => setTimeout(resolve, 120));
                await route.fulfill({ path: file });
            } catch { await route.fulfill({ status: 404, body: '' }); }
        });
        await page.goto('http://cardconjurer.test/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.card?.text?.rules && window.autoPlaneswalkerFrame);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => {
            // Escludiamo download arte/set symbol: questo test verifica frame e testo.
            fetchScryfallData = () => {};
            fetchSetSymbol = () => {};
        });
        assert.deepEqual(await page.locator('#autoFrame option').evaluateAll(options => options.filter(o => o.value.startsWith('Planeswalker')).map(o => o.textContent)),
            ['Planeswalker', 'Planeswalker Borderless']);
        for (const variant of ['Planeswalker', 'PlaneswalkerBorderless']) {
            for (const fixture of cards) {
                const state = await page.evaluate(async ({ fixture, variant }) => {
                    document.querySelector('#autoFrame').value = 'false';
                    // Riproduce l'import su layout non PW, poi il cambio AutoFrame.
                    await loadScript('/js/frames/packM15Regular-1.js');
                    await document.querySelector('#loadFrameVersion').onclick();
                    scryfallCard = [fixture];
                    document.querySelector('#import-index').innerHTML = '<option value="0">Fixture</option>';
                    changeCardIndex();
                    document.querySelector('#autoFrame').value = variant;
                    await autoFrame();
                    await drawText();
                    drawCard();
                    return {
                        version: card.version,
                        loyalty: card.text.loyalty?.text,
                        costs: card.planeswalker?.abilities,
                        texts: [0, 1, 2, 3].map(i => card.text['ability' + i]?.text),
                        heights: [0, 1, 2, 3].map(i => card.text['ability' + i]?.height),
                        frames: card.frames.map(f => ({ name: f.name, src: f.src, loaded: f.image.complete && f.image.naturalWidth > 0 })),
                        rules: card.text.rules?.text,
                        pt: card.text.pt?.text
                    };
                }, { fixture, variant });
                if (fixture.loyalty) {
                    const tall = fixture.name.startsWith('Jace') || fixture.name.startsWith('Nicol');
                    assert.equal(state.version, 'planeswalker' + (tall ? 'Tall' : '') + (variant.endsWith('Borderless') ? 'Borderless' : tall ? '' : 'Regular'), fixture.name);
                    assert.equal(state.loyalty, fixture.loyalty);
                    const lines = fixture.oracle_text.split('\n');
                    const costs = lines.map(line => (line.match(/^([+−-]?\d+):/) || ['', ''])[1].replace('−', '-'));
                    assert.deepEqual(state.costs, costs.concat(Array(4 - costs.length).fill('')));
                    lines.forEach((line, i) => {
                        const normalize = text => text.replace(/\{\/?i\}/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
                        assert.equal(normalize(state.texts[i]), normalize(line.replace(/^([+−-]?\d+): /, '')), fixture.name + ': ' + i);
                        assert.ok(state.heights[i] > 0);
                    });
                    const color = fixture.colors.length > 1 ? 'Multicolored' : fixture.colors.length === 0 ? 'Artifact' : { U: 'Blue', B: 'Black' }[fixture.colors[0]];
                    assert.ok(state.frames.some(frame => frame.name === color + ' Frame'));
                    assert.ok(state.frames.some(frame => /Crown/.test(frame.name)));
                } else {
                    assert.equal(state.version, variant.endsWith('Borderless') ? 'borderless' : 'm15Regular');
                    assert.equal(state.rules, fixture.oracle_text);
                    assert.equal(state.pt, '2/2');
                }
                assert.ok(state.frames.every(frame => frame.loaded));
                console.log(fixture.name, variant, state.version, state.costs, state.loyalty);
            }
        }
        // Import consecutivo quando la versione è già PW; pulizia della 4ª abilità.
        await page.evaluate(async fixtures => {
            document.querySelector('#autoFrame').value = 'Planeswalker';
            for (const fixture of [fixtures[0], fixtures[3]]) {
                scryfallCard = [fixture];
                changeCardIndex();
                await autoFrame();
            }
        }, cards);
        assert.equal(await page.evaluate(() => card.text.ability3.text), '');
        assert.equal(await page.evaluate(() => document.querySelector('#planeswalker-cost-3').value), '');
        // API esplicita per proxsmith, senza Scryfall/UI import.
        await page.evaluate(async fixture => {
            scryfallCard = [];
            await autoPlaneswalkerFrame('PlaneswalkerBorderless', fixture.colors, fixture.mana_cost,
                fixture.type_line, '', fixture.oracle_text, fixture.loyalty);
        }, cards[2]);
        assert.equal(await page.evaluate(() => card.text.loyalty.text), cards[2].loyalty);
        // Fallback dopo un import su versione PW: conserva anche P/T.
        await page.evaluate(async fixture => {
            scryfallCard = [fixture];
            changeCardIndex();
            await autoFrame();
        }, cards[4]);
        assert.equal(await page.evaluate(() => card.text.pt.text), '2/2');
        // Tre abilità, anche lunghe: Regular; artefatto colorato: Artifact.
        await page.evaluate(async () => {
            await autoPlaneswalkerFrame('Planeswalker', ['U'], '{U}', 'Legendary Artifact Planeswalker — Test', '',
                ['+1: ' + 'Long ability text. '.repeat(30), '0: Short.', '-X: Short.'].join('\n'), '7');
        });
        assert.equal(await page.evaluate(() => card.version), 'planeswalkerRegular');
        assert.ok(await page.evaluate(() => card.frames.some(frame => frame.name === 'Artifact Frame')));
        assert.equal(await page.evaluate(() => card.planeswalker.abilities[2]), '-X');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
