// Regressione backdrop: pixel reali, caricamenti versione e salvataggio nativo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const cards = require('./planeswalker-cards.json');

test('backdrop PW: toggle, invert, pack, salvataggio e API render', async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://cardconjurer.test/**', async route => {
            let file = path.join(process.cwd(), decodeURIComponent(new URL(route.request().url()).pathname));
            try {
                if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
                await route.fulfill({ path: file });
            } catch { await route.fulfill({ status: 404, body: '' }); }
        });
        await page.goto('http://cardconjurer.test/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.card?.text?.rules && window.autoPlaneswalkerFrame);
        await page.evaluate(() => document.fonts.ready);
        let first = true;
        for (const variant of ['Planeswalker', 'PlaneswalkerBorderless']) {
            for (const fixture of [cards.find(c => c.name.startsWith('Liliana')), cards.find(c => c.name.startsWith('Jace'))]) {
                console.log('builder', fixture.name, variant);
                await page.evaluate(async ({ fixture, variant }) => {
                    await autoPlaneswalkerFrame(variant, fixture.colors, fixture.mana_cost,
                        fixture.type_line, '', fixture.oracle_text, fixture.loyalty);
                }, { fixture, variant });
                assert.equal(await page.locator('#planeswalker-hide-backdrop').count(), 1);
                assert.equal(await page.locator('#planeswalker-hide-backdrop').isChecked(), !first);
                first = false;
                await page.evaluate(() => setPlaneswalkerHideBackdrop(false));
                for (const invert of [false, true]) {
                    await page.evaluate(async invert => {
                        document.querySelector('#planeswalker-invert').checked = invert;
                        invertPlaneswalkerColors();
                        await Promise.all([lightToDark, darkToLight].map(image => image.decode()));
                        planeswalkerEdited();
                    }, invert);
                    const visible = await page.evaluate(() => ({ pre: planeswalkerPreFrameCanvas.toDataURL(), post: planeswalkerPostFrameCanvas.toDataURL() }));
                    await page.locator('#planeswalker-hide-backdrop').evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change')); });
                    assert.equal(await page.evaluate(() => planeswalkerPreFrameContext.getImageData(0, 0, planeswalkerPreFrameCanvas.width, planeswalkerPreFrameCanvas.height).data.some((v, i) => i % 4 === 3 && v !== 0)), false);
                    assert.equal(await page.evaluate(() => planeswalkerPostFrameCanvas.toDataURL()), visible.post);
                    await page.locator('#planeswalker-hide-backdrop').evaluate(el => { el.checked = false; el.dispatchEvent(new Event('change')); });
                    assert.equal(await page.evaluate(() => planeswalkerPreFrameCanvas.toDataURL()), visible.pre);
                }
                await page.evaluate(() => setPlaneswalkerHideBackdrop(true));
            }
        }
        await page.evaluate(async () => {
            setPlaneswalkerHideBackdrop(true);
            window.prompt = () => 'Backdrop fixture';
            saveCard();
            setPlaneswalkerHideBackdrop(false);
            await loadCard('Backdrop fixture');
            planeswalkerEdited();
        });
        assert.equal(await page.locator('#planeswalker-hide-backdrop').isChecked(), true);
        await page.evaluate(async () => {
            const legacy = JSON.parse(localStorage.getItem('Backdrop fixture'));
            delete legacy.planeswalker.hideBackdrop;
            localStorage.setItem('Legacy fixture', JSON.stringify(legacy));
            await loadCard('Legacy fixture');
            planeswalkerEdited();
        });
        assert.equal(await page.locator('#planeswalker-hide-backdrop').isChecked(), false);
        assert.equal(await page.evaluate(() => planeswalkerPreFrameContext.getImageData(0, 0, planeswalkerPreFrameCanvas.width, planeswalkerPreFrameCanvas.height).data.some((v, i) => i % 4 === 3 && v !== 0)), true);
        // API pubblica completa, senza rete Scryfall: conserva la carta PW corrente.
        await page.evaluate(() => {
            importCardForDeck = async () => {};
            waitForCardReady = async () => {};
        });
        for (const render of [{ planeswalkerHideBackdrop: true }, {}]) {
            const result = await page.evaluate(render => proxsmithRenderCard({ name: 'Fixture', render }), render);
            assert.equal(result.ok, true, result.error);
            const saved = typeof result.cardconjurer_json === 'string' ? JSON.parse(result.cardconjurer_json) : result.cardconjurer_json;
            assert.equal(saved.planeswalker.hideBackdrop, render.planeswalkerHideBackdrop === true);
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
