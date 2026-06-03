# Sweet-T

Lightweight glucose log + insulin calculator with carb tracking and trend
metrics. Personal use, single device, installable as a PWA, runs entirely
in the browser.

![Sweet-T — 7-day glucose chart with insulin track and history](docs/screenshot.png)

> Screenshot is from the pre-metrics build; it will be refreshed to show
> the new Metrics tab, scroll-wheel picker, and carb field.

## Insulin calculator

Input is glucose in mmol/L. The calculator applies a piecewise rule and
rounds **up** to the next whole unit — Humalog is only dosed in integers,
so the suggestion matches what actually goes in the pen:

```
mgdl = mmol * 18
raw  = mgdl > 100 ? (mgdl - 80) / 40 : mgdl / 40
suggestion = ceil(raw)
```

The suggestion is a starting point — you record what you actually took.

## Recording a reading

Each entry can capture glucose, two insulin doses, and optional carbs:

- **Humalog** (rapid / bolus) — prefilled with the rounded suggestion, editable.
- **Lantus** (long-acting / basal) — entered manually.
- **Carbs (g)** — optional grams of carbohydrate eaten with the meal,
  surfaced in CSV export and the Metrics tab.
- **No insulin taken** clears both dose fields in one tap.
- **+ Log insulin only** records a dose with no glucose reading (e.g.
  bedtime Lantus). A reading is valid with a glucose value *or* a dose
  *or* a carb entry.

Humalog, Lantus, and Carbs are entered through a scroll-wheel picker —
integers only, and **0 displays as blank** so empty values stay
unambiguous. Doses appear in the chart as a colour-coded bar track beneath
the glucose line (Humalog cyan, Lantus pink). Insulin-only and
carb-only entries show in history but are excluded from the glucose
average.

## Metrics tab

A dedicated **Metrics** view summarises trends over 7-, 14-, and 30-day
windows:

- **Estimated HbA1c (eAG)** — derived from the mean glucose using the
  ADAG formula, shown as both % and mmol/mol.
- **Min / max glucose** for the window.
- **Daily averages** for Humalog units, Lantus units, and carbs (g).

The chart itself has a range filter — **All / Year / Quarter / Month /
Week** — so the same view scales from "today" to "the last year" without
a separate report screen.

## Stack

- Vanilla HTML / CSS / JS (no build step, no node_modules)
- IndexedDB for storage (origin-scoped, no auth)
- Hand-rolled SVG line chart with range filter + insulin bar track
- Scroll-wheel picker (touch + wheel) for integer dose / carb entry
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
| `index.html` | UI shell + Log/Metrics tabs |
| `app.js` | State, render, event wiring |
| `db.js` | IndexedDB CRUD wrapper |
| `chart.js` | SVG chart + insulin track + range filter |
| `metrics.js` | eAG / min-max / daily-average calculations |
| `picker.js` | Scroll-wheel integer picker |
| `sync.js` | Optional cloud-sync outbox (glucose only) |
| `styles.css` | Mobile-first dark theme |
| `sw.js` | Service worker (cache-first shell) |
| `manifest.webmanifest` | PWA metadata |
| `icons/` | PWA icons (192, 512) |

## Data export

The Export CSV button downloads every reading: ISO timestamp, mmol/L,
mg/dL, insulin suggestion, Humalog units, Lantus units, carbs (g), and
notes. Import CSV round-trips the same format.
