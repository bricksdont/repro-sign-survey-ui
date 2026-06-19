# CLAUDE.md — repro-sign-survey-ui

## What this is

A two-page metadata annotation tool for reviewing research papers. An overview page lists all papers with their review status. Each paper opens a detail view showing the PDF on the left and editable metadata fields on the right. Built for a sign-language NLP survey to track reproducibility metadata (code repos, datasets, metrics).

## Stack

Plain HTML/CSS/JS — no framework, no build step, no npm. Don't introduce bundlers or frameworks unless explicitly asked.

## Running

```bash
python3 server.py        # port 8765
python3 server.py 9000   # custom port
# open http://localhost:8765
```

Use `server.py`, not bare `python3 -m http.server`. The custom server adds a `/pdf/<id>.pdf?url=<encoded>` endpoint that fetches PDFs server-side, bypassing both CORS restrictions and `X-Frame-Options: SAMEORIGIN` headers (e.g. OpenReview). Must be served (not `file://`) for `fetch('data.json')` and the proxy to work.

## File layout

| File | Purpose |
|------|---------|
| `index.html` | Overview page: paper list with status badges and stats |
| `overview.js` | Overview page logic: loads data.json, merges localStorage, renders table |
| `paper.html` | Detail page: two-panel shell (PDF left, metadata form right) |
| `app.js` | Detail page logic: form, localStorage persistence, autocomplete, divider drag |
| `style.css` | Layout, form styles, tag chip styles, overview styles |
| `data.json` | Seed metadata; one entry per paper |

## Key behaviours

- **Overview page** (`index.html`): lists all papers with ID, title, status badge, and a Review link. Shows counts of Final vs Needs Review papers. "Reset to seed data" button clears all localStorage and reverts to `data.json`.
- **PDF viewer**: native browser `<iframe>` routed through the local proxy (`/pdf/<id>.pdf?url=...`). The browser's own PDF viewer handles rendering — text selection, zoom, and all native controls work. No pdf.js.
- **Paper navigation**: ◀ ▶ buttons in the detail page header step through papers. URL updates via `history.replaceState` (`?id=<paper-id>`), enabling direct links from the overview.
- **Status workflow**: each paper is either `needs_review` or `final`. Clicking Save or Save & Next marks the current paper as Final and updates the status badge. Save & Next then advances to the next non-final paper (or returns to the overview if all are done).
- **Pre-filled fields** (title, year, venue): shown read-only with a pencil button. Click pencil → editable input; blur or Enter → back to display.
- **Empty fields** (code repo): plain input shown immediately.
- **Tag fields** (datasets, metrics): chip list with × removal; inline input + Add button (also triggered by Enter). Both fields have autocomplete dropdowns with predefined lists, filtered by prefix as the user types.
- **Persistence**: Save serialises form state + status to `localStorage` under `paper:<id>`. On load, localStorage is checked first and overrides `data.json` values.

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
  "metrics": [],
  "status": "needs_review"
}
```
