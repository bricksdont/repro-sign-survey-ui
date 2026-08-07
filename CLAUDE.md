# CLAUDE.md — repro-sign-survey-ui

## What this is

A multi-page metadata annotation tool with two independent tasks: **Reviewing** and **Checking**, plus shared **Datasets** and **Metrics** catalogues. A landing page lets annotators choose which task to work on. Each task has its own overview page listing papers with status badges and a detail page showing the PDF on the left and editable fields on the right. Built for a sign-language NLP survey to track reproducibility metadata (code repos, datasets, metrics) and to verify paper scope.

## Stack

Plain HTML/CSS/JS — no framework, no build step. Node/npm is used only for dev tooling (HTML validation, Playwright tests) — not required to run the app. Don't introduce bundlers or frameworks unless explicitly asked.

## Running

```bash
python3 server.py        # port 8765
python3 server.py 9000   # custom port
# open http://localhost:8765 — redirects to login.html if not authenticated
```

Use `server.py`, not bare `python3 -m http.server`. The custom server adds a `/pdf/<id>.pdf?url=<encoded>` endpoint that fetches PDFs server-side, bypassing both CORS restrictions and `X-Frame-Options: SAMEORIGIN` headers (e.g. OpenReview). Must be served (not `file://`) for the API fetch and proxy to work.

If the direct fetch fails (dead link, paywall), the proxy falls back to fetching `<id>.pdf` from a private Cloudflare R2 bucket, for papers whose PDF has been manually re-hosted there as a preparation step. Requires `boto3` (`pip install -r requirements.txt` — optional for local dev; without it, or without the `R2_*` env vars below set, the fallback is silently skipped and the original fetch error is returned) and four Fly secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. No changes to `papers.pdf_url` are needed — the fallback is automatic and keyed purely off the paper's `id`.

"Failure" isn't just a network error or 4xx/5xx status — a `pdf_url` that's a DOI link commonly redirects to a publisher landing page, or gets a WAF/bot-challenge response, both of which can come back as HTTP 200/202 with an empty or HTML body instead of a real PDF. `_looks_like_pdf()` checks the fetched bytes start with the `%PDF-` magic header before accepting a direct fetch as successful; anything else is treated as a failure and falls through to the R2 attempt exactly like a network error would.

## Backend URL

`api.js` checks `window.location.hostname` (the hostname in the browser's address bar) to pick a backend:

| `window.location.hostname` | Backend used |
|---------|-------------|
| `localhost` | `http://localhost:8090` |
| Anything else | `https://repro-sign-survey-backend.fly.dev` |

Override with a URL parameter on any page:

```
http://localhost:8765?backend=remote   # force Fly.io
http://localhost:8765?backend=local    # force local
```

The override is stored in `localStorage` as `pb_backend` the first time it is seen, so it persists across page navigations and logout. It is NOT cleared on logout — it is a routing preference, not a credential.

## File layout

| File | Purpose |
|------|---------|
| `index.html` | Landing page: task selection cards (Reviewing / Checking / Datasets / Metrics) |
| `review-index.html` | Reviewing overview: paper list with status badges, stats, search/filter |
| `paper.html` | Review detail page: two-panel shell (PDF left, metadata form right) |
| `check-index.html` | Checking overview: check_papers list with Needs Check / Flagged / Checked statuses |
| `paper-check.html` | Check detail page: two yes/no questions (empirical results, SLP scope), flag workflow |
| `datasets-index.html` | Datasets overview: table of all datasets (name, license, availability, URL); rows navigate to detail page |
| `dataset.html` | Dataset detail page: form for name, license, URLs, availability, comments; edit locking; `?id=<pb-id>` |
| `metrics-index.html` | Metrics overview: table of all metrics (name, URL, comments); rows navigate to detail page |
| `metric.html` | Metric detail page: form for name, URLs, comments; edit locking; `?id=<pb-id>` |
| `stats.html` | Review Stats dashboard: status breakdown, top finalizers, top datasets/metrics, SLP area breakdown, answered-fields table |
| `login.html` | Login form: authenticates against PocketBase, stores token in localStorage with 24h expiry; also a "Sign in with Slack" OAuth2 button |
| `oauth-redirect.html` | OAuth2 callback page: completes the Slack sign-in code exchange and redirects to `next` |
| `register.html` | Self-service registration page (currently disabled — new registrations are blocked server-side) |
| `js/api.js` | Shared PocketBase client: auto-detected `PB_URL`, `pbGet`, `pbPatch`, `pbGetAll`, `requireAuth`, token helpers, `startOAuth2`/`completeOAuth2`; requests are wrapped with a 10s timeout and network-failure handling (`fetchWithTimeout()`) |
| `js/review/overview.js` | Reviewing overview logic: loads `papers` collection, search/filter/render |
| `js/review/app.js` | Review detail logic: form, PocketBase persistence, edit locking, autocomplete, divider drag |
| `js/check/check-overview.js` | Checking overview logic: loads `check_papers` collection, search/filter/render |
| `js/check/check-app.js` | Check detail logic: form validation, PocketBase persistence, edit locking, divider drag |
| `js/datasets/datasets-overview.js` | Datasets overview logic: loads `datasets` collection, renders clickable table rows |
| `js/datasets/dataset-detail.js` | Dataset detail logic: load by `?id=`, POST/PATCH, edit locking, heartbeat |
| `js/metrics/metrics-overview.js` | Metrics overview logic: loads `metrics` collection, renders clickable table rows |
| `js/metrics/metric-detail.js` | Metric detail logic: load by `?id=`, POST/PATCH, edit locking, heartbeat |
| `js/stats/stats.js` | Review Stats dashboard logic: loads all `papers` (expanded), computes and renders all breakdowns client-side |
| `css/style.css` | Layout, form styles, tag chip styles, overview styles, landing page styles, breadcrumb styles |
| `screenshots/` | README screenshots only |
| `data.json` | Reference seed data; validated by CI (no longer read by the frontend) |
| `Dockerfile` | Container image: Python 3.12 Alpine running server.py on port 8765 |
| `requirements.txt` | Python deps for server.py — currently just `boto3`, for the R2 PDF fallback |
| `fly.toml` | Fly.io app config: app `repro-sign-survey-frontend`, region `fra` |
| `scripts/validate_data.py` | CI: validates data.json schema |
| `tests/smoke.spec.js` | Playwright smoke tests (landing, review overview + detail, check overview + detail, datasets/metrics overview + detail) |
| `playwright.config.js` | Playwright config; auto-starts server.py for tests |
| `package.json` | Dev dependencies (html-validate, @playwright/test); `version` is the single source of truth for the app version (issue #21) — served as a static file and fetched by `index.html` to render the version badge |
| `.github/workflows/ci.yml` | CI: syntax checks, JSON validation, HTML validation, Playwright |

## Key behaviours

- **Auth**: all pages redirect to `login.html` if no valid PocketBase token is found in `localStorage`. The token is stored with a 24-hour expiry timestamp (`pb_token_expiry`); `getToken()` in `api.js` returns `null` and clears the keys if the token is missing or expired. Using `localStorage` (not `sessionStorage`) means the token is shared across tabs, so copied paper links open without re-login. Two ways in: email/password (`auth-with-password`) and Slack OAuth2; both end by storing the same `pb_token`/`pb_user_id`/`pb_email`/`pb_token_expiry` keys.
- **Landing page** (`index.html`): five task cards — Reviewing and Checking (first row), Datasets and Metrics (second row), Review Stats (third row) — plus an account menu. Each card links to its own overview page. All cards are enabled.
- **Version badge** (issue #21): a small muted `v<version>` link in the bottom-right corner of the landing page, pointing at the matching GitHub release tag. Fetches `package.json` at runtime (served as a plain static file — no build step involved) and reads `.version`; fails silently if unavailable. `package.json`'s `version` field is the single source of truth — bump it with `npm version <patch|minor|major>` when cutting a release, which atomically bumps the field, commits, and creates the matching `vX.Y.Z` git tag, so the badge and the tag can't drift apart. Not currently duplicated onto other pages (each page has its own standalone account-menu markup/JS, so adding it elsewhere means repeating the same small fetch+badge snippet).
- **Breadcrumb navigation**: overview pages show `Home → Reviewing` / `Home → Checking` / `Home → Datasets` / `Home → Metrics` at title-font size; "Home" is a muted grey link, current page is bold black. Detail pages have a `← Back` link returning to the appropriate overview.
- **Reviewing overview** (`review-index.html`): lists all papers from the `papers` collection with ID, title, status badge, and a Review link. Shows counts per status. Search box filters by ID or title (live, substring), with a × clear button (`#search-clear-btn`) that appears once there's text to clear and resets the search on click; same on `check-index.html`. Status filter pills narrow to a specific status. "Review Next →" navigates to a random `needs_review` paper that isn't currently locked by another user (issue #71) — `allPapers` already carries `locked_by`/`locked_at` from the initial fetch, so this needs no extra request; disabled with "No unlocked papers left to review" once every remaining `needs_review` paper is locked.
- **Checking overview** (`check-index.html`): lists all papers from the `check_papers` collection. Status values: `needs_check`, `flagged`, `checked`. "Check Next →" navigates to a random `needs_check` paper that isn't currently locked by another user (issue #71), same as Review Next.
- **Two independent collections**: `papers` and `check_papers` are separate PocketBase collections with independent paper sets (a paper may appear in one, both, or neither). The frontend never mixes them.
- **PDF viewer**: native browser `<iframe>` routed through the local proxy (`/pdf/<id>.pdf?url=...`). Text selection, zoom, and all native controls work. No pdf.js. In Checking, the left panel shows the paper's `abstract` (plain text) instead when present — the screening-pipeline batch behind `check_papers` migration 9 ships abstracts but not always a usable `pdf_url`; papers without an `abstract` still fall back to the PDF iframe.
- **Paper navigation**: ◀ ▶ buttons step through papers. URL updates via `history.replaceState` (`?id=<paper-id>`), so every paper has a stable direct link. "Copy link" button in the header copies a plain `?id=<paper-id>` link to clipboard — deliberately built from `papers[currentIndex].id` rather than `window.location.href`, so it never carries the `?q=`/`?status=` nav-filter params described below; a shared/copied link should stay simple and always point at the full collection for whoever opens it.
- **Filtered navigation subset via URL params** (issue #75): `review-index.html`/`check-index.html` keep the active search text and status pill mirrored into their own URL (`?q=<search>&status=<status>`, via `history.replaceState`, params omitted at their default so an unfiltered view keeps a clean URL) — `buildFilterQuery()`/`syncURL()` in `overview.js`/`check-overview.js`. This makes the current view bookmarkable/shareable and is restored on load (`init()` reads `?q=`/`?status=` back into the search box and status pill), so returning via `paper.html`'s Back link lands on the same filtered view; the search box also has a × clear button (`#search-clear-btn`) that appears once there's text to clear. Clicking a row carries the same `q`/`status` params into `paper.html`'s URL; there, `?id=`/`?q=`/`?status=` are parsed on load and `computeNavOrder()` recomputes the matching subset of paper IDs from the already-loaded `papers` array (same predicate as the overview's `applyFilters()`) — a live recomputation, not a frozen ID list, so it also works for a link shared with someone else or opened in a new tab. ◀ ▶ (`loadAdjacentPaper()`), the `X / Y` counter, and the Back link's `href` (`updateBackLink()`) all stay within this subset; `id`/`q`/`status` are kept in sync in the URL via `history.replaceState` on every paper load (`buildPaperUrl()`). "Copy Link" is the one exception — it always strips `q`/`status` (see above). If the loaded paper isn't in the computed subset (a stale/non-matching `q`/`status`, or Finalize & Next landing outside it — that flow is intentionally left as full-collection, unfiltered, per its existing logic), navigation self-heals by dropping `q`/`status` and falling back to the full collection.
- **Reviewing status workflow** (issue #47): four statuses — `needs_review`, `final`, `flagged`, `rejected`.
  - **Autosave**: every field change (radio, chip add/remove, textarea, N/A toggle, or blurring a pencil-edit field) schedules a debounced save 1 second after the last change (`scheduleAutoSave()`/`runAutoSave()` in `app.js`). Autosave never changes `status` or `finalized_by` — it only persists the editable field values, whatever the current status. A `Saving…` / `Saved ✓` / `Save failed` indicator appears next to the action buttons — `Saved ✓` stays on screen (no auto-hide) once shown, so it doesn't quietly vanish while the reviewer is still working through the form; it's only replaced once another save starts (`Saving…`) or the paper changes (cleared via `hideFooterMessages()` in `loadPaper()`). `persistWithIndicator()` (shared by autosave and Finalize) enforces a 500 ms minimum display time for `Saving…` — against a fast/local backend the PATCH can resolve in a handful of milliseconds, which made the indicator flash too briefly to actually notice the state change once `Saved ✓` was already showing continuously.
  - **Network-failure handling**: `pbGet`/`pbPatch` (`js/api.js`) wrap every request in a 10-second timeout (`fetchWithTimeout()`, via `AbortController`) and catch the network-level failure `fetch()` throws when the backend is unreachable (e.g. stopped) — neither case is an HTTP error status, so `res.ok` alone can't detect them. Without this, an unreachable/hung backend during autosave left the indicator stuck on `Saving…` forever, since the uncaught rejection aborted `runAutoSave()` before it reached the code that would set `Save failed`. `pbPatch` now resolves `{ ok: false, status: 0 }` on either failure — the same shape callers already handle for an HTTP error — so the existing `Save failed — will retry on next change` state is reachable; `pbGet` throws the same kind of `Error` it already throws for an HTTP failure, rather than letting a different, uncaught `TypeError` escape.
  - Pending edits are flushed immediately (not just debounced) before switching papers (◀ ▶, Finalize & Next) and folded into the same keepalive PATCH that releases the edit lock on tab close/navigation (`beforeunload`), so an edit is never silently lost.
  - **Finalize / Finalize & Next** (replacing the old Save / Save & Next) → the only actions that set `status: final` and stamp `finalized_by` with the reviewer's email. Disabled (with a hover tooltip listing what's missing) unless every required field is filled: Title, Year, Peer-Reviewed, Code Repositories (chip or N/A), Datasets (≥1), Metrics (≥1), Area of SLP (≥1), Ranking, Copied Baseline Scores, Human Evaluation, What to Reproduce, Compute Requirements (text or N/A), Textual Conclusion, Ethical Concerns. Also disabled while the paper is `flagged` or `rejected` (tooltip explains to clear/revert first). Finalize & Next then advances to the next `needs_review` paper, skipping flagged/rejected/final.
  - Flag → opens a dialog to choose/enter a reason; stores `status: flagged` + `flag_reason`.
  - Reject → opens a dialog to choose/enter a reason (presets: "not on SLP", "no quantitative experiments", "not published 2017–2026", "not in English", "no full text PDF", "requires specialized hardware" (issue #67), or free text); stores `status: rejected` + `rejection_reason`.
  - Flag and Reject buttons disable each other (clear/revert first).
  - "Clear flag" / "Revert rejection" / "Revert to needs review" link appears next to the badge to reset status, explicitly clearing `flag_reason`/`rejection_reason` to `''` in the same request (issue #63).
  - Rejection/flag reason is folded into the badge text (`⚑ Flagged · <reason>`) and shown as a tooltip.
  - **Attribution**: `finalized_by` (`papers` migration 1, formerly a nonexistent `reviewed_by`) is set only by Finalize / Finalize & Next, to the logged-in reviewer's email; shown next to the status badge (`by <email>`) only once the paper is `final`. Flagging/rejecting does not stamp attribution — there's no `flagged_by`/`rejected_by` field in the backend.
  - **Status History** (issue #20): a "Status History" button next to "Copy link" opens a dialog listing every status transition, newest first — `<email> changed status from <Before> to <After>` plus a localized timestamp — sourced from `papers.status_history` (`papers` migration 1, a JSON array of `{by, before, after, when}`). Appended to inside `persistPaper()` whenever `extra.status` differs from the paper's current status, so it captures Finalize, Flag, Reject, and Clear/Revert, but never autosave (which never overrides `status`). Empty state: "No status changes recorded yet."
- **Review Stats dashboard** (`stats.html`, issue #54) — named to distinguish it from any future Checking-task stats: loads every record from the `papers` collection (expanded on `datasets`/`metrics`) and computes all breakdowns client-side — no backend aggregation endpoint. Sections: total paper count; status breakdown (needs_review/final/flagged/rejected) as colored bar rows; top finalizers (`finalized_by`, only counted for `final` papers, so it never conflates a flag/reject action with attribution); top datasets (each with an Available/Not available badge sourced from the dataset's own `available` field, via the existing `expand=datasets` on `papers` — `availabilityBadge()` always wraps the badge slot in a fixed-width `.stat-bar-badge-slot`, even when a dataset's availability is unanswered and has no badge to show, leaving the slot empty rather than omitting it; otherwise that row's bar track would start further left than rows that do have a badge. This keeps every row's track left-aligned regardless of badge text width or absence) and top metrics (bars link to the matching `dataset.html`/`metric.html` in a new tab, capped at the top 10 with a "+ N more" note; the label renders in the same accent blue as `.review-link` — at rest, not just on hover — so it reads as clickable, distinct from the plain-text labels in sections like Top Finalizers that don't link anywhere); a breakdown of `area_of_slp` usage (top 12); and a compact table of Yes/No/N-A/Unanswered counts for Peer-Reviewed, Ranking, Copied Baseline Scores, Human Evaluation, and Ethical Concerns. No charting library — bars are plain CSS width percentages, consistent with the "no framework" rule. Reachable from a fifth landing-page card.
- **Checking status workflow**: three statuses — `needs_check`, `flagged`, `checked`.
  - Save / Save & Next → marks as `checked` (only if currently `needs_check`; flagged status is preserved).
  - Save & Next → advances to the next `needs_check` paper; falls back to `check-index.html` if none remain.
  - Flag → opens a dialog to choose/enter a reason; stores `status: flagged` + `flag_reason`.
  - "Clear flag" / "Revert to needs check" link resets to `needs_check`, explicitly clearing `flag_reason` to `''` in the same request (issue #63).
  - **Form validation**: `is_sign_language_processing` must always be answered; `has_empirical_results` is only shown (and required) when `is_sign_language_processing` is `yes`. Both must be answered before Save / Save & Next become active.
  - **Attribution**: every save (`persistPaper()`) writes the logged-in reviewer's email to `checked_by` (`check_papers` migration 10), regardless of status.
- **Pre-filled fields** (title, year, venue in Reviewing; title, year, language in Checking): shown read-only, with a pencil button that makes the field editable; blur or Enter returns to display mode. In Checking, Title stays read-only — Year and Language are both editable this way.
- **Checking source metadata** (from `check_papers` migration 9): `language` shows next to Title/Year and is reviewer-editable like Year. `filters` (automated screening-pipeline eligibility checks, e.g. `area`/`approach`) pre-selects the SLP and empirical-results radios when the reviewer hasn't answered yet — an "LLM suggested" badge marks these until the reviewer confirms by clicking or saving. `filter_explanations` is in the schema but not currently surfaced in the UI.
- **Tag fields** (code repos, datasets, metrics — Reviewing only): chip list with × removal; inline input + Add button (also triggered by Enter). Datasets and metrics both have live autocomplete dropdowns backed by their respective PocketBase collections (`datasets`, `metrics`), with an "Add … as new … to the database" option for inline creation. Code repo chips are clickable links. Dataset and metric chips show a ↗ link that opens the corresponding detail page in a new tab.
- **N/A confirm toggles** (issue #44): Code Repositories and Compute Requirements each have a toggle button — "I confirm that there are no code repositories available." / "...compute requirements were not specified in the paper." Clicking it when the field is empty disables the input/add-button and marks the field as confirmed-N/A; clicking again reverts to the normal empty, editable state. The button itself is disabled whenever the field already has content, so you can't confirm N/A over existing chips/text. When toggled on, the saved value is the literal string `"N/A"` (for `code_repos`, replacing the usual array).
- **Area of SLP** (issue #22, redesigned in issue #43): chip list with × removal, same tag-input pattern as datasets/metrics — inline input + Add button (also triggered by Enter), with a live autocomplete dropdown suggesting from a fixed list of 12 SLP sub-areas (Translation, Recognition, Segmentation / tokenization, Alignment, Signing detection, Generation / production, Unsupervised / representation learning, Spotting / glossing, Transcription, Language identification, Retrieval, Avatar systems). Unlike datasets/metrics, this isn't backed by a PocketBase collection — the suggestion list (`KNOWN_SLP_AREAS`) is a hardcoded frontend constant, and any typed value (including ones not in that list) can be added as a chip. Persists to `papers.area_of_slp` as a plain array of strings.
- **Additional Reviewing fields** (issue #22): `main_experiment_has_ranking`, `copied_scores`, and `includes_human_evaluation` — yes/no radios, initially unanswered. `what_to_reproduce` and `compute_requirements` — free-text textareas with an info tooltip explaining what to enter; `textual_conclusion` — free-text textarea for the paper's main conclusion. These persist to the `papers` collection alongside the existing fields.
- **Ethical concerns field** (issue #36): "Potential Ethical Concerns" — `potential_ethical_concerns` — yes/no radios at the bottom of the Reviewing form, optional (can be left unanswered), with an info tooltip explaining what counts as an ethical concern (e.g. derogatory / ableist language).
- **Comments field** (`papers.comments`, `papers` migration 8): free-text textarea, the very last field in the Reviewing form (after Textual Conclusion), optional by default — with an info tooltip discouraging overuse: it's for genuine elaboration, not a way to defer/hedge a decision that should instead go through Flag. See also the Datasets tooltip below, which is the one case where a non-empty comment is actually required.
- **Peer-Reviewed field** (issue #37): three radios — Yes / No / N/A — instead of the original Yes/No pair. `peer_reviewed` is stored as the string `"yes"` / `"no"` / `"na"` (previously a bare bool); `populateForm` still recognizes legacy `true`/`false` values for backward compatibility with existing records.
- **Datasets catalogue** (`datasets-index.html`): table listing all records from the `datasets` collection (name, license, availability badge, first URL). Clicking a row navigates to `dataset.html?id=<pb-id>`. "+ Add Dataset" navigates to a blank `dataset.html`. The detail page (`dataset.html`) has fields for name, license, URLs (chip list), availability radio, and comments, with edit locking and a `← Back` link.
- **Metrics catalogue** (`metrics-index.html`): table listing all records from the `metrics` collection (name, first URL, comments). Clicking a row navigates to `metric.html?id=<pb-id>`. "+ Add Metric" navigates to a blank `metric.html`. The detail page (`metric.html`) has fields for name, URLs (chip list), and comments, with the same edit locking pattern.
- **Unsaved-changes guard** (`dataset.html`/`metric.html`): these pages have no autosave — a Save button persists edits explicitly — so an `isDirty` flag is set by any field mutation (name/license/comments input, availability radio, URL chip add/remove) and cleared on load and after a successful save. `beforeunload` shows the browser's native "leave site?" prompt (`e.preventDefault(); e.returnValue = ''`) whenever `isDirty` is true, covering both actual tab close/reload and in-app navigation (e.g. the Back link), since these pages do a full page load rather than SPA-style routing. Applies equally to a brand-new, not-yet-saved record (`record === null`). While dirty, the lock release + heartbeat-stop that normally runs in `beforeunload` is skipped — releasing the lock immediately would be wrong if the user cancels the prompt and keeps editing — so a lock left behind by a user who dismisses the prompt and leaves anyway just expires via the existing 30-minute inactivity rule instead of being released early.
- **Used in Papers** (dataset/metric detail pages only, not for a new/unsaved record): a scrollable, always-fully-shown list of every paper referencing this dataset/metric — title (links to `paper.html?id=<paper-id>` in a new tab) plus a status badge, same class/text mapping as the Reviewing overview table. Computed entirely client-side (`pbGetAll('papers')` filtered by `p.datasets`/`p.metrics` array membership), matching the Review Stats page's approach — no backend relation-filter query involved, so no risk from PocketBase's `~` operator not being an exact array-membership match (confirmed empirically it under-counts for this use case). Loads in the background after the form/lock, doesn't block page interactivity.
- **Persistence**: Save sends a PATCH to the appropriate collection endpoint on PocketBase. Two IDs per record: `paper_id` (kebab slug used in URLs and display) mapped to `p.id`; opaque PocketBase `id` stored as `p._pb_id` and used only for API calls.
- **Pagination**: `pbGetAll(collection)` in `api.js` pages through PocketBase results until all records are loaded, avoiding the 500-record ceiling. Both overview and detail scripts use this helper.
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

Playwright tests cover (48 tests total):
- **Landing**: task cards render (5 cards), all task links present
- **Review overview**: renders list/controls, search filters live, empty state, row click → `paper.html`, search clear button appears while typing and resets the search on click
- **Review detail**: core UI elements, autosave persists a field change without finalizing (and the `Saved ✓` indicator stays visible rather than auto-hiding), the Comments field is optional and autosaves, a second autosave visibly cycles back through `Saving…` rather than staying stuck on `Saved ✓`, a network failure during autosave shows "Save failed" instead of hanging on "Saving…" forever, Finalize disabled until required fields are filled then marks paper as Final (skipped if no datasets/metrics in backend; restores mutated fields afterward), Status History logs flag/clear transitions newest-first, clearing a flag/rejection also clears its reason (#63), ◀ ▶ navigation updates URL, back link → `review-index.html`, Copy Link strips the active nav filter, filtered-row click carries `q`/`status` into the URL and constrains ◀ ▶ to that subset / unfiltered click and direct navigation use the full collection / Back restores the same filter / a non-matching `q` self-heals to the full collection (#75)
- **Check overview**: renders list/controls, row click → `paper-check.html`, search clear button appears while typing and resets the search on click
- **Check detail**: core UI elements including both radio groups, back link → `check-index.html`, clearing a flag also clears its reason (#63), Copy Link strips the active nav filter, filtered-row click carries `q`/`status` into the URL and constrains ◀ ▶ to that subset / unfiltered click and direct navigation use the full collection / Back restores the same filter (#75)
- **Datasets overview**: renders table and controls (+ Add link), row click → `dataset.html` (skipped if no records)
- **Dataset detail**: new dataset page loads form fields and back link, existing dataset shows the Used in Papers section, editing a field triggers the unsaved-changes guard on `beforeunload` and saving clears it, a new (unsaved) dataset also triggers the guard
- **Metrics overview**: renders table and controls (+ Add link), row click → `metric.html` (skipped if no records)
- **Metric detail**: new metric page loads form fields and back link, existing metric shows the Used in Papers section, editing a field triggers the unsaved-changes guard on `beforeunload` and saving clears it
- **Review Stats page**: renders all breakdown sections (summary, status breakdown, answered-fields table), the availability badge doesn't misalign the bar tracks in Top Datasets, clickable Top Datasets/Metrics labels are visually distinct (accent blue at rest) from non-clickable ones and open in a new tab, reachable from the landing page

## Adding papers

Papers are managed in the PocketBase backend (see backend repo). The frontend reads all records from `/api/collections/papers/records` (Reviewing) and `/api/collections/check_papers/records` (Checking). The `data.json` in this repo is reference seed data used only by CI schema validation — it is not read by the frontend.
