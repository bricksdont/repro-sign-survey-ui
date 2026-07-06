# repro-sign-survey-ui

[![CI](https://github.com/bricksdont/repro-sign-survey-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/bricksdont/repro-sign-survey-ui/actions/workflows/ci.yml)

A lightweight web interface for annotating research papers across two independent tasks: **Reviewing** (reproducibility metadata) and **Checking** (empirical scope). Built for a survey of sign language NLP papers.

A landing page routes annotators to either task. Each task has its own overview listing papers with status badges and a detail page showing the PDF on the left and editable fields on the right. Annotations are saved to a shared PocketBase backend, enabling multiple annotators to work concurrently.

![Overview page listing papers with status badges](overview-page.png)

![Paper detail page with PDF viewer and metadata form](paper-page.png)

## Features

- Landing page with task cards routing to Reviewing or Checking
- Breadcrumb navigation (`Home → Reviewing` / `Home → Checking`) on all task pages

**Reviewing task** — add reproducibility metadata to papers:
- Overview with paper list, status badges (Needs Review / Final / Flagged / Rejected), stats
- Search by paper ID or title; filter by status; live result count; "Review Next →" for a random unreviewed paper
- Detail page: native browser PDF viewer (text selection, zoom, full controls) + metadata form
- Pre-filled fields (title, year, venue) shown read-only with one-click pencil editing
- Tag chip inputs for datasets, metrics, and code repositories (with autocomplete); code repo chips are clickable links
- Status workflow: Save / Save & Next → Final; Flag → reason dialog (`flagged`); Reject → reason dialog (`rejected`); inline clear/revert links
- Flag and reject reasons shown in the status badge text and as a tooltip

**Checking task** — verify paper scope in an independent paper set:
- Overview with paper list, status badges (Needs Check / Flagged / Checked), stats; "Check Next →"
- Detail page: two yes/no questions — "Paper has empirical results" and "Paper is on Sign Language Processing"
- Both questions must be answered before Save / Save & Next become active
- Status workflow: Save / Save & Next → Checked; Flag → reason dialog; inline clear link

**Shared features:**
- Paper navigation (◀ ▶); each paper has a stable URL with a one-click Copy link button
- Saves to a shared PocketBase backend — changes are immediately visible to all annotators
- Edit locking: only one annotator can edit a paper at a time; others see a read-only notice
- Auth: login with a PocketBase user account; token stored in `localStorage` with a 24-hour expiry, shared across tabs so copied paper links open without re-login
- Account menu: shows logged-in email and a logout button

## Metadata fields

### Reviewing

| Field | Notes |
|-------|-------|
| Title | Free text |
| Year | Integer |
| Venue | Conference/workshop abbreviation (e.g. EMNLP, ACL) |
| Peer-Reviewed | Yes / No radio |
| Code Repositories | Multi-value URL list; entries are clickable links |
| Datasets | Multi-value tag list with autocomplete |
| Metrics | Multi-value tag list with autocomplete |

### Checking

| Field | Notes |
|-------|-------|
| Title | Read-only display |
| Year | Read-only display |
| Paper has empirical results | Yes / No radio (required before Save) |
| Paper is on Sign Language Processing | Yes / No radio (required before Save) |

## Deployment

The frontend is deployed to Fly.io as a Docker container running `server.py`. The live URL is **https://repro-sign-survey-frontend.fly.dev** — anyone with a PocketBase account can log in there directly without running anything locally.

To redeploy after changes:

```bash
fly deploy
```

When accessed from the deployed URL, `api.js` automatically points at the Fly.io PocketBase backend (`https://repro-sign-survey.fly.dev`) — no configuration needed.

To deploy from scratch:

```bash
fly apps create repro-sign-survey-frontend
fly deploy
```

## Running the frontend server locally

Run the local server only if you need to develop or test the frontend:

```bash
python3 server.py
```

Then open [http://localhost:8765](http://localhost:8765). You will be redirected to a login page — enter your PocketBase email and password. The token is stored in `localStorage` and expires after 24 hours.

`server.py` is a small wrapper around Python's built-in HTTP server that adds a `/pdf/<id>.pdf?url=<encoded>` proxy endpoint. This lets the browser's native PDF viewer embed PDFs from any host (including OpenReview, which sets `X-Frame-Options: SAMEORIGIN`) by fetching them server-side and stripping restrictive headers.

## Backend

The frontend picks a backend by checking `window.location.hostname` — the hostname of the page URL in your browser's address bar:

- **`localhost`** → `http://localhost:8090` (local dev instance, see [backend repo](https://github.com/bricksdont/repro-sign-survey-backend))
- **Any other host** → `https://repro-sign-survey.fly.dev` (live Fly.io deployment)

So opening `http://localhost:8765` automatically talks to the local backend, and opening the same frontend from any deployed URL automatically talks to Fly.io — no config needed.

You can override the auto-detection with a `?backend=` URL parameter on any page:

```
http://localhost:8765?backend=remote   # point local frontend at the live backend
http://localhost:8765?backend=local    # force local backend from any host
```

The override is persisted in `localStorage` as `pb_backend`, so it survives page navigation and logout — you only need to set it once per browser.

## Development

CI runs on every push and pull request. To run the checks locally:

```bash
# Python syntax and JSON schema
python3 -m py_compile server.py
python3 scripts/validate_data.py

# HTML validation (requires Node)
npm install
npx playwright install chromium   # first time only
npm run validate:html

# Playwright smoke tests — require a running PocketBase backend and user credentials
PB_TEST_EMAIL=you@example.com PB_TEST_PASSWORD=yourpassword npx playwright test
```

The Playwright tests auto-start `server.py` on port 8765 (or reuse an already-running instance) and authenticate against PocketBase before each test. Without the `PB_TEST_EMAIL` / `PB_TEST_PASSWORD` environment variables the tests are skipped rather than failed, so CI passes without a backend.

## Running without a backend

If you want to try the tool without setting up a PocketBase instance, check out the [`standalone`](https://github.com/bricksdont/repro-sign-survey-ui/tree/standalone) tag. That version stores everything in `localStorage` — no login, no backend, no shared state:

```bash
git checkout standalone
python3 server.py
# open http://localhost:8765
```

## Tech

Plain HTML/CSS/JS — no framework, no build step. Node is a dev-only dependency (HTML validation + Playwright tests). PocketBase is the backend (separate repo).
