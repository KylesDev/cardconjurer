# Import Deck — estrazione in file fork (riferimento per manutenzione post-merge)

**Data:** 2026-06-30 · **Branch:** `develop`
**Scopo di questo documento:** spiegare *cosa* è stato spostato e *quali agganci restano* nei file
upstream, così che dopo un merge da `upstream/master` si possa diagnosticare e ripristinare in fretta
qualsiasi rottura. Per il design funzionale della feature vedi
`docs/superpowers/specs/2026-06-30-nickname-import-deck-design.md`.

## 1. Perché

La feature **Import Deck** (tab, generatori, parser, auto-frame nickname/borderless/Bloomburrow,
override set symbol, pannello collector info) è **fork-only**: non esiste su `upstream/master`. Era
però scritta **dentro file upstream** di grandi dimensioni:
- `js/creator-23.js` (~226KB, file upstream)
- `js/autoFrame.js` (~68KB, file upstream)
- `creator/index.html` (file upstream)

Grossi blocchi fork dentro file upstream sono calamite per i conflitti di merge. Sono stati quindi
estratti in un **unico file fork-only** che upstream non tocca mai, lasciando nei file upstream solo
pochi agganci minimi e marcati.

## 2. Cosa è stato fatto (commit della fase)

- `bdbba466` — fix testo nero→bianco su Bloomburrow (`autoBloomburrowFrame`).
- `e120197d` — estrazione del JS in `js/fork/deckImport.js` (−1035 righe da creator-23.js, −298 da autoFrame.js).
- `a77491bf` — agganci HTML: tag `<script>`, marker `<!-- FORK -->`, iniezione via JS delle option in `#autoFrame`.

## 3. Nuovo file: `js/fork/deckImport.js`

File fork-only, caricato con `<script defer src='/js/fork/deckImport.js'>` **dopo** autoFrame.js e
creator-23.js. Sezioni:

| Sezione | Contenuto | Proveniva da |
|---|---|---|
| 1 | `window.IMPORT_FRAME_CONFIG` (registry frame import) | autoFrame.js |
| 2 | `deckGenerationState`, costanti timeout, `zipCardImages`, `singleImageUpload` | creator-23.js |
| 3 | `window.clampImportTextWidths`, `window.autoElementFrame`, `window.autoBloomburrowFrame`, `window.makeBloomburrowFrameByLetter` | autoFrame.js |
| 4 | `splitNickname`, `parseDeckList`, `parseImageFilename` | creator-23.js |
| 5 | `fetchScryfallCardByExactName` | creator-23.js |
| 6 | `applyDeckSetSymbolOverride`, `applyDeckCollectorInfo`, `applyDeckArtOverride` | creator-23.js |
| 7 | `importCardForDeck`, `waitForCardReady`, `sanitizeFilename` | creator-23.js |
| 8 | `handleFileUpload`, `handleSingleImageUpload`, `handleZipUpload`, `clearUploadedFiles`, `clearZipImages`, `clearUploadedFilesUI` | creator-23.js |
| 9 | `generateDeck`, `generateSingleCard`, `generateDeckFromZip` | creator-23.js |
| 10 | IIFE che inietta le 4 `<option>` fork in `#autoFrame` | (nuovo) |

### Contratto di integrazione (IMPORTANTE)
- Tutto ciò che gli **agganci nei file upstream referenziano** è esposto su **`window.*`**
  (`window.IMPORT_FRAME_CONFIG`, `window.autoElementFrame`, `window.autoBloomburrowFrame`). Questo
  evita problemi di scope/TDZ tra `<script>` separati.
- Le funzioni chiamate dagli `onclick`/`onchange` inline del tab (es. `generateDeck`,
  `handleFileUpload`, `clearUploadedFilesUI`) sono **dichiarazioni `function` top-level** → globali.
- **Ordine di caricamento obbligatorio:** autoFrame.js → creator-23.js → **deckImport.js** (tutti
  `defer`, quindi eseguiti in ordine dopo il parsing del DOM). L'IIFE della Sezione 10 richiede che
  `#autoFrame` esista nel DOM: garantito da `defer`.

## 4. Agganci residui nei file upstream (da controllare dopo ogni merge)

Tutti marcati con `FORK: import-deck`. **Se un merge upstream li rimuove o sposta, la feature si rompe
silenziosamente** (a runtime, non a compile-time). Ripristinarli è banale (sotto).

### 4.1 `js/autoFrame.js` — dispatch in `autoFrame()` (~righe 1747-1769)
Due rami `else if` dentro la funzione upstream `autoFrame()`:
```js
} else if (frame == 'BloomburrowBorderlessColored') {
    // FORK: import-deck frame dispatch — autoBloomburrowFrame defined in js/fork/deckImport.js
    if (window.autoBloomburrowFrame) {
        window.autoBloomburrowFrame(colors, card.text.mana.text, card.text.type.text, card.text.pt.text);
    }
    if (autoFramePack != frame) { loadScript('/js/frames/pack' + frame + '.js'); autoFramePack = frame; }
} else if (window.IMPORT_FRAME_CONFIG && window.IMPORT_FRAME_CONFIG[frame]) {
    // FORK: import-deck frame dispatch — IMPORT_FRAME_CONFIG and autoElementFrame defined in js/fork/deckImport.js
    if (window.autoElementFrame) {
        window.autoElementFrame(window.IMPORT_FRAME_CONFIG[frame], colors,
            card.text.mana.text, card.text.type.text, card.text.pt.text, window.deckImportNickname || '');
    }
    if (autoFramePack != frame) { loadScript('/js/frames/pack' + frame + '.js'); autoFramePack = frame; }
}
```
Vanno **dentro** la catena `if/else if` di `autoFrame()`, dopo il ramo standard
(`getFrameTypeConfig`/`autoFrameUnified`). Marker anche a righe ~25-26 e ~1772-1773.
**Rischio merge:** se upstream riscrive il dispatch di `autoFrame()`, questi rami vanno riapplicati.

### 4.2 `creator/index.html` — quattro punti marcati `<!-- FORK: import-deck ... -->`
- **~109-111**: voce di navigazione del tab "Import Deck" (il bottone/toggle del tab).
- **~743-847**: l'intero contenuto del tab `#creator-menu-importDeck` (decklist, upload, set symbol,
  pannello collector info collassabile).
- **~897-899**: nel `<select id="autoFrame">` (upstream condiviso): l'opzione Bloomburrow resta in
  HTML; le 4 opzioni fork (`M15Nickname`, `IkoNicknameShort`, `PromoRegular-1`, `IkoShort`) **NON**
  sono nell'HTML — vengono iniettate dalla Sezione 10 di deckImport.js.
- **~1105-1106**: il tag `<script defer src='/js/fork/deckImport.js'>` (dopo creator-23.js).

Nota: il `<select id="deck-autoframe">` (dentro il tab fork) contiene invece le opzioni direttamente
in HTML — è tutto fork, quindi non serve iniettarle.

### 4.3 Nessun aggancio in `creator-23.js`
Il blocco deck import era in coda al file ed è stato rimosso; il file termina ora **esattamente come
upstream** (righe di init `loadScript(...groupStandard-3...)` … `initDraggableArt()`), seguite da un
commento segnaposto. **Verifica post-merge:** se upstream aggiunge codice in coda a creator-23.js, il
merge lo integra normalmente; nessun aggancio fork da preservare qui.

## 5. Checklist post-merge (da `upstream/master`)

1. **Conflitti dichiarati da git:** risolverli. Punti caldi: il dispatch di `autoFrame()` (§4.1) e le
   zone HTML marcate (§4.2). Cercare `FORK: import-deck` per ritrovarli:
   `git grep -n "FORK: import-deck"`.
2. **autoFrame():** verificare che i due rami fork siano ancora presenti e raggiungibili (dopo il ramo
   standard, prima della chiusura della funzione). Se upstream ha cambiato il nome o la firma di
   `autoFrame`/`getFrameTypeConfig`/`autoFrameUnified`/`loadScript`, adeguare.
3. **Tag `<script>`:** confermare che `js/fork/deckImport.js` sia ancora incluso **dopo** autoFrame.js
   e creator-23.js, e che siano tutti `defer` (o tutti non-defer, comunque coerenti e in ordine).
4. **Funzioni upstream chiamate dal fork** (se upstream le rinomina/cambia firma, il fork si rompe a
   runtime): `changeCardIndex`, `importCard`, `addFrame`, `drawFrames`, `drawCard`, `loadTextOptions`,
   `loadFrameVersion` (onclick), `fetchSetSymbol`, `resetSetSymbol`, `bottomInfoEdited`,
   `setBottomInfoStyle`, `cardFrameProperties`, `loadScript`, `cardCanvas`, `blank`, `setSymbol`,
   `availableFrames`, `card.*`, `#info-*` / `#set-symbol-*` input id. Verificare che esistano ancora con
   stessi nomi/firme.
5. **Sintassi:** `node --check js/creator-23.js js/autoFrame.js js/fork/deckImport.js`.
6. **Smoke test in browser** (vedi §7).

## 6. Come riapplicare un aggancio perso (se un merge lo cancella)

- **Dispatch autoFrame():** reincollare i due rami di §4.1 nella catena `if/else if` di `autoFrame()`.
- **Tag script:** reinserire `<script defer src='/js/fork/deckImport.js'></script>` dopo creator-23.js.
- **Tab HTML:** se il tab sparisce, recuperarlo dalla cronologia git del blocco marcato
  (`git log -p --all -- creator/index.html`) o dai commit `91b45ca9` (tab originale) / `a77491bf`.
- **Opzioni `#autoFrame`:** sono iniettate da deckImport.js §10 — nessuna azione HTML necessaria, basta
  che il file sia caricato.

## 7. Verifica manuale in browser (smoke test)

1. Tab Import Deck visibile, controlli renderizzati.
2. `#autoFrame` (auto-frame singola carta) elenca, dopo Bloomburrow: Nickname Frames, Nickname Frames
   (Extra Short), Borderless Frames, Borderless Frames (Extra Short).
3. Genera mazzo testo con frame Nickname (es. `1 Llanowar Elves [Elf Bestie]`, `1 Sol Ring`,
   `1 Questing Beast [The Beast]`): nickname in alto, fallback al nome se assente, Crown su legendary.
4. Idem con Nickname (Extra Short), Borderless, Borderless (Extra Short), Bloomburrow (testo **bianco**).
5. Upload ZIP `Nome [Nick].png` e singola immagine.
6. Toggle "Insert set symbol" (off / on+codice / on+vuoto) e pannello "Collector info" (numero
   progressivo, rarità/artista da carta, campi uniformi).
7. Frame **non-fork** (es. Regular) da `#autoFrame` → nessuna regressione.

## 8. Verifiche statiche già effettuate alla fase di estrazione

`node --check` su tutti e 3 i file OK; 0 definizioni residue dei simboli spostati negli originali;
creator-23.js coincide con la coda upstream; nessun riferimento dangling esterno (solo gli agganci
`window.*` marcati in autoFrame.js); opzioni `#autoFrame` rimosse dall'HTML e iniettate via JS con
guardia anti-duplicato; `onclick` inline risolti a funzioni globali. **Runtime non verificato in
browser** (ambiente headless) — usare la §7.
