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

## Confronto Chromium locale

FATTO VERIFICATO: importazione reale con risposta Scryfall di Ajani Steadfast
intercettata e artwork locale; asset, font e canvas reali. Sequenza nella stessa
pagina: M15Nickname → JapanShowcase → Borderless → JapanShowcase.

| Campo dell'ultima carta | Prima | Dopo |
| --- | --- | --- |
| `version` | `borderless` | `japanShowcase` |
| `artBounds.height` | `0.9224` | `0.9224` |
| `text.title.color` | `white` | `white` |
| `text.rules.font` | assente (font predefinito) | `Plantin-MT-Pro-Rg` |

In questa sequenza Borderless condivide bounds e colore con Japan, ma lascia
posizioni e font errati. Il testo di Ajani dopo il fix ha outline e occupa il
box Japan sotto il separatore; prima attraversa il separatore.

[PNG prima](evidence/ajani-before.png) · [PNG dopo](evidence/ajani-after.png).

Limiti del harness: fragment creator caricato direttamente (errore preesistente
`bindInputs is not defined`, superato dal bootstrap renderApi); charset del
fragment altera le virgolette nei PNG prima/dopo. Non è una verifica del server
remoto. Le anteprime sono screenshot a 500 px del PNG restituito dalla API.
