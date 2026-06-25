# CLAUDE.md — repro-sign-survey-ui

## What this is

A two-page metadata annotation tool for reviewing research papers. An overview page lists all papers with their review status. Each paper opens a detail view showing the PDF on the left and editable metadata fields on the right. Built for a sign-language NLP survey to track reproducibility metadata (code repos, datasets, metrics).

## Stack

Plain HTML/CSS/JS — no framework, no build step. Node/npm is used only for dev tooling (HTML validation, Playwright tests) — not required to run the app. Don't introduce bundlers or frameworks unless explicitly asked.

## Running

```bash
python3 server.py        # port 8765
python3 server.py 9000   # custom port
# open http://localhost:8765 — redirects to login.html if not authenticated
```

Use `server.py`, not bare `python3 -m http.server`. The custom server adds a `/pdf/<id>.pdf?url=<encoded>` endpoint that fetches PDFs server-side, bypassing both CORS restrictions and `X-Frame-Options: SAMEORIGIN` headers (e.g. OpenReview). Must be served (not `file://`) for the API fetch and proxy to work.

## Backend URL

`api.js` picks the PocketBase backend automatically based on where the frontend is served:

| Context | Backend used |
|---------|-------------|
| `localhost` | `http://localhost:8090` |
| Any other host | `https://repro-sign-survey.fly.dev` |

Override with a URL parameter on any page:

```
http://localhost:8765?backend=remote   # force Fly.io
http://localhost:8765?backend=local    # force local
```

The parameter is read once on page load from `window.location.search` in `api.js` (line 1).

## File layout

| File | Purpose |
|------|---------|
| `index.html` | Overview page: paper list with status badges, stats, search/filter |
| `overview.js` | Overview page logic: loads papers from PocketBase, search/filter/render |
| `paper.html` | Detail page: two-panel shell (PDF left, metadata form right) |
| `app.js` | Detail page logic: form, PocketBase persistence, edit locking, autocomplete, divider drag |
| `api.js` | Shared PocketBase client: auto-detected `PB_URL`, `pbGet`, `pbPatch`, `requireAuth`, token helpers |
| `login.html` | Login form: authenticates against PocketBase, stores token in sessionStorage |
| `style.css` | Layout, form styles, tag chip styles, overview styles |
| `data.json` | Reference seed data; validated by CI (no longer read by the frontend) |
| `scripts/validate_data.py` | CI: validates data.json schema |
| `tests/smoke.spec.js` | Playwright smoke tests (overview + detail page) |
| `playwright.config.js` | Playwright config; auto-starts server.py for tests |
| `package.json` | Dev dependencies: html-validate, @playwright/test |
| `.github/workflows/ci.yml` | CI: syntax checks, JSON validation, HTML validation, Playwright |

## Key behaviours

- **Auth**: all pages redirect to `login.html` if no PocketBase token is found in `sessionStorage`. Token is stored in `sessionStorage` (not `localStorage`) so it does not survive a browser restart.
- **Overview page** (`index.html`): lists all papers with ID, title, status badge, and a Review link. Shows counts per status. Search box filters by ID or title (live, substring). Status filter pills narrow to a specific status. "Review Next →" navigates to a random `needs_review` paper.
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
- **Persistence**: Save sends a PATCH to `POST /api/collections/papers/records/<id>` on PocketBase. Two IDs per record: `paper_id` (kebab slug used in URLs and display) and `id` (opaque PocketBase record ID used only for API calls).
- **Edit locking**: opening a paper acquires a lock by setting `locked_by` + `locked_at` on the record. A heartbeat PATCH fires every 60 s to keep the lock alive. On save, navigation, or tab close the lock is released (`locked_by: ""`). If PATCH returns 404, the paper is locked by another user — the form goes read-only with a notice banner. Lock expiry (30 min of inactivity) is enforced client-side only.

## Testing

CI runs on every push/PR to main. To run locally:

```bash
python3 -m py_compile server.py          # Python syntax
python3 scripts/validate_data.py         # JSON schema
npm run validate:html                    # HTML validation
PB_TEST_EMAIL=<email> PB_TEST_PASSWORD=<password> npx playwright test
```

Playwright tests require a running PocketBase backend and a valid user account. Pass credentials via environment variables — store them in a local `.env` file (gitignored) and source it, or pass inline as above. Without those variables the Playwright tests are skipped rather than failed (so CI still passes).

Playwright tests cover: overview renders, search/filter, row click navigation, paper detail UI, Save → Final transition (resets to `needs_review` first so the test is idempotent), ◀ ▶ navigation, back link.

## Adding papers

Papers are managed in the PocketBase backend (see backend repo). The frontend reads all records from `/api/collections/papers/records`. The `data.json` in this repo is reference seed data used only by CI schema validation — it is not read by the frontend.
