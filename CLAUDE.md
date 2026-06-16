# CLAUDE.md — repro-sign-survey-ui

## What this is

A single-page metadata annotation tool for reviewing research papers. Users see the paper PDF on the left and fill in structured metadata fields on the right. Built for a sign-language NLP survey to track reproducibility metadata (code repos, datasets, metrics).

## Stack

Plain HTML/CSS/JS — no framework, no build step, no npm. Don't introduce bundlers or frameworks unless explicitly asked.

## Running

```bash
python3 -m http.server 8765
# open http://localhost:8765
```

Must be served (not opened as `file://`) so that `fetch('data.json')` works. If it can't fetch `data.json`, it falls back to the hardcoded `FALLBACK_PAPER` constant in `app.js`.

## File layout

| File | Purpose |
|------|---------|
| `index.html` | Two-panel shell (PDF left, metadata form right) |
| `style.css` | Layout, form styles, tag chip styles |
| `app.js` | PDF.js init, form logic, localStorage persistence |
| `data.json` | Seed metadata; one entry per paper |

## Key behaviours

- **PDF viewer**: tries pdf.js (CDN v3.11.174) with page navigation. Falls back to a native `<iframe>` if pdf.js can't fetch the PDF (e.g. CORS-blocked sources like aclanthology.org).
- **Pre-filled fields** (title, year, venue): shown read-only with a pencil button. Click pencil → editable input; blur or Enter → back to display.
- **Empty fields** (code repo): plain input shown immediately.
- **Tag fields** (datasets, metrics): chip list with × removal; inline input + Add button (also triggered by Enter).
- **Save**: serialises form state to `localStorage` under `paper:<id>`. On load, localStorage is checked first and overrides `data.json` values.

## Adding papers

Add entries to `data.json`. Omit or leave `""` / `[]` for unknown fields — the form will show empty inputs for those.

```json
{
  "id": "unique-kebab-id",
  "pdf_url": "https://...",
  "title": "Paper Title",
  "year": 2024,
  "venue": "ACL",
  "code_repo": "",
  "datasets": ["DS1"],
  "metrics": []
}
```

Multi-paper navigation is not yet implemented; `app.js` always loads `papers[0]`. To switch papers, update the index or add a paper selector.
