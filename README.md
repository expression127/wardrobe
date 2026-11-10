# Wardrobe

A local-first, installable outfit-of-the-day web app. Vanilla HTML/CSS/JS
(ES modules), no backend, no build step. All data — items, photos, saved
combos, wear history, settings — lives in your browser's IndexedDB.

> **Your data lives only in this browser.** Clearing site data, reinstalling
> the browser, or switching devices loses everything that hasn't been
> exported. Use **Settings → Export all data** regularly, and keep the JSON
> file somewhere safe (cloud drive, NAS, etc.). **Import from JSON** restores
> everything (except photos, which are device-local blobs and intentionally
> excluded from the export).

## Running locally

No build step, but ES modules and the service worker require a real HTTP
server (not `file://`). Any static file server works, e.g.:

```bash
npx serve .
```

```bash
python -m http.server 8000
```

Then open the printed `http://localhost:...` URL.

## Running the tests

```bash
npm install
npm test
```

`tests/engine.test.js` covers `src/engine.js` — the pure outfit-recommendation
engine (laundry modes, swaps, combo variants, archiving, rain handling, and
wear-log integrity) — with no browser APIs involved.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**.
3. Push to `main`. `.github/workflows/deploy.yml` runs the test suite, then
   stages `index.html`, `manifest.webmanifest`, `sw.js`, `styles/`, `src/`
   and `icons/` (skipping `node_modules`, `tests/`, and `legacy/`) and
   publishes them via `actions/deploy-pages`.
4. Your app will be live at `https://<your-username>.github.io/<repo-name>/`.

Every asset reference in the app (`index.html`, `manifest.webmanifest`,
`sw.js`, and the ES module imports) uses **relative paths**, so it works
unmodified under a `/<repo-name>/` subpath — no configuration needed.

## Data model

Ported from the original SQLite schema into IndexedDB object stores of
plain JS objects: `items`, `photos` (downscaled to ≤800px, stored as blobs,
never exported), `combos`, `wearLog`, `rejections`, `settings`.

Key invariants, preserved from the original app and enforced in
`src/engine.js`:

- **`wearLog` is the source of truth for what was actually worn** — if you
  swap a slot before tapping "Wear this", the log records the swapped item,
  not the original recommendation.
- **`laundryMode` (`off` / `auto` / `full`) is branched on only in
  `availableItems()` and `logWear()`** — every other function (compatibility
  checks, scoring, recommendations, swaps) just consumes whatever
  `availableItems()` already decided was wearable.
- **`lastWorn` updates in every laundry mode** on every item worn; only
  `full` mode additionally marks items `dirty` (cleared later via the
  "Washed" button, which calls `markClean()`).
- **Swaps must pass `compatible()`** against the other items already in the
  outfit (formality within ±1, and `rain_ok` required when rain is
  expected) — a swap can never produce an incoherent combination.
- **Saved combos are preferred over generated outfits** in `recommend()`,
  but only when every item in the combo is currently available and
  compatible with the day's rain/formality target.
- **Combo variants**: saving an outfit after swapping a slot in a saved
  combo links the new combo to the original via `parentId`.

## Screens

- **Today** — recommended outfit by slot (top/bottom/outer/shoes), a
  1–5 formality selector, a rain toggle (defaulting from live weather),
  per-slot **Swap** (3 alternatives + "No layer" for the optional outer
  slot), **Reroll**, and **Wear this** (which then offers to save the
  outfit as a combo, linked as a variant if it came from a swapped saved
  combo).
- **Wardrobe** — grid of items; add/edit asks for a photo plus 5 fields
  (name, category, formality, rain-ok, tags — colours are just tags, kept
  deliberately minimal so adding an item is fast); archive instead of
  delete, so wear history stays intact.
- **Settings** — laundry mode, auto-reset days, "Washed" button (full
  mode), weather location, export/import, and wipe-all-data (with
  confirmation).
- **History** — the wear log: what was actually worn, when, and under what
  conditions.

## Weather

Fetched client-side from [Open-Meteo](https://open-meteo.com/) (no API key)
for the configured location (defaults to Singapore, 1.35, 103.82). The rain
flag is derived from the next few hours' precipitation probability, cached
for 30 minutes in `settings`, and fails gracefully (keeps the last known
value, or defaults to no rain) when offline.

## Not in v1

Calendar-based formality detection — use the manual formality buttons
instead.
