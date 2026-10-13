// Regressione: import prima del caricamento della versione PW.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('espone il builder async e inserisce entrambe le opzioni AutoFrame', () => {
    const options = [];
    const select = { options, appendChild: option => options.push(option) };
    const context = { window: {}, localStorage: { getItem: () => null }, document: {
        querySelector: () => select,
        createElement: () => ({})
    } };
    vm.runInNewContext(fs.readFileSync('js/fork/planeswalkerFrame.js', 'utf8'), context);
    assert.equal(typeof context.window.autoPlaneswalkerFrame, 'function');
    assert.deepEqual(options.map(option => option.value), ['Planeswalker', 'PlaneswalkerBorderless']);
});
