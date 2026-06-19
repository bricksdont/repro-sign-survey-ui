# repro-sign-survey-ui

A lightweight web interface for annotating and reviewing reproducibility metadata of NLP research papers. Built for a survey of sign language papers.

An overview page lists all papers with their review status. Each paper opens a detail view showing the PDF on the left and editable metadata fields on the right. Annotations are saved locally in the browser.

![Overview page listing papers with status badges](overview-page.png)

![Paper detail page with PDF viewer and metadata form](paper-page.png)

## Features

- Overview page with paper list, status badges (Needs Review / Final / Flagged / Rejected), and stats
- Native browser PDF viewer via local proxy (text selection, zoom, full controls)
- Pre-filled fields shown read-only with one-click editing
- Tag chip inputs for datasets and metrics with autocomplete dropdowns
- Status workflow: Save or Save & Next marks a paper as Final; Flag prompts for a reason and marks it as Flagged (for team discussion); Reject prompts for a reason and marks it as Rejected
- Flagged and Rejected statuses are preserved on Save; can be cleared via an inline link
- Paper navigation (◀ ▶) and direct links from overview
- Saves to `localStorage` — survives page refresh, no backend needed

## Metadata fields

| Field | Notes |
|-------|-------|
| Title | Free text |
| Year | Integer |
| Venue | Conference/workshop abbreviation (e.g. EMNLP, ACL) |
| Peer-Reviewed | Yes / No radio |
| Code Repository | URL to accompanying code |
| Datasets | Multi-value tag list |
| Metrics | Multi-value tag list |

## Running

Requires a local HTTP server (the page fetches `data.json`):

```bash
python3 server.py
```

Then open [http://localhost:8765](http://localhost:8765).

`server.py` is a small wrapper around Python's built-in HTTP server that adds a `/pdf/<id>.pdf?url=<encoded>` proxy endpoint. This lets the browser's native PDF viewer embed PDFs from any host (including OpenReview, which sets `X-Frame-Options: SAMEORIGIN`) by fetching them server-side and stripping restrictive headers.

## Seed data

Paper metadata lives in `data.json`. Leave unknown fields as `""` or `[]` — the form renders empty inputs for those. Edits are saved per-paper to `localStorage` (key: `paper:<id>`).

## Tech

Plain HTML/CSS/JS — no framework, no build step.
