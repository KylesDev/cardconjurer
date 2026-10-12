# Regressione layout renderApi

Dalla root del repository, con Node.js (nessuna dipendenza aggiuntiva):

```sh
node --test js/fork/tests/renderApi.test.cjs
```

Il test usa pack e builder reali (`autoFrame.js`, `deckImport.js`), simulando
DOM, canvas e risposta dell'importazione Scryfall. Non verifica i pixel.
Copre sessioni condivise, frame nativi/IMPORT alternati, catalogo degli asset,
nickname, offset/zoom dopo layout asincrono, alias e preferenza auto-load.

FATTO VERIFICATO sul codice precedente (`ea3cd754`): 6 test falliscono su 8.
Con auto-load attivo, Japan → Borderless → Japan lascia `version: borderless`.
Con auto-load disattivato, M15Nickname → Japan mantiene `m15Nickname`.
M15Nickname → IkoNicknameShort → M15Nickname mantiene `ikoNicknameShort`
e usa gli asset del secondo pack. Dopo il fix: 8 test passano.

Per ripetere il confronto senza modificare il file del renderer, salvare il
contenuto precedente in un file temporaneo e passarlo al test:

```sh
CC_RENDER_API_SOURCE=/percorso/renderApi-precedente.js node --test js/fork/tests/renderApi.test.cjs
```

Il confronto visuale di Ajani e il report Chromium sono allegati al task/PR.
L'e2e remoto tramite proxsmith resta una verifica separata: questo repository
non contiene il driver Python e non modifica servizi di produzione.
