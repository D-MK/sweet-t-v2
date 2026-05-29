# Sweet-T

Lightweight glucose log + insulin calculator. Personal use, single device,
installable as a PWA, runs entirely in the browser.

![Sweet-T — 7-day glucose chart with insulin track and history](docs/screenshot.png)

## Insulin calculator

Input is glucose in mmol/L. The calculator applies a piecewise rule to
suggest a rapid-acting dose:

```
mgdl = mmol * 18
insulin = mgdl > 100 ? (mgdl - 80) / 40 : mgdl / 40
```

The suggestion is a starting point — you record what you actually took.

## Recording insulin taken

Each reading can log the doses actually administered, kept separate from
the calculated suggestion:

- **Humalog** (rapid / bolus) — prefilled with the suggested dose, editable.
- **Lantus** (long-acting / basal) — entered manually.
- **No insulin taken** clears both dose fields in one tap.
- **+ Log insulin only** records a dose with no glucose reading (e.g.
  bedtime Lantus). A reading is valid with a glucose value *or* a dose.

Doses appear in the 7-day chart as a colour-coded bar track beneath the
glucose line (Humalog cyan, Lantus pink). Insulin-only entries show in the
history but are excluded from the glucose average.

## Stack

- Vanilla HTML / CSS / JS (no build step, no node_modules)
- IndexedDB for storage (origin-scoped, no auth)
- Hand-rolled SVG line chart (7-day window) + insulin bar track
- Optional fire-and-forget cloud sync (glucose only) to a personal backend
- Service worker + Web App Manifest = installable, offline-capable PWA

## Running locally

```sh
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

## Deploy

Push to `main` and GitHub Pages auto-publishes the static site.

## Files

| Path | Purpose |
|---|---|
| `index.html` | UI shell |
| `app.js` | State, render, event wiring |
| `db.js` | IndexedDB CRUD wrapper |
| `chart.js` | SVG 7-day chart + insulin track |
| `sync.js` | Optional cloud-sync outbox (glucose only) |
| `styles.css` | Mobile-first dark theme |
| `sw.js` | Service worker (cache-first shell) |
| `manifest.webmanifest` | PWA metadata |
| `icons/` | PWA icons (192, 512) |

## Data export

The Export CSV button downloads every reading: ISO timestamp, mmol/L,
mg/dL, insulin suggestion, Humalog units, Lantus units, and notes. Import
CSV round-trips the same format.
