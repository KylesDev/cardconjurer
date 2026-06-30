# Spec: supporto frame Nickname in Import Deck

**Data:** 2026-06-30
**Stato:** approvato, pronto per implementazione

## Obiettivo

Estendere la funzionalità **Import Deck** (lista nomi carta o ZIP di immagini → mazzo
auto-framed) per supportare i **frame Nickname**: frame in cui un *nickname* va in cima
alla carta nell'apposito campo `Nickname`, mentre il nome originale della carta finisce nel
campo `Title` (spostato più in basso da quei frame).

Primo supporto a due frame con **regole d'assemblaggio identiche**:
- **Nickname Frames** → `packM15Nickname.js` (value dropdown: `M15Nickname`)
- **Nickname Frames (Extra Short)** → `packIkoNicknameShort.js` (value dropdown: `IkoNicknameShort`)

Regola d'assemblaggio (per entrambi): frame base del colore giusto + **Crown** se la carta è
`Legendary`, **altrimenti Title** (PNG del frame, non i campi di testo) + **Power/Toughness** se
creatura. Nome originale → campo `TITLE`, nickname → campo `NICKNAME`.

L'architettura deve essere **estensibile**: aggiungere frame nickname futuri (o non-nickname)
deve costare poco. Vedi §8.

## Decisioni di design (confermate dall'utente)

1. **Formato nickname unificato a parentesi quadre** `[Nickname]`, identico per decklist e nomi
   file (caratteri validi su ogni filesystem, un solo parser). Input senza `[...]` → comportamento
   identico a oggi (retrocompatibile).
2. **Fallback quando manca il nickname** (frame nickname selezionato ma carta senza `[...]`):
   nickname = nome della carta (in entrambi i campi Nickname e Title).
3. **Esposizione in entrambi i dropdown**: Import Deck (`#deck-autoframe`) e autoframe singola
   carta (`#autoFrame`), come fatto per Bloomburrow.

## Contesto del codice (verificato)

### Pipeline Import Deck (sia testo che ZIP)
`parseDeckList`/`parseImageFilename` → `cards: [{name, copies, ...}]` →
`importCardForDeck(name)` (Scryfall exact-name, popola `card.text.title/type/rules/mana/pt` via
`changeCardIndex`) → `autoFrame()` (costruisce `card.frames`) → render canvas → ZIP.

### File e funzioni rilevanti
- `js/creator-23.js`
  - `parseDeckList(deckListText)` — **~5072**. Regex `^(\d+)\s+(.+)$` → `{name, copies}`.
  - `generateDeck()` — **~5100**. Loop testo; chiama `importCardForDeck` poi `autoFrame()` (~5196).
  - `importCardForDeck(cardName)` — **~5463**. Scryfall exact-name; popola i campi testo.
  - `sanitizeFilename(name)` — **~5588**.
  - `handleSingleImageUpload`/`handleZipUpload` — **~5617 / ~5651**. Usano `parseImageFilename`.
  - `zipCardImages` (global) — **~5594**. Oggi: `{ [cardName]: [imageUrl, ...] }`.
  - `parseImageFilename(filename)` — **~5749**. Toglie ext, suffisso copia `_(\d+)$`, `_`→spazi.
  - `generateDeckFromZip()` — **~5762**. Costruisce `cards` da `zipCardImages`; chiama
    `importCardForDeck` poi `autoFrame()` (~5861).
- `js/autoFrame.js`
  - `getFrameTypeConfig(frameType)` — **~37**. Registry dei frame standard.
  - `autoFrameUnified(...)` — **~1598**. Costruttore generico (crown/PT centralizzati). **Non tocca
    il layout testo.**
  - `autoFrame()` — **~1639**. Color detection + routing. Ramo standard (`getFrameTypeConfig` +
    `autoFrameUnified`) e ramo speciale Bloomburrow (`autoBloomburrowFrame`, ~1743).
  - `autoBloomburrowFrame(...)` — **~1752**. Pattern di riferimento: filtra frame, ricostruisce
    `card.frames`, `addFrame([], item)` per ciascuno, reverse. **Da imitare.**
  - `cardFrameProperties(colors, mana, type, power)` — in `creator-23.js` (~695). Ritorna
    `{frame, pinline, pinlineRight, pt}` (lettere colore).
- `js/creator-23.js`
  - `addFrame(additionalMasks = [], loadingFrame = false)` — **~882**. Quando `loadingFrame` è un
    oggetto frame, lo aggiunge (carica image+masks, `card.frames.unshift`). Usato così da
    `autoBloomburrowFrame`: `addFrame([], frameObj)`.
  - `loadTextOptions(textObject, replace=true)` — **~1196**. `replace=true` sostituisce
    interamente `card.text` (azzera i valori).
- `creator/index.html`
  - `#deck-autoframe` (~759) e `#autoFrame` (~812): i due `<select>`. Gruppo "Custom frames".

### Struttura dei frame nickname (verificata su entrambi i pack)
Gli element name sono **identici** nei due pack (un solo handler li serve entrambi):
`'<Colore> Frame'`, `'<Colore> Crown'`, `'<Colore> Title'`, `'<Colore> Power/Toughness'`,
con `<Colore>` ∈ {White, Blue, Black, Red, Green, Multicolored, Artifact, Land, Colorless}.
Note: il PT esiste come `Colorless Power/Toughness` (non "Land"); esistono varianti `Artifact (Alt)`.

Layout testo del pack (definito in `loadFrameVersion.onclick`):
- `nickname`: `{x:0.0854, y:0.0522, ...}` (in alto, grande, `belerenb`)
- `title`: `{x:0.14, y:0.1129, ..., align:'center'}` (spostato giù, piccolo, `mplantini`)
- più `mana`, `type`, `rules`, `pt`.

**Punto critico:** nessun path di `autoFrame()` carica il layout testo. I frame standard
funzionano perché il default M15 combacia. I frame nickname **no**: senza caricare il layout
nickname, il campo `nickname` non esiste e il `title` resta in alto. Quindi l'handler nickname
DEVE applicare il layout del pack e poi ripopolare i valori testo.

## Implementazione

### 1. Parsing input (`js/creator-23.js`)

Helper condiviso (mettere vicino a `parseDeckList`/`parseImageFilename`):
```js
function splitNickname(rawName) {
  const m = rawName.match(/^(.*?)\s*\[(.+)\]\s*$/);
  return m ? { name: m[1].trim(), nickname: m[2].trim() }
           : { name: rawName.trim(), nickname: '' };
}
```

**`parseDeckList`**: dopo aver ottenuto `cardName` dal regex esistente, applicare `splitNickname`
e fare push di `{ name, nickname, copies }`.

**`parseImageFilename`**: cambiare il valore di ritorno a `{ name, nickname }`. Ordine:
1. togli estensione, 2. togli suffisso copia `_(\d+)$`, 3. `splitNickname`, 4. `_`→spazi su
**sia** `name` **sia** `nickname`, 5. trim.
Esempio: `Sol Ring [Il Mio Anello]_(2).png` → `{name:'Sol Ring', nickname:'Il Mio Anello'}`.

**`zipCardImages`** (`handleZipUpload`, `handleSingleImageUpload`, `clearUploadedFiles`,
`generateDeckFromZip`): la struttura passa da `{ [name]: [url,...] }` a
`{ [name]: { nickname, urls: [url,...] } }`. Il nickname è lo stesso per tutte le copie. In
`generateDeckFromZip` propagare `nickname` in ogni `cardEntry`. Aggiornare ogni punto che oggi
fa `zipCardImages[cardName].push(url)` e che itera `Object.entries(zipCardImages)`.
**Attenzione** a `handleSingleImageUpload`: oggi mette `cardName` (stringa) in `singleImageUpload`;
aggiornare per portare anche il nickname.

### 2. Threading del nickname fino ad `autoFrame()`

`autoFrame()` non riceve dati per-carta oltre a `card.text`. Introdurre una variabile globale,
settata dai due loop di generazione **subito prima** di chiamare `autoFrame()` e resettata dopo:
```js
window.deckImportNickname = cardEntry.nickname || '';
// ... autoFrame() ...
window.deckImportNickname = '';
```
Da fare in **entrambi** `generateDeck` (~5196) e `generateDeckFromZip` (~5861).
Nel flusso singola-carta (`setAutoFrame`) la variabile resta `''` → fallback = nome.

### 3. Registry + handler (`js/autoFrame.js`)

**Registry** (estensibile — qui si aggiungono i frame nickname futuri):
```js
const NICKNAME_FRAME_CONFIG = {
  'M15Nickname':      { pack: 'M15Nickname' },
  'IkoNicknameShort': { pack: 'IkoNicknameShort' }
};
```

**Routing** in `autoFrame()` — nuovo ramo `else if` accanto a quello di Bloomburrow (~1743):
```js
} else if (NICKNAME_FRAME_CONFIG[frame]) {
  autoNicknameFrame(
    NICKNAME_FRAME_CONFIG[frame], colors,
    card.text.mana.text, card.text.type.text, card.text.pt.text,
    window.deckImportNickname || ''
  );
  if (autoFramePack != frame) {
    loadScript('/js/frames/pack' + frame + '.js');
    autoFramePack = frame;
  }
}
```

**`autoNicknameFrame(config, colors, mana_cost, type_line, power, nickname)`** — passi:
1. **Assicurarsi che il pack sia caricato** (loadScript + attesa) così `availableFrames` e il
   `loadFrameVersion` del pack sono disponibili. (Vedi §6 sul timing — preferibile precaricare.)
2. **Snapshot** dei valori testo correnti: `title, type, rules, mana, pt` (settati da
   `importCardForDeck`).
3. **Applicare il layout nickname** eseguendo il `loadFrameVersion.onclick` del pack (stesso
   codice del flusso manuale: crea il campo `nickname`, sposta `title`, imposta art/symbol/
   watermark bounds e `card.version`). Questo **azzera** i valori testo (per quello serve lo
   snapshot). È `async` → da `await`.
4. **Ripristinare** i valori snapshot nei rispettivi campi (title = nome originale, type, rules,
   mana, pt). Solo le chiavi presenti.
5. **Settare il nickname**: `card.text.nickname.text = nickname || card.text.title.text`
   (fallback = nome carta).
6. **Assemblare i frame** imitando `autoBloomburrowFrame`: ricostruire `card.frames`
   (preservando eventuali extension/holo come fa Bloomburrow), selezionare gli element per nome
   da `availableFrames`, clonarli (`JSON.parse(JSON.stringify(el))`) e aggiungerli con
   `addFrame([], clone)`, con reverse finale come Bloomburrow. Ordine layer (dal basso):
   - base: `'<Colore> Frame'`
   - se `type_line.toLowerCase().includes('legendary')`: `'<Colore> Crown'`, **altrimenti**
     `'<Colore> Title'`
   - se la carta ha P/T (`power` non vuoto): `'<Colore> Power/Toughness'`
   Risolvere `<Colore>` riusando `cardFrameProperties(colors, mana_cost, type_line, power)`
   (lettera `frame`) e mappando: W→White, U→Blue, B→Black, R→Red, G→Green, M→Multicolored,
   A→Artifact, L→Land, C→Colorless. Per il PT mappare L→Colorless (non esiste "Land PT").
   Se un element name non esiste in `availableFrames`, saltarlo senza errori.

### 4. Dropdown (`creator/index.html`)

Aggiungere in **entrambi** i `<select>` (`#deck-autoframe` ~759 e `#autoFrame` ~812), nel gruppo
"Custom frames" (vicino a Bloomburrow):
```html
<option value="M15Nickname">Nickname Frames</option>
<option value="IkoNicknameShort">Nickname Frames (Extra Short)</option>
```
Il `value` combacia con la chiave del registry e con `pack<Value>.js` (così `loadScript` risolve).

## 5. Retrocompatibilità

- Decklist/file senza `[...]` → parse identico a oggi.
- Frame non-nickname → invariati.
- `parseImageFilename` cambia tipo di ritorno (`{name, nickname}`): aggiornare **tutti** i
  chiamanti (cercare gli usi in `creator-23.js`).

## 6. Rischio: timing async

I loop usano `setTimeout` fissi dopo `autoFrame()` (~1000ms). L'handler nickname aggiunge
loadScript (rete) + `loadFrameVersion` + caricamento immagini element. Al **primo** uso il pack
potrebbe non essere pronto entro il timeout.
**Mitigazione:** precaricare il pack **una volta prima del loop** in `generateDeck` /
`generateDeckFromZip` quando `selectedFrameStyle` è un frame nickname (loadScript + breve attesa),
così durante il framing per-carta è già disponibile. Mantenere le attese esistenti. Non rendere
`autoFrame()` awaitabile se non necessario (eviterebbe regressioni sugli altri rami).

## 7. Verifica (manuale, in browser)

1. Decklist mista:
   ```
   1 Llanowar Elves [Eletta degli Elfi]
   1 Sol Ring
   1 Questing Beast [La Bestia]
   ```
   con frame "Nickname Frames" selezionato → la prima ha nickname in alto e nome sotto; Sol Ring
   ha nickname = "Sol Ring" (fallback); Questing Beast (Legendary) usa la **Crown** non il Title.
2. Stessa decklist con "Nickname Frames (Extra Short)".
3. ZIP con file `Llanowar Elves [Eletta degli Elfi].png` e `Sol Ring.png` → stesso risultato.
4. Creatura → presenza del riquadro P/T; non-creatura → assente.
5. Frame standard (es. Regular, Bloomburrow) → comportamento invariato.
6. Carta con nome senza brackets su frame standard → invariato.

## 8. Estensione futura (note per chi aggiungerà altri frame)

Aggiungere un nuovo frame nickname con le **stesse** regole (Crown/Title/PT, element name
standard):
1. Voce in `NICKNAME_FRAME_CONFIG` (`'ValueDropdown': { pack: 'ValueDropdown' }`).
2. Due `<option value="ValueDropdown">…</option>` nei due select.
3. Verificare che `pack<ValueDropdown>.js` esponga gli element name
   `'<Colore> Frame/Crown/Title/Power/Toughness'` e definisca i campi testo `nickname`+`title` nel
   suo `loadFrameVersion`.

Frame con regole diverse (inner crown, holo stamp, split pinline multicolor, art bounds
particolari) → arricchire il `config` con flag/funzioni dedicate, sulla falsariga di
`getFrameTypeConfig` (`supportsCrown`, `makeFrameFunction`, ecc.) e ramificare in
`autoNicknameFrame`.

Per i frame **senza** nickname si continua a usare il path standard (`getFrameTypeConfig` +
`autoFrameUnified`) o un handler dedicato come Bloomburrow.
