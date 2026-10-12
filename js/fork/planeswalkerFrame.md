# AutoFrame Planeswalker

Le opzioni `Planeswalker` e `PlaneswalkerBorderless` caricano i pack PW esistenti.
Quattro blocchi di testo (incluse abilità statiche) richiedono Tall; per tre o meno,
la stima delle righe con il font del pack seleziona Tall se supera lo spazio normale.
Le altezze sono proporzionali al testo e i simboli fedeltà seguono il centro delle caselle.

Per proxsmith, dopo l'import e prima degli offset arte:

```js
await window.autoPlaneswalkerFrame(
    frameKey,           // 'Planeswalker' oppure 'PlaneswalkerBorderless'
    spec.colors, spec.mana_cost, spec.type_line,
    spec.power && spec.toughness ? `${spec.power}/${spec.toughness}` : '',
    spec.oracle_text, spec.loyalty || ''
);
```

La promise attende pack, layout, versione PW e immagini. Il builder applica
anche il fallback Regular/Borderless alle carte non PW. Nell'UI, senza gli
ultimi due argomenti, ricava il testo dalle caselle e la fedeltà dall'import
Scryfall corrente o dalla casella fedeltà. DFC/MDFC e Compleated sono fuori scope.

Verifiche locali:

```sh
node --test js/fork/tests/planeswalkerFrame.test.cjs
# Con Playwright installato e Chromium disponibile:
node --test js/fork/tests/planeswalkerFrame.browser.cjs
```

Il test browser serve i file del worktree tramite intercettazione delle richieste,
senza avviare server. Importa fixture Scryfall dei quattro PW richiesti e Grizzly
Bears, esegue l'import nativo e AutoFrame, verifica frame caricati, versione,
colore, costi, testi, altezze e fedeltà. Ritarda la versione PW per riprodurre la
race. Arte e simbolo espansione non vengono scaricati.
