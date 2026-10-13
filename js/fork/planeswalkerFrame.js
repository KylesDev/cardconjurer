// FORK: AutoFrame PW; chiamare e attendere autoPlaneswalkerFrame anche dal renderer.
(function () {
    const select = document.querySelector('#autoFrame');
    ['Planeswalker', 'PlaneswalkerBorderless'].forEach(function (value) {
        if (!select || Array.from(select.options).some(option => option.value === value)) return;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === 'Planeswalker' ? 'Planeswalker' : 'Planeswalker Borderless';
        select.appendChild(option);
    });
    if (select && ['Planeswalker', 'PlaneswalkerBorderless'].includes(localStorage.getItem('autoFrame'))) {
        select.value = localStorage.getItem('autoFrame');
    }

    // Il pack avvia loadScript(version) senza restituirne la promise: osserviamo
    // quel caricamento prima di invocare onclick, senza modificare i pack upstream.
    async function loadVersion() {
        let observer, timer;
        const ready = new Promise(function (resolve, reject) {
            timer = setTimeout(() => reject(new Error('Timeout caricamento versione del frame')), 15000);
            observer = new MutationObserver(function (records) {
                records.forEach(record => record.addedNodes.forEach(function (node) {
                    if (node.tagName !== 'SCRIPT' || !node.src.includes('/js/frames/version')) return;
                    node.addEventListener('load', resolve, { once: true });
                    node.addEventListener('error', () => reject(new Error('Caricamento versione fallito')), { once: true });
                }));
            });
            observer.observe(document.head, { childList: true });
        });
        try {
            // Entrambi awaited: layout del pack e script della versione.
            await Promise.all([document.querySelector('#loadFrameVersion').onclick(), ready]);
        } finally {
            clearTimeout(timer);
            observer.disconnect();
        }
    }

    function splitAbilities(text) {
        const abilities = String(text || '').split(/\r?\n/).filter(line => line.trim()).map(function (line) {
            const match = line.match(/^\s*([+\-−]?\d+|[+\-−]X):\s*(.*)$/);
            return match ? { cost: match[1].replace(/−/g, '-'), text: match[2] } : { cost: '', text: line };
        });
        while (abilities.length > 4) {
            abilities[3].text += '\n' + abilities.splice(4, 1)[0].text;
        }
        return abilities;
    }

    async function waitImages(images) {
        await Promise.all(images.filter(Boolean).map(function (image) {
            if (image.complete) return image.naturalWidth ? Promise.resolve() : Promise.reject(new Error('Immagine del frame non caricata'));
            return new Promise(function (resolve, reject) {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', () => reject(new Error('Immagine del frame non caricata')), { once: true });
            });
        }));
    }

    /**
     * API riutilizzabile: await autoPlaneswalkerFrame(variant, colors, mana, type,
     * powerOrLoyalty, oracleText?, initialLoyalty?). variant: Planeswalker oppure
     * PlaneswalkerBorderless. Per proxsmith passare esplicitamente oracle e loyalty.
     */
    async function buildPlaneswalkerFrame(variant, colors, mana, type, powerOrLoyalty, oracleText, initialLoyalty) {
        const borderless = variant === 'PlaneswalkerBorderless';
        const isPW = /planeswalker/i.test(type);
        const snapshot = {};
        Object.keys(card.text).forEach(key => { snapshot[key] = card.text[key].text; });
        // L'import nativo non conserva loyalty nel campo pt dei frame ordinari.
        const imported = typeof scryfallCard !== 'undefined'
            ? scryfallCard[document.querySelector('#import-index').value] : null;
        const matchesImport = imported && imported.type_line === type &&
            [imported.name, imported.printed_name].includes(snapshot.title);
        if (oracleText === undefined) {
            oracleText = snapshot.rules;
            if (oracleText === undefined) {
                oracleText = [0, 1, 2, 3].filter(i => snapshot['ability' + i]).map(function (i) {
                    const cost = card.planeswalker.abilities[i];
                    return (cost ? cost + ': ' : '') + snapshot['ability' + i];
                }).join('\n');
            }
            if (!oracleText && matchesImport) oracleText = imported.oracle_text;
        }
        if (initialLoyalty === undefined) {
            initialLoyalty = snapshot.loyalty || (matchesImport ? imported.loyalty : powerOrLoyalty) || '';
        }
        if (!isPW && matchesImport) {
            powerOrLoyalty = imported.power && imported.toughness ? imported.power + '/' + imported.toughness : '';
        }
        const abilities = splitAbilities(oracleText);
        // Tall solo per quattro blocchi di abilità, incluse quelle statiche.
        const tall = isPW && abilities.length === 4;
        const pack = isPW ? ('Planeswalker' + (tall ? 'Tall' : '') + (borderless ? 'Borderless' : tall ? '' : 'Regular'))
            : (borderless ? 'Borderless' : 'M15Regular-1');
        // Evita il click automatico non awaited di loadFramePack().
        const autoLoad = localStorage.getItem('autoLoadFrameVersion');
        localStorage.setItem('autoLoadFrameVersion', 'false');
        try {
            await loadScript('/js/frames/pack' + pack + '.js');
        } finally {
            if (autoLoad === null) localStorage.removeItem('autoLoadFrameVersion');
            else localStorage.setItem('autoLoadFrameVersion', autoLoad);
        }
        if (isPW) await loadVersion();
        else await document.querySelector('#loadFrameVersion').onclick();
        autoFramePack = pack;
        Object.keys(snapshot).forEach(key => { if (card.text[key]) card.text[key].text = snapshot[key]; });
        card.text.mana.text = mana;
        card.text.type.text = type;

        const preserved = card.frames.filter(frame => /Extension|Gray Holo Stamp|Gold Holo Stamp/.test(frame.name));
        let frames;
        if (!isPW) {
            card.text.rules.text = oracleText || '';
            card.text.pt.text = powerOrLoyalty || '';
            frames = buildAutoFrames(pack, colors, mana, type, powerOrLoyalty);
        } else {
            const letter = /artifact/i.test(type) || !colors.length ? 'A' : colors.length > 1 ? 'M' : colors[0];
            const names = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolored', A: 'Artifact' };
            const base = JSON.parse(JSON.stringify(availableFrames.find(frame => frame.name === names[letter] + ' Frame')));
            base.masks = [];
            // I planeswalker non usano corone, anche quando sono leggendari.
            frames = [base];
            card.text.loyalty.text = String(initialLoyalty);
            const total = scaleHeight(tall ? 0.3572 : 0.2915);
            const weights = abilities.map(ability => Math.max(1, ability.text.length));
            const sum = weights.reduce((a, b) => a + b, 0);
            for (let i = 0; i < 4; i++) {
                const ability = abilities[i];
                card.text['ability' + i].text = ability ? ability.text.replace(/\{\/?i\}/g, '').replace(/\(([^)]*)\)/g, '{i}($1){/i}') : '';
                document.querySelector('#planeswalker-cost-' + i).value = ability ? ability.cost : '';
                document.querySelector('#planeswalker-height-' + i).value = ability ? Math.round(total * weights[i] / sum) : 0;
                document.querySelector('#planeswalker-shift-' + i).value = 0;
            }
            planeswalkerEdited();
            // Allinea i simboli fedeltà al centro delle caselle con altezze diverse.
            abilities.forEach(function (ability, i) {
                const box = card.text['ability' + i];
                document.querySelector('#planeswalker-shift-' + i).value = scaleHeight(box.y + box.height / 2 - planeswalkerAbilityLayout[tall ? 1 : 0][abilities.length - 1][i]);
            });
            planeswalkerEdited();
            await waitImages([plusIcon, minusIcon, neutralIcon, lightToDark, darkToLight, planeswalkerTextMask]);
            planeswalkerEdited();
        }
        card.frames = preserved.concat(frames);
        document.querySelector('#frame-list').innerHTML = '';
        for (const frame of [...card.frames].reverse()) await addFrame([], frame);
        await waitImages(card.frames.flatMap(frame => [frame.image, ...frame.masks.map(mask => mask.image)]));
        await clampImportTextWidths('title');
        // Aggiorna l'editor dopo il cambio layout (senza rilanciare AutoFrame).
        document.querySelector('#text-editor').value = card.text[Object.keys(card.text)[selectedTextIndex]].text;
        drawTextBuffer();
        drawFrames();
    }

    // I pack e card sono globali: serializza chiamate PW concorrenti.
    let pending = Promise.resolve();
    window.autoPlaneswalkerFrame = function (...args) {
        clearTimeout(autoFrameTimer);
        const result = pending.then(() => buildPlaneswalkerFrame(...args));
        pending = result.catch(() => {});
        return result;
    };
})();
