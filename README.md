# PLONK 🎛️

En **PO-14-inspirerad bas-synt och 16-stegs sequencer** — byggd som en webbapp (PWA)
så att den går att köra fullskärm direkt på din iPhone, precis som en riktig
Teenage Engineering Pocket Operator.

- **Frontend:** Web Audio API (all ljudsyntes sker i webbläsaren), touch-optimerad PO-look
- **Backend:** Node/Express som servar appen och sparar/laddar dina patterns
- **PWA:** lägg till på hemskärmen → egen app-ikon, fullskärm, funkar offline

## Kör igång

```bash
npm install
npm start
```

Terminalen skriver ut två adresser:

```
Local:   http://localhost:3000        (på datorn)
iPhone:  http://192.168.x.x:3000      (samma Wi-Fi)
```

## Kör på iPhone 17

1. Se till att iPhone och datorn är på **samma Wi-Fi**.
2. Öppna `iPhone`-adressen ovan i **Safari**.
3. Tryck på **Dela** → **Lägg till på hemskärmen**.
4. Starta PLONK från hemskärmen — nu körs den fullskärm som en app. 🎉

> Ljud på iOS startar först efter första tryckningen (tryck **play** eller en ruta) —
> det är Apples krav, appen sköter resten.

## Så spelar du

| Knapp | Vad den gör |
|-------|-------------|
| **play** | Startar/stoppar sequencern |
| **write** | Redigeringsläge — tryck på en ruta (1–16) för att lägga till/ta bort ett steg |
| **sound** | Tryck **sound**, sen en ruta (1–16) = välj ett av 16 basljud |
| **pattern** | Tryck **pattern**, sen en ruta = byt mellan 16 patterns (1–5 är demo-mönster: boom bap, house, acid, electro, dub) |
| **clear** | Rensar aktuellt pattern |
| **− / + bpm** | Tempo (40–240 BPM) |
| **save / load** | Sparar/laddar hela ditt set (16 patterns) till servern |
| **klaviaturen** | Väljer tonhöjd. I write-läge skrivs den tonen till nästa ruta du trycker på |
| **FX (lp/hp/echo/wah)** | Håll in för live-effekt medan det spelar |

Programmera en baslinje: tryck **write** → välj en ton på klaviaturen → tryck en ruta.
Upprepa. Tryck **play**.

## Projektstruktur

```
server.js              Express-server + spara/ladda-API (data/patterns.json)
public/
  index.html           UI
  styles.css           PO-14-stil
  app.js               Sequencer + UI-logik
  audio.js             Web Audio synt (16 basljud + FX)
  manifest.webmanifest PWA-manifest
  sw.js                Service worker (offline)
  icons/               App-ikoner
scripts/make-icons.mjs Genererar app-ikonerna
```

## API

| Metod | Väg | Beskrivning |
|-------|-----|-------------|
| `GET` | `/api/patterns` | Lista sparade set |
| `GET` | `/api/patterns/:id` | Hämta ett set |
| `POST` | `/api/patterns` | Spara nytt set |
| `PUT` | `/api/patterns/:id` | Uppdatera set |
| `DELETE` | `/api/patterns/:id` | Ta bort set |

Om servern inte nås faller spara/ladda tillbaka på webbläsarens `localStorage`.
