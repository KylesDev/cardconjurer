# AutoFrame Planeswalker

Le opzioni `Planeswalker` e `PlaneswalkerBorderless` caricano i pack PW esistenti.
Quattro blocchi di abilità (incluse quelle statiche) richiedono Tall; con tre o
meno si usa Regular, indipendentemente dalla lunghezza del testo. Il testo usa
il ridimensionamento nativo del font.
Le altezze sono proporzionali al testo e i simboli fedeltà seguono il centro delle caselle.
I planeswalker non hanno corone, indipendentemente dallo status leggendario.
Il fallback non PW mantiene la corona nativa solo per le carte leggendarie.

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

Nel tab Planeswalker, **Nascondi backdrop abilità** rimuove righe e transizioni,
conservando testo e simboli fedeltà. Lo stato `card.planeswalker.hideBackdrop`
resta nei salvataggi e nei cambi di pack; il campo assente equivale a `false`.
La funzione `window.setPlaneswalkerHideBackdrop(true)` permette lo stesso
controllo senza UI, dopo il caricamento di un frame PW.

Il renderer accetta `planeswalkerHideBackdrop` nella singola spec oppure in
`spec.render` / `manifest.render`. La spec prevale sul valore del deck; senza
opzione il render ripristina `false`, anche dopo una carta con backdrop nascosto.
Esempio: `proxsmithRenderCard({name: 'Liliana of the Veil', frame: 'Planeswalker',
render: {planeswalkerHideBackdrop: true}})`.

Verifiche locali:

```sh
node --test js/fork/tests/planeswalkerFrame.test.cjs
# Con Playwright installato e Chromium disponibile:
node --test js/fork/tests/planeswalkerFrame.browser.cjs
node --test js/fork/tests/planeswalkerBackdrop.browser.cjs
```

Il test browser serve i file del worktree tramite intercettazione delle richieste,
senza avviare server. Importa fixture Scryfall dei quattro PW richiesti, Grizzly
Bears e una variante leggendaria non PW, esegue l'import nativo e AutoFrame,
verifica frame caricati, versione, colore, costi, testi, altezze e fedeltà;
verifica l'assenza di corone sui PW e la corona solo nel fallback leggendario.
Ritarda la versione PW per riprodurre la
race. Arte e simbolo espansione non vengono scaricati.

Il renderer `js/fork/renderApi.js` chiama direttamente e attende il builder PW,
passando testo Oracle e fedeltà dall'import Scryfall corrente. Il frame e lo
split abilità terminano prima degli offset arte. Con un frame esplicito,
AutoFrame viene disabilitato durante l’import per evitare builder della carta
precedente ancora in corso. I manifest proxsmith contengono
già il frame risolto per ogni carta (default del mazzo oppure override).
Le opzioni sono dichiarate come `{ value, label }`, lette anche dal catalogo
proxsmith senza eseguire JavaScript.

Regressione del renderer, con risposte Scryfall locali:

```sh
node --test js/fork/tests/renderApiPlaneswalker.browser.cjs
```
