# repro-sign-survey-ui

[![CI](https://github.com/bricksdont/repro-sign-survey-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/bricksdont/repro-sign-survey-ui/actions/workflows/ci.yml)

A lightweight web interface for annotating and reviewing reproducibility metadata of NLP research papers. Built for a survey of sign language papers.

An overview page lists all papers with their review status. Each paper opens a detail view showing the PDF on the left and editable metadata fields on the right. Annotations are saved locally in the browser.

![Overview page listing papers with status badges](overview-page.png)

![Paper detail page with PDF viewer and metadata form](paper-page.png)

## Features

- Overview page with paper list, status badges (Needs Review / Final / Flagged / Rejected), and stats
- Search by paper ID or title; filter by status; live result count
- "Review Next →" button picks a random unreviewed paper
- Native browser PDF viewer via local proxy (text selection, zoom, full controls)
- Pre-filled fields shown read-only with one-click editing
- Tag chip inputs for datasets, metrics, and code repositories (with autocomplete for datasets and metrics)
- Code repository chips are clickable links opening in a new tab
- Status workflow: Save or Save & Next marks a paper as Final; Flag prompts for a reason (for team discussion); Reject prompts for a reason
- Flagged and Rejected statuses are preserved on Save; can be cleared via an inline link
- Paper navigation (◀ ▶); each paper has a stable URL (`paper.html?id=<id>`) with a one-click Copy link button
- Saves to `localStorage` — survives page refresh, no backend needed

## Metadata fields

| Field | Notes |
|-------|-------|
| Title | Free text |
| Year | Integer |
| Venue | Conference/workshop abbreviation (e.g. EMNLP, ACL) |
| Peer-Reviewed | Yes / No radio |
| Code Repositories | Multi-value URL list; entries are clickable links |
| Datasets | Multi-value tag list with autocomplete |
| Metrics | Multi-value tag list with autocomplete |

## Running

Requires a local HTTP server (the page fetches `data.json`):

```bash
python3 server.py
```

Then open [http://localhost:8765](http://localhost:8765).

`server.py` is a small wrapper around Python's built-in HTTP server that adds a `/pdf/<id>.pdf?url=<encoded>` proxy endpoint. This lets the browser's native PDF viewer embed PDFs from any host (including OpenReview, which sets `X-Frame-Options: SAMEORIGIN`) by fetching them server-side and stripping restrictive headers.

## Seed data

Paper metadata lives in `data.json`. Leave unknown fields as `""` or `[]` — the form renders empty inputs for those. Edits are saved per-paper to `localStorage` (key: `paper:<id>`).

## Development

CI runs on every push and pull request. To run the checks locally:

```bash
# Python syntax and JSON schema
python3 -m py_compile server.py
python3 scripts/validate_data.py

# HTML validation and Playwright smoke tests (requires Node)
npm install
npx playwright install chromium   # first time only
npm run validate:html
npx playwright test
```

The Playwright tests auto-start `server.py` on port 8765, or reuse an already-running instance.

## Tech

Plain HTML/CSS/JS — no framework, no build step. Node is a dev-only dependency (HTML validation + Playwright tests).
