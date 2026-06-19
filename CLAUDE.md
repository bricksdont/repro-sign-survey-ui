# CLAUDE.md — repro-sign-survey-ui

## What this is

A single-page metadata annotation tool for reviewing research papers. Users see the paper PDF on the left and fill in structured metadata fields on the right. Built for a sign-language NLP survey to track reproducibility metadata (code repos, datasets, metrics).

## Stack

Plain HTML/CSS/JS — no framework, no build step, no npm. Don't introduce bundlers or frameworks unless explicitly asked.

## Running

```bash
python3 server.py        # port 8765
python3 server.py 9000   # custom port
# open http://localhost:8765
```

Use `server.py`, not bare `python3 -m http.server`. The custom server adds a `/proxy-pdf?url=<encoded>` endpoint that fetches PDFs server-side, bypassing both CORS restrictions and `X-Frame-Options: SAMEORIGIN` headers (e.g. OpenReview). Must be served (not `file://`) for `fetch('data.json')` and the proxy to work.

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
