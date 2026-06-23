# CLAUDE.md — repro-sign-survey-ui

## What this is

A two-page metadata annotation tool for reviewing research papers. An overview page lists all papers with their review status. Each paper opens a detail view showing the PDF on the left and editable metadata fields on the right. Built for a sign-language NLP survey to track reproducibility metadata (code repos, datasets, metrics).

## Stack

Plain HTML/CSS/JS — no framework, no build step. Node/npm is used only for dev tooling (HTML validation, Playwright tests) — not required to run the app. Don't introduce bundlers or frameworks unless explicitly asked.

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
| `index.html` | Overview page: paper list with status badges, stats, search/filter |
| `overview.js` | Overview page logic: loads data.json, merges localStorage, search/filter/render |
| `paper.html` | Detail page: two-panel shell (PDF left, metadata form right) |
| `app.js` | Detail page logic: form, localStorage persistence, autocomplete, divider drag |
| `style.css` | Layout, form styles, tag chip styles, overview styles |
| `data.json` | Seed metadata; one entry per paper |
| `scripts/validate_data.py` | CI: validates data.json schema |
| `tests/smoke.spec.js` | Playwright smoke tests (overview + detail page) |
| `playwright.config.js` | Playwright config; auto-starts server.py for tests |
| `package.json` | Dev dependencies: html-validate, @playwright/test |
| `.github/workflows/ci.yml` | CI: syntax checks, JSON validation, HTML validation, Playwright |

## Key behaviours

- **Overview page** (`index.html`): lists all papers with ID, title, status badge, and a Review link. Shows counts per status. Search box filters by ID or title (live, substring). Status filter pills narrow to a specific status. "Review Next →" navigates to a random `needs_review` paper. "Reset to seed data" clears all localStorage.
- **PDF viewer**: native browser `<iframe>` routed through the local proxy (`/pdf/<id>.pdf?url=...`). Text selection, zoom, and all native controls work. No pdf.js.
- **Paper navigation**: ◀ ▶ buttons step through papers. URL updates via `history.replaceState` (`?id=<paper-id>`), so every paper has a stable direct link. "Copy link" button in the header copies the current URL to clipboard.
- **Status workflow**: four statuses — `needs_review`, `final`, `flagged`, `rejected`.
  - Save / Save & Next → marks as `final` (only if currently `needs_review`; flagged/rejected status is preserved).
  - Save & Next → advances to the next `needs_review` paper, skipping flagged/rejected/final.
  - Flag → opens a dialog to choose/enter a reason; stores `status: flagged` + `flag_reason`.
  - Reject → opens a dialog to choose/enter a reason; stores `status: rejected` + `rejection_reason`.
  - Flag and Reject buttons disable each other (clear/revert first).
  - "Clear flag" / "Revert rejection" link appears next to the badge to reset to `needs_review`.
  - Rejection/flag reason shown as tooltip on the status badge.
- **Pre-filled fields** (title, year, venue): shown read-only with a pencil button. Click pencil → editable input; blur or Enter → back to display.
- **Tag fields** (code repos, datasets, metrics): chip list with × removal; inline input + Add button (also triggered by Enter). Datasets and metrics have autocomplete dropdowns with predefined lists. Code repo chips are clickable links.
- **Persistence**: Save serialises form state + status (+ reason if flagged/rejected) to `localStorage` under `paper:<id>`. On load, localStorage is checked first and overrides `data.json` values.

## Testing

CI runs on every push/PR to main. To run locally:

```bash
python3 -m py_compile server.py          # Python syntax
python3 scripts/validate_data.py         # JSON schema
npm run validate:html                    # HTML validation
npx playwright test                      # Playwright smoke tests (auto-starts server)
```

Playwright tests cover: overview renders, search/filter, row click navigation, paper detail UI, Save → Final transition, ◀ ▶ navigation, back link. Each test runs in an isolated browser context with clean localStorage.

## Adding papers

Add entries to `data.json`. Omit or leave `""` / `[]` for unknown fields — the form will show empty inputs for those.

```json
{
  "id": "unique-kebab-id",
  "pdf_url": "https://...",
  "title": "Paper Title",
  "year": 2024,
  "venue": "ACL",
  "peer_reviewed": true,
  "code_repos": [],
  "datasets": ["DS1"],
  "metrics": [],
  "status": "needs_review"
}
```
