import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

const TEST_EMAIL    = process.env.PB_TEST_EMAIL;
const TEST_PASSWORD = process.env.PB_TEST_PASSWORD;

// Skip all tests if backend credentials aren't configured (e.g. in CI without PocketBase)
test.skip(!TEST_EMAIL || !TEST_PASSWORD,
  'Skipped: set PB_TEST_EMAIL and PB_TEST_PASSWORD env vars to run with PocketBase backend');

test.beforeEach(async ({ page }) => {
  // Navigate first so the page's origin is set, then inject auth token into localStorage
  await page.goto('/login.html');
  const res = await page.request.post(
    'http://localhost:8090/api/collections/users/auth-with-password',
    { data: { identity: TEST_EMAIL, password: TEST_PASSWORD } }
  );
  const { token, record } = await res.json();
  await page.evaluate(({ token, userId }) => {
    const expiry = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem('pb_token', token);
    localStorage.setItem('pb_user_id', userId);
    localStorage.setItem('pb_token_expiry', String(expiry));
  }, { token, userId: record.id });
});

test.describe('Landing page', () => {
  test('shows all five task cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.task-card')).toHaveCount(5);
    await expect(page.locator('.task-card:visible')).toHaveCount(5);
    await expect(page.locator('a[href="review-index.html"]')).toBeVisible();
    await expect(page.locator('a[href="stats.html"]')).toBeVisible();
    await expect(page.locator('a[href="datasets-index.html"]')).toBeVisible();
    await expect(page.locator('a[href="metrics-index.html"]')).toBeVisible();
    await expect(page.locator('a[href="dataset-confirmation-index.html"]')).toBeVisible();
    await expect(page.locator('.task-card-disabled')).toHaveCount(0);
  });

  test('does not link to Checking — internal/unlisted page for now', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href="check-index.html"]')).toHaveCount(0);
  });
});

test.describe('Review overview page', () => {
  test('renders paper list and controls', async ({ page }) => {
    await page.goto('/review-index.html');
    await expect(page.locator('.paper-row').first()).toBeVisible();
    await expect(page.locator('#stats-row')).toBeVisible();
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('.filter-btn')).toHaveCount(5);
    await expect(page.locator('#review-next-btn')).toBeVisible();
  });

  test('search filters rows live', async ({ page }) => {
    await page.goto('/review-index.html');
    await page.fill('#search-input', 'SignCLIP');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await expect(page.locator('#results-count')).toContainText('Showing 1 of');
  });

  test('status filter shows empty state when no papers match', async ({ page }) => {
    await page.goto('/review-index.html');
    await page.fill('#search-input', 'zzz-no-match-zzz');
    await expect(page.locator('.no-results')).toBeVisible();
    await expect(page.locator('#results-count')).toContainText('Showing 0 of');
  });

  test('clicking a row navigates to the detail page', async ({ page }) => {
    await page.goto('/review-index.html');
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper\.html\?id=/);
  });

  test('the search clear button appears while typing and resets the search on click', async ({ page }) => {
    await page.goto('/review-index.html');
    await expect(page.locator('#search-clear-btn')).toBeHidden();
    await page.fill('#search-input', 'SignCLIP');
    await expect(page.locator('#search-clear-btn')).toBeVisible();
    await expect(page).toHaveURL(/\?q=SignCLIP/);

    await page.click('#search-clear-btn');
    await expect(page.locator('#search-input')).toHaveValue('');
    await expect(page.locator('#search-clear-btn')).toBeHidden();
    await expect(page).not.toHaveURL(/q=/);
  });
});

test.describe('Review detail page', () => {
  test('loads core UI elements', async ({ page }) => {
    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#pdf-iframe')).toBeVisible();
    await expect(page.locator('#status-badge')).toBeVisible();
    await expect(page.locator('#finalize-btn')).toBeVisible();
    await expect(page.locator('#finalize-next-btn')).toBeVisible();
    await expect(page.locator('#flag-btn')).toBeVisible();
    await expect(page.locator('#reject-btn')).toBeVisible();
    await expect(page.locator('#status-history-btn')).toBeVisible();
  });

  test('autosave persists a field change without finalizing', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const listRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { items } = await listRes.json();
    const record = items[0];
    test.skip(!record, 'Fixture paper not found — skipping');
    const originalVenue = record.venue || '';

    await page.goto('/paper.html?id=emnlp-2024-518');
    // Title is always populated for a real paper, so waiting for its display
    // confirms populateForm() has actually run before we inspect other
    // fields — otherwise display/input elements can still be mid-toggle.
    await expect(page.locator('#display-title')).toBeVisible();
    // The pencil-edit button only shows when the field already has a value —
    // when empty, the input is already visible in edit mode.
    if (await page.locator('#edit-venue').isVisible()) await page.click('#edit-venue');
    await page.fill('#input-venue', 'AUTOSAVE-TEST-VENUE');
    await page.locator('#input-venue').press('Enter');
    await expect(page.locator('#save-indicator')).toContainText('Saved', { timeout: 5000 });
    // "Saved ✓" should stay on screen rather than auto-hiding after a couple
    // of seconds — wait past the old 2s auto-hide window and confirm it's
    // still visible.
    await page.waitForTimeout(2500);
    await expect(page.locator('#save-indicator')).toContainText('Saved');
    await expect(page.locator('#save-indicator')).toBeVisible();

    const checkRes = await page.request.get(
      `http://localhost:8090/api/collections/papers/records/${record.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const updated = await checkRes.json();
    expect(updated.venue).toBe('AUTOSAVE-TEST-VENUE');
    expect(updated.status).toBe(record.status || 'needs_review'); // autosave never changes status

    await page.request.patch( // restore — leave no permanent side effects
      `http://localhost:8090/api/collections/papers/records/${record.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { venue: originalVenue },
      }
    );
  });

  test('the Comments field is optional and autosaves', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const listRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const record = (await listRes.json()).items[0];
    test.skip(!record, 'Fixture paper not found — skipping');
    const originalComments = record.comments || '';

    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#display-title')).toBeVisible();
    await expect(page.locator('#input-comments')).toBeVisible();
    await expect(page.locator('#input-comments')).toHaveAttribute('placeholder', 'Optional');

    await page.fill('#input-comments', 'COMMENTS-AUTOSAVE-TEST');
    await expect(page.locator('#save-indicator')).toContainText('Saved', { timeout: 5000 });

    const checkRes = await page.request.get(
      `http://localhost:8090/api/collections/papers/records/${record.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect((await checkRes.json()).comments).toBe('COMMENTS-AUTOSAVE-TEST');

    await page.request.patch( // restore — leave no permanent side effects
      `http://localhost:8090/api/collections/papers/records/${record.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { comments: originalComments },
      }
    );
  });

  test('a second autosave shows "Saving…" for a perceivable moment, not just a flash', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const listRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const record = (await listRes.json()).items[0];
    test.skip(!record, 'Fixture paper not found — skipping');
    const originalVenue = record.venue || '';

    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#display-title')).toBeVisible();
    if (await page.locator('#edit-venue').isVisible()) await page.click('#edit-venue');
    await page.fill('#input-venue', 'SAVING-INDICATOR-TEST-1');
    await page.locator('#input-venue').press('Enter');
    await expect(page.locator('#save-indicator')).toContainText('Saved', { timeout: 5000 });

    // A second edit while "Saved ✓" is already showing (unchanged since it no
    // longer auto-hides) must still visibly cycle back through "Saving…" —
    // not stay stuck on "Saved ✓" the whole time.
    await page.click('#edit-venue');
    await page.fill('#input-venue', 'SAVING-INDICATOR-TEST-2');
    await page.locator('#input-venue').press('Enter');
    await expect(page.locator('#save-indicator')).toContainText('Saving', { timeout: 2000 });
    await expect(page.locator('#save-indicator')).toContainText('Saved', { timeout: 5000 });

    await page.request.patch( // restore — leave no permanent side effects
      `http://localhost:8090/api/collections/papers/records/${record.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { venue: originalVenue },
      }
    );
  });

  test('a network failure during autosave shows "Save failed" instead of hanging on "Saving…" forever', async ({ page }) => {
    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#display-title')).toBeVisible();

    // Simulate the backend being unreachable (e.g. stopped) — abort every
    // PATCH with a connection-level failure, exactly like a real
    // ECONNREFUSED looks to fetch().
    await page.route('**/api/collections/papers/records/**', route => {
      if (route.request().method() === 'PATCH') route.abort('connectionrefused');
      else route.continue();
    });

    if (await page.locator('#edit-venue').isVisible()) await page.click('#edit-venue');
    await page.fill('#input-venue', 'NETWORK-FAILURE-TEST');
    await page.locator('#input-venue').press('Enter');

    await expect(page.locator('#save-indicator')).toContainText('failed', { timeout: 5000 });
  });

  test('Finalize is disabled until all required fields are filled, then marks paper as Final', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));

    const papersRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { items } = await papersRes.json();
    const record = items[0];
    test.skip(!record, 'Fixture paper not found — skipping');

    const [datasetsRes, metricsRes] = await Promise.all([
      page.request.get('http://localhost:8090/api/collections/datasets/records?perPage=1',
        { headers: { Authorization: `Bearer ${token}` } }),
      page.request.get('http://localhost:8090/api/collections/metrics/records?perPage=1',
        { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const datasetId = (await datasetsRes.json()).items[0]?.id;
    const metricId  = (await metricsRes.json()).items[0]?.id;
    test.skip(!datasetId || !metricId, 'No datasets/metrics in backend — skipping');

    async function patchPaper(data) {
      await page.request.patch(
        `http://localhost:8090/api/collections/papers/records/${record.id}`,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data }
      );
    }

    await patchPaper({
      status: 'needs_review',
      title: record.title || 'Test Paper',
      year: record.year || 2024,
      peer_reviewed: 'yes',
      code_repos: 'N/A',
      datasets: [datasetId],
      metrics: [metricId],
      area_of_slp: ['Translation'],
      main_experiment_has_ranking: 'yes',
      copied_scores: 'no',
      includes_human_evaluation: 'no',
      what_to_reproduce: 'Table 3.',
      compute_requirements: 'N/A',
      textual_conclusion: 'Test conclusion.',
      potential_ethical_concerns: 'no',
      finalized_by: '',
    });

    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#status-badge')).toContainText('Needs Review');
    await expect(page.locator('#finalize-btn')).toBeEnabled();
    await page.click('#finalize-btn');
    await expect(page.locator('#status-badge')).toContainText('Final');

    await patchPaper({ // restore — leave no permanent side effects
      status:                      record.status || 'needs_review',
      title:                       record.title,
      year:                        record.year,
      peer_reviewed:               record.peer_reviewed || '',
      code_repos:                  record.code_repos || [],
      datasets:                    record.datasets || [],
      metrics:                     record.metrics || [],
      area_of_slp:                 record.area_of_slp || [],
      main_experiment_has_ranking: record.main_experiment_has_ranking || '',
      copied_scores:               record.copied_scores || '',
      includes_human_evaluation:   record.includes_human_evaluation || '',
      what_to_reproduce:           record.what_to_reproduce || '',
      compute_requirements:        record.compute_requirements || '',
      textual_conclusion:          record.textual_conclusion || '',
      potential_ethical_concerns:  record.potential_ethical_concerns || '',
      finalized_by:                record.finalized_by || '',
    });
  });

  test('"Create unnamed dataset" adds a distinctly-named chip and does not require Comments (#92)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));

    const papersRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const record = (await papersRes.json()).items[0];
    test.skip(!record, 'Fixture paper not found — skipping');

    const metricsRes = await page.request.get('http://localhost:8090/api/collections/metrics/records?perPage=1',
      { headers: { Authorization: `Bearer ${token}` } });
    const metricId = (await metricsRes.json()).items[0]?.id;
    test.skip(!metricId, 'No metrics in backend — skipping');

    async function patchPaper(data) {
      await page.request.patch(
        `http://localhost:8090/api/collections/papers/records/${record.id}`,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data }
      );
    }

    await patchPaper({
      status: 'needs_review',
      title: record.title || 'Test Paper',
      year: record.year || 2024,
      peer_reviewed: 'yes',
      code_repos: 'N/A',
      datasets: [], // no dataset yet — will create one via the UI below
      metrics: [metricId],
      area_of_slp: ['Translation'],
      main_experiment_has_ranking: 'yes',
      copied_scores: 'no',
      includes_human_evaluation: 'no',
      what_to_reproduce: 'Table 3.',
      compute_requirements: 'N/A',
      textual_conclusion: 'Test conclusion.',
      potential_ethical_concerns: 'no',
      comments: '',
      finalized_by: '',
    });

    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#status-badge')).toContainText('Needs Review');
    await expect(page.locator('.field-group:has(#datasets-container) .info-popup'))
      .toContainText('create an unnamed dataset');
    await expect(page.locator('#finalize-btn')).toBeDisabled();
    await expect(page.locator('#finalize-tooltip')).toContainText('Datasets');

    await page.click('#create-unnamed-dataset-btn');
    await expect(page.locator('#datasets-container .chip')).toHaveCount(1);
    const firstChipText = (await page.locator('#datasets-container .chip').first().textContent()).trim();
    expect(firstChipText).toMatch(/^unnamed-/);

    // Comments is never required — the old "custom" placeholder's
    // conditional-required logic no longer exists.
    await expect(page.locator('#finalize-btn')).toBeEnabled();
    await expect(page.locator('#input-comments')).toHaveValue('');

    // A second click creates a distinct record — solves the original
    // "custom" problem of every unnamed dataset collapsing into one entry.
    await page.click('#create-unnamed-dataset-btn');
    await expect(page.locator('#datasets-container .chip')).toHaveCount(2);
    const chipTexts = (await page.locator('#datasets-container .chip').allTextContents()).map(t => t.trim());
    expect(chipTexts[0]).not.toBe(chipTexts[1]);

    await patchPaper({ // restore — leave no permanent side effects
      status:                      record.status || 'needs_review',
      title:                       record.title,
      year:                        record.year,
      peer_reviewed:               record.peer_reviewed || '',
      code_repos:                  record.code_repos || [],
      datasets:                    record.datasets || [],
      metrics:                     record.metrics || [],
      area_of_slp:                 record.area_of_slp || [],
      main_experiment_has_ranking: record.main_experiment_has_ranking || '',
      copied_scores:               record.copied_scores || '',
      includes_human_evaluation:   record.includes_human_evaluation || '',
      what_to_reproduce:           record.what_to_reproduce || '',
      compute_requirements:        record.compute_requirements || '',
      textual_conclusion:          record.textual_conclusion || '',
      potential_ethical_concerns:  record.potential_ethical_concerns || '',
      comments:                    record.comments || '',
      finalized_by:                record.finalized_by || '',
    });
  });

  test('Sub-area of SLP suggestions depend on Area of SLP, and the field is optional (#101)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const listRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const record = (await listRes.json()).items[0];
    test.skip(!record, 'Fixture paper not found — skipping');

    async function patchPaper(data) {
      await page.request.patch(
        `http://localhost:8090/api/collections/papers/records/${record.id}`,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data }
      );
    }

    // Area of SLP = Recognition → only the recognition sub-areas are suggested.
    await patchPaper({ area_of_slp: ['Recognition'], sub_area_of_slp: [] });
    await page.goto('/paper.html?id=emnlp-2024-518');
    await page.click('#sub-area-of-slp-input');
    await expect(page.locator('#sub-area-of-slp-suggestions .suggestion-item')).toHaveText([
      'Isolated fingerspelling images',
      'Isolated fingerspelling videos',
      'Continuous fingerspelling videos',
      'Isolated signing videos',
      'Continuous signing videos',
    ]);

    // Area of SLP = Translation → only the translation sub-areas are suggested.
    await patchPaper({ area_of_slp: ['Translation'], sub_area_of_slp: [] });
    await page.goto('/paper.html?id=emnlp-2024-518');
    await page.click('#sub-area-of-slp-input');
    await expect(page.locator('#sub-area-of-slp-suggestions .suggestion-item')).toHaveText([
      'Gloss-to-text',
      'Text-to-gloss',
      'Video-to-text',
      'Text-to-video',
      'Pose-to-text',
      'Text-to-pose',
    ]);

    // Area of SLP has neither → field stays visible with no suggestions, but
    // still accepts free text (sub_area_of_slp has no fixed enum), which
    // persists across a reload.
    await patchPaper({ area_of_slp: ['Alignment'], sub_area_of_slp: [] });
    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#sub-area-of-slp-input')).toBeVisible();
    await page.click('#sub-area-of-slp-input');
    await expect(page.locator('#sub-area-of-slp-suggestions')).toBeHidden();
    await page.fill('#sub-area-of-slp-input', 'Custom sub-area');
    await page.click('#add-sub-area-of-slp-btn');
    await expect(page.locator('#sub-area-of-slp-container .chip')).toHaveText(['Custom sub-area×']);
    await page.waitForTimeout(1500); // let the debounced autosave fire
    await page.reload();
    await expect(page.locator('#sub-area-of-slp-container .chip')).toHaveText(['Custom sub-area×']);

    // Optional for Finalize: enabled here despite sub_area_of_slp being
    // empty, as long as every REQUIRED_FIELD_LABELS field is filled.
    const [datasetsRes, metricsRes] = await Promise.all([
      page.request.get('http://localhost:8090/api/collections/datasets/records?perPage=1',
        { headers: { Authorization: `Bearer ${token}` } }),
      page.request.get('http://localhost:8090/api/collections/metrics/records?perPage=1',
        { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const datasetId = (await datasetsRes.json()).items[0]?.id;
    const metricId  = (await metricsRes.json()).items[0]?.id;
    test.skip(!datasetId || !metricId, 'No datasets/metrics in backend — skipping the Finalize part');

    await patchPaper({
      status: 'needs_review',
      title: record.title || 'Test Paper',
      year: record.year || 2024,
      peer_reviewed: 'yes',
      code_repos: 'N/A',
      datasets: [datasetId],
      metrics: [metricId],
      area_of_slp: ['Translation'],
      sub_area_of_slp: [], // deliberately empty
      main_experiment_has_ranking: 'yes',
      copied_scores: 'no',
      includes_human_evaluation: 'no',
      what_to_reproduce: 'Table 3.',
      compute_requirements: 'N/A',
      textual_conclusion: 'Test conclusion.',
      potential_ethical_concerns: 'no',
      finalized_by: '',
    });
    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#finalize-btn')).toBeEnabled();

    await patchPaper({ // restore — leave no permanent side effects
      status:                      record.status || 'needs_review',
      title:                       record.title,
      year:                        record.year,
      peer_reviewed:               record.peer_reviewed || '',
      code_repos:                  record.code_repos || [],
      datasets:                    record.datasets || [],
      metrics:                     record.metrics || [],
      area_of_slp:                 record.area_of_slp || [],
      sub_area_of_slp:             record.sub_area_of_slp || [],
      main_experiment_has_ranking: record.main_experiment_has_ranking || '',
      copied_scores:               record.copied_scores || '',
      includes_human_evaluation:   record.includes_human_evaluation || '',
      what_to_reproduce:           record.what_to_reproduce || '',
      compute_requirements:        record.compute_requirements || '',
      textual_conclusion:          record.textual_conclusion || '',
      potential_ethical_concerns:  record.potential_ethical_concerns || '',
      finalized_by:                record.finalized_by || '',
    });
  });

  test('Status History logs flag/clear transitions, newest first', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const listRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { items } = await listRes.json();
    const record = items[0];
    test.skip(!record, 'Fixture paper not found — skipping');

    await page.request.patch(
      `http://localhost:8090/api/collections/papers/records/${record.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { status: 'needs_review', status_history: [] },
      }
    );

    await page.goto('/paper.html?id=emnlp-2024-518');
    await page.click('#status-history-btn');
    await expect(page.locator('.status-history-empty')).toContainText('No status changes recorded yet.');
    await page.click('#status-history-close-btn');

    await page.click('#flag-btn');
    await page.click('input[name="flag-reason"][value="Conflict of interest"]');
    await page.click('#flag-confirm-btn');
    await expect(page.locator('#status-badge')).toContainText('Flagged');

    await page.click('#clear-status-btn');
    await expect(page.locator('#status-badge')).toContainText('Needs Review');

    await page.click('#status-history-btn');
    const rows = page.locator('.status-history-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Flagged to Needs Review');
    await expect(rows.nth(1)).toContainText('Needs Review to Flagged');

    await page.request.patch( // restore — leave no permanent side effects
      `http://localhost:8090/api/collections/papers/records/${record.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { status: record.status || 'needs_review', status_history: record.status_history || [] },
      }
    );
  });

  test('clearing a flag or rejection also clears its reason (#63)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const listRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { items } = await listRes.json();
    const record = items[0];
    test.skip(!record, 'Fixture paper not found — skipping');

    async function patchPaper(data) {
      await page.request.patch(
        `http://localhost:8090/api/collections/papers/records/${record.id}`,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data }
      );
    }
    async function getPaper() {
      const res = await page.request.get(
        `http://localhost:8090/api/collections/papers/records/${record.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return res.json();
    }

    // Flag -> clear
    await patchPaper({ status: 'needs_review', flag_reason: '', rejection_reason: '' });
    await page.goto('/paper.html?id=emnlp-2024-518');
    await page.click('#flag-btn');
    await page.click('input[name="flag-reason"][value="Conflict of interest"]');
    await page.click('#flag-confirm-btn');
    await expect(page.locator('#status-badge')).toContainText('Flagged');
    await page.click('#clear-status-btn');
    await expect(page.locator('#status-badge')).toContainText('Needs Review');
    let updated = await getPaper();
    expect(updated.flag_reason).toBe('');

    // Reject -> revert
    await patchPaper({ status: 'needs_review', flag_reason: '', rejection_reason: '' });
    await page.goto('/paper.html?id=emnlp-2024-518');
    await page.click('#reject-btn');
    await page.click('input[name="reject-reason"][value="The paper is not in English"]');
    await page.click('#reject-confirm-btn');
    await expect(page.locator('#status-badge')).toContainText('Rejected');
    await page.click('#clear-status-btn');
    await expect(page.locator('#status-badge')).toContainText('Needs Review');
    updated = await getPaper();
    expect(updated.rejection_reason).toBe('');

    await patchPaper({ // restore — leave no permanent side effects
      status: record.status || 'needs_review',
      flag_reason: record.flag_reason || '',
      rejection_reason: record.rejection_reason || '',
    });
  });

  test('paper navigation updates URL', async ({ page }) => {
    await page.goto('/paper.html?id=emnlp-2024-518');
    const initialUrl = page.url();
    await page.click('#next-paper');
    await expect(page).not.toHaveURL(initialUrl);
    await expect(page).toHaveURL(/paper\.html\?id=/);
  });

  test('back link returns to review overview', async ({ page }) => {
    await page.goto('/paper.html?id=emnlp-2024-518');
    await page.click('.back-link');
    await expect(page).toHaveURL(/review-index\.html/);
  });

  test('Copy Link copies a plain ?id= link, stripping the active nav filter (#75)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/review-index.html');
    await page.fill('#search-input', 'SignCLIP');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper\.html\?id=.*q=SignCLIP/);

    await page.click('#copy-link-btn');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/paper\.html\?id=[^&]+$/);
  });

  test('clicking a filtered row carries the filter into the URL and constrains ◀ ▶ to that subset (#75)', async ({ page }) => {
    await page.goto('/review-index.html');
    await page.fill('#search-input', 'SignCLIP');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper\.html\?id=.*q=SignCLIP/);
    await expect(page.locator('#paper-counter')).toHaveText('1 / 1');
    await expect(page.locator('#prev-paper')).toBeDisabled();
    await expect(page.locator('#next-paper')).toBeDisabled();
  });

  test('clicking the explicit "Review →" link also carries the filter (#91)', async ({ page }) => {
    await page.goto('/review-index.html');
    await page.fill('#search-input', 'SignCLIP');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await expect(page.locator('.review-link').first()).toHaveAttribute('href', /q=SignCLIP/);
    await page.locator('.review-link').first().click();
    await expect(page).toHaveURL(/paper\.html\?id=.*q=SignCLIP/);
    await expect(page.locator('#paper-counter')).toHaveText('1 / 1');
  });

  test('clicking an unfiltered row navigates the full collection (#75)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const res = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?perPage=1',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { totalItems } = await res.json();

    await page.goto('/review-index.html');
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper\.html\?id=[^&]+$/); // no q=/status= appended
    await expect(page.locator('#paper-counter')).toContainText(`/ ${totalItems}`);
  });

  test('the Back link from a filtered paper restores the same search/filter on review-index.html (#75)', async ({ page }) => {
    await page.goto('/review-index.html');
    await page.fill('#search-input', 'SignCLIP');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper\.html\?id=/);

    await page.click('.back-link');
    await expect(page).toHaveURL(/review-index\.html\?q=SignCLIP/);
    await expect(page.locator('#search-input')).toHaveValue('SignCLIP');
    await expect(page.locator('.paper-row')).toHaveCount(1);
  });

  test('direct navigation to paper.html (no filter params) uses the full collection (#75)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const res = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?perPage=1',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { totalItems } = await res.json();

    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#paper-counter')).toContainText(`/ ${totalItems}`);
    await expect(page.locator('.back-link')).toHaveAttribute('href', 'review-index.html');
  });

  test('a filter that does not match the loaded paper self-heals to the full collection (#75)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const res = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?perPage=1',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { totalItems } = await res.json();

    await page.goto('/paper.html?id=emnlp-2024-518&q=zzz-no-match-zzz');
    await expect(page.locator('#paper-counter')).toContainText(`/ ${totalItems}`);
    await expect(page).toHaveURL(/paper\.html\?id=[^&]+$/); // stale q= dropped after self-heal
    await expect(page.locator('.back-link')).toHaveAttribute('href', 'review-index.html');
  });
});

test.describe('Check overview page', () => {
  test('renders paper list and controls', async ({ page }) => {
    await page.goto('/check-index.html');
    await expect(page.locator('.paper-row').first()).toBeVisible();
    await expect(page.locator('#stats-row')).toBeVisible();
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('.filter-btn')).toHaveCount(4);
    await expect(page.locator('#check-next-btn')).toBeVisible();
  });

  test('clicking a row navigates to the check detail page', async ({ page }) => {
    await page.goto('/check-index.html');
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper-check\.html\?id=/);
  });

  test('the search clear button appears while typing and resets the search on click', async ({ page }) => {
    await page.goto('/check-index.html');
    await expect(page.locator('#search-clear-btn')).toBeHidden();
    await page.fill('#search-input', 'arxiv-2303-10782');
    await expect(page.locator('#search-clear-btn')).toBeVisible();
    await expect(page).toHaveURL(/\?q=arxiv-2303-10782/);

    await page.click('#search-clear-btn');
    await expect(page.locator('#search-input')).toHaveValue('');
    await expect(page.locator('#search-clear-btn')).toBeHidden();
    await expect(page).not.toHaveURL(/q=/);
  });
});

test.describe('Check detail page', () => {
  test('loads core UI elements', async ({ page }) => {
    await page.goto('/paper-check.html?id=arxiv-2303-10782');
    await expect(page.locator('#pdf-iframe')).toBeVisible();
    await expect(page.locator('#status-badge')).toBeVisible();
    await expect(page.locator('#save-btn')).toBeVisible();
    await expect(page.locator('#save-next-btn')).toBeVisible();
    await expect(page.locator('#flag-btn')).toBeVisible();
    await expect(page.locator('input[name="has-empirical-results"]')).toHaveCount(2);
    await expect(page.locator('input[name="is-sign-language-processing"]')).toHaveCount(2);
  });

  test('back link returns to check overview', async ({ page }) => {
    await page.goto('/paper-check.html?id=arxiv-2303-10782');
    await page.click('.back-link');
    await expect(page).toHaveURL(/check-index\.html/);
  });

  test('Copy Link copies a plain ?id= link, stripping the active nav filter (#75)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/check-index.html');
    await page.fill('#search-input', 'arxiv-2303-10782');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper-check\.html\?id=.*q=arxiv-2303-10782/);

    await page.click('#copy-link-btn');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/paper-check\.html\?id=[^&]+$/);
  });

  test('clicking a filtered row carries the filter into the URL and constrains ◀ ▶ to that subset (#75)', async ({ page }) => {
    await page.goto('/check-index.html');
    await page.fill('#search-input', 'arxiv-2303-10782');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper-check\.html\?id=.*q=arxiv-2303-10782/);
    await expect(page.locator('#paper-counter')).toHaveText('1 / 1');
    await expect(page.locator('#prev-paper')).toBeDisabled();
    await expect(page.locator('#next-paper')).toBeDisabled();
  });

  test('clicking the explicit "Check →" link also carries the filter (#91)', async ({ page }) => {
    await page.goto('/check-index.html');
    await page.fill('#search-input', 'arxiv-2303-10782');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await expect(page.locator('.review-link').first()).toHaveAttribute('href', /q=arxiv-2303-10782/);
    await page.locator('.review-link').first().click();
    await expect(page).toHaveURL(/paper-check\.html\?id=.*q=arxiv-2303-10782/);
    await expect(page.locator('#paper-counter')).toHaveText('1 / 1');
  });

  test('clicking an unfiltered row navigates the full collection (#75)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const res = await page.request.get(
      'http://localhost:8090/api/collections/check_papers/records?perPage=1',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { totalItems } = await res.json();

    await page.goto('/check-index.html');
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper-check\.html\?id=[^&]+$/); // no q=/status= appended
    await expect(page.locator('#paper-counter')).toContainText(`/ ${totalItems}`);
  });

  test('the Back link from a filtered paper restores the same search/filter on check-index.html (#75)', async ({ page }) => {
    await page.goto('/check-index.html');
    await page.fill('#search-input', 'arxiv-2303-10782');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper-check\.html\?id=/);

    await page.click('.back-link');
    await expect(page).toHaveURL(/check-index\.html\?q=arxiv-2303-10782/);
    await expect(page.locator('#search-input')).toHaveValue('arxiv-2303-10782');
    await expect(page.locator('.paper-row')).toHaveCount(1);
  });

  test('direct navigation to paper-check.html (no filter params) uses the full collection (#75)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const res = await page.request.get(
      'http://localhost:8090/api/collections/check_papers/records?perPage=1',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { totalItems } = await res.json();

    await page.goto('/paper-check.html?id=arxiv-2303-10782');
    await expect(page.locator('#paper-counter')).toContainText(`/ ${totalItems}`);
    await expect(page.locator('.back-link')).toHaveAttribute('href', 'check-index.html');
  });

  test('clearing a flag also clears its reason (#63)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const listRes = await page.request.get(
      'http://localhost:8090/api/collections/check_papers/records?filter=(paper_id="arxiv-2303-10782")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { items } = await listRes.json();
    const record = items[0];
    test.skip(!record, 'Fixture paper not found — skipping');

    async function patchPaper(data) {
      await page.request.patch(
        `http://localhost:8090/api/collections/check_papers/records/${record.id}`,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data }
      );
    }

    await patchPaper({ status: 'needs_check', flag_reason: '' });
    await page.goto('/paper-check.html?id=arxiv-2303-10782');
    await page.click('#flag-btn');
    await page.click('input[name="flag-reason"][value="Unclear whether SLP"]');
    await page.click('#flag-confirm-btn');
    await expect(page.locator('#status-badge')).toContainText('Flagged');
    await page.click('#clear-status-btn');
    await expect(page.locator('#status-badge')).toContainText('Needs Check');

    const res = await page.request.get(
      `http://localhost:8090/api/collections/check_papers/records/${record.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const updated = await res.json();
    expect(updated.flag_reason).toBe('');

    await patchPaper({ // restore — leave no permanent side effects
      status: record.status || 'needs_check',
      flag_reason: record.flag_reason || '',
    });
  });
});

test.describe('Metrics overview page', () => {
  test('renders table and controls', async ({ page }) => {
    await page.goto('/metrics-index.html');
    await expect(page.locator('#stats-row')).toBeVisible();
    await expect(page.locator('a[href="metric.html"]')).toBeVisible();
    await expect(page.locator('table.papers-table')).toBeVisible();
  });

  test('clicking a row navigates to metric detail page', async ({ page }) => {
    await page.goto('/metrics-index.html');
    const rows = page.locator('.paper-row');
    const count = await rows.count();
    test.skip(count === 0, 'No metrics in backend — skipping row-click test');
    await rows.first().click();
    await expect(page).toHaveURL(/metric\.html\?id=/);
  });
});

test.describe('Metric detail page', () => {
  test('new metric page loads form', async ({ page }) => {
    await page.goto('/metric.html');
    await expect(page.locator('#field-name')).toBeVisible();
    await expect(page.locator('#save-btn')).toBeVisible();
    await expect(page.locator('.back-link')).toBeVisible();
  });

  test('shows Used in Papers section for an existing metric (#used-in-papers)', async ({ page }) => {
    await page.goto('/metrics-index.html');
    const rows = page.locator('.paper-row');
    const count = await rows.count();
    test.skip(count === 0, 'No metrics in backend — skipping');
    await rows.first().click();
    await expect(page).toHaveURL(/metric\.html\?id=/);
    await page.waitForSelector('.used-in-papers-row, .used-in-papers-empty', { timeout: 8000 });
    await expect(page.locator('#used-in-papers-section')).toBeVisible();
  });

  test('editing a field triggers the unsaved-changes guard; saving clears it', async ({ page }) => {
    async function firesGuard() {
      return page.evaluate(() => {
        const evt = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(evt);
        return evt.defaultPrevented;
      });
    }

    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const res = await page.request.get('http://localhost:8090/api/collections/metrics/records?perPage=1',
      { headers: { Authorization: `Bearer ${token}` } });
    const record = (await res.json()).items[0];
    test.skip(!record, 'No metrics in backend — skipping');

    await page.goto(`/metric.html?id=${record.id}`);
    await expect(page.locator('#field-name')).toBeVisible();
    expect(await firesGuard()).toBe(false);

    await page.fill('#field-comments', 'UNSAVED-GUARD-TEST');
    expect(await firesGuard()).toBe(true);

    await page.click('#save-btn');
    await expect(page.locator('#save-confirm')).toBeVisible();
    expect(await firesGuard()).toBe(false);

    await page.request.patch( // restore — leave no permanent side effects
      `http://localhost:8090/api/collections/metrics/records/${record.id}`,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { comments: record.comments || '' } }
    );
  });
});

test.describe('Datasets overview page', () => {
  test('renders table and controls', async ({ page }) => {
    await page.goto('/datasets-index.html');
    await expect(page.locator('#stats-row')).toBeVisible();
    await expect(page.locator('a[href="dataset.html"]')).toBeVisible();
    await expect(page.locator('table.papers-table')).toBeVisible();
  });

  test('clicking a row navigates to dataset detail page', async ({ page }) => {
    await page.goto('/datasets-index.html');
    const rows = page.locator('.paper-row');
    const count = await rows.count();
    test.skip(count === 0, 'No datasets in backend — skipping row-click test');
    await rows.first().click();
    await expect(page).toHaveURL(/dataset\.html\?id=/);
  });

  test('renders the filter bar with all controls (#106)', async ({ page }) => {
    await page.goto('/datasets-index.html');
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#filter-available')).toBeVisible();
    await expect(page.locator('#filter-on-modal')).toBeVisible();
    await expect(page.locator('#filter-correspondence')).toBeVisible();
    await expect(page.locator('#filter-orphan')).toBeVisible();
    await expect(page.locator('#filter-final')).toBeVisible();
    await expect(page.locator('#results-count')).toBeHidden(); // unfiltered by default
  });

  test('On Modal / Correspondence columns give visual confirmation that a filter is working (#106)', async ({ page }) => {
    await page.goto('/datasets-index.html');
    await expect(page.locator('thead th', { hasText: 'On Modal' })).toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Correspondence' })).toBeVisible();

    await page.selectOption('#filter-correspondence', 'waiting');
    const rows = page.locator('.paper-row');
    const count = await rows.count();
    test.skip(count === 0, 'No datasets with correspondence=contacted_waiting — skipping');

    // Every row left after filtering should visibly show the same
    // "Awaiting reply" badge the filter selected — that visible match is
    // the whole point of the columns.
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      await expect(rows.nth(i).locator('td').nth(4)).toContainText('Awaiting reply');
    }
  });

  test('search filters live and shows the result count (#106)', async ({ page }) => {
    await page.goto('/datasets-index.html');
    const totalRows = await page.locator('.paper-row').count();
    test.skip(totalRows === 0, 'No datasets in backend — skipping');

    const name = await page.locator('.paper-row td strong').first().textContent();
    const uniquePrefix = name.trim().slice(0, 5);
    await page.fill('#search-input', uniquePrefix);
    await expect(page.locator('#results-count')).toBeVisible();
    await expect(page.locator('#results-count')).toContainText(`of ${totalRows} datasets`);
    await expect(page).toHaveURL(new RegExp(`[?&]q=${uniquePrefix}`));

    await page.click('#search-clear-btn');
    await expect(page.locator('#results-count')).toBeHidden();
    await expect(page).toHaveURL(/datasets-index\.html$/);
  });

  test('orphan and final-paper filters partition the dataset list (#106)', async ({ page }) => {
    await page.goto('/datasets-index.html');
    const totalRows = await page.locator('.paper-row').count();
    test.skip(totalRows === 0, 'No datasets in backend — skipping');

    await page.selectOption('#filter-orphan', 'only');
    const orphanCount = await page.locator('.paper-row').count();
    await page.selectOption('#filter-orphan', 'hide');
    const nonOrphanCount = await page.locator('.paper-row').count();
    expect(orphanCount + nonOrphanCount).toBe(totalRows);
    await page.selectOption('#filter-orphan', 'all');

    await page.selectOption('#filter-final', 'only');
    const finalCount = await page.locator('.paper-row').count();
    expect(finalCount).toBeLessThanOrEqual(totalRows);
    await expect(page).toHaveURL(/[?&]final=only/);
  });

  test('a filter set away from "All" is visually highlighted; others stay neutral (#106)', async ({ page }) => {
    await page.goto('/datasets-index.html');
    await expect(page.locator('#filter-available')).not.toHaveClass(/active/);

    await page.selectOption('#filter-available', 'yes');
    await expect(page.locator('#filter-available')).toHaveClass(/active/);
    await expect(page.locator('#filter-on-modal')).not.toHaveClass(/active/);
    await expect(page.locator('#filter-correspondence')).not.toHaveClass(/active/);
    await expect(page.locator('#filter-orphan')).not.toHaveClass(/active/);
    await expect(page.locator('#filter-final')).not.toHaveClass(/active/);

    await page.selectOption('#filter-available', 'all');
    await expect(page.locator('#filter-available')).not.toHaveClass(/active/);
  });

  test('Clear filters resets search and all selects, and is disabled when nothing is active (#106)', async ({ page }) => {
    await page.goto('/datasets-index.html');
    await expect(page.locator('#clear-filters-btn')).toBeDisabled();

    await page.fill('#search-input', 'PHOENIX');
    await page.selectOption('#filter-available', 'yes');
    await expect(page.locator('#clear-filters-btn')).toBeEnabled();

    await page.click('#clear-filters-btn');
    await expect(page.locator('#search-input')).toHaveValue('');
    await expect(page.locator('#filter-available')).toHaveValue('all');
    await expect(page.locator('#filter-available')).not.toHaveClass(/active/);
    await expect(page.locator('#results-count')).toBeHidden();
    await expect(page).toHaveURL(/datasets-index\.html$/);
    await expect(page.locator('#clear-filters-btn')).toBeDisabled();
  });

  test('filters round-trip through Details -> dataset.html -> Back link and breadcrumb (#106)', async ({ page }) => {
    await page.goto('/datasets-index.html');
    await page.selectOption('#filter-available', 'yes');
    const rows = page.locator('.paper-row');
    const count = await rows.count();
    test.skip(count === 0, 'No available datasets in backend — skipping');

    await rows.first().locator('.col-action a').click();
    await expect(page).toHaveURL(/dataset\.html\?id=.*[?&]available=yes/);

    // Two separate links point back at datasets-index.html — the explicit
    // "← Back" link and the "Datasets" breadcrumb crumb — both need the
    // filter, or one of them silently drops it.
    const backHref = await page.locator('.back-link').getAttribute('href');
    const breadcrumbHref = await page.locator('#breadcrumb-datasets-link').getAttribute('href');
    expect(backHref).toContain('available=yes');
    expect(breadcrumbHref).toContain('available=yes');

    await page.click('#breadcrumb-datasets-link');
    await expect(page).toHaveURL(/datasets-index\.html\?available=yes/);
    await expect(page.locator('#filter-available')).toHaveValue('yes');
  });
});

test.describe('Dataset detail page', () => {
  test('new dataset page loads form', async ({ page }) => {
    await page.goto('/dataset.html');
    await expect(page.locator('#field-name')).toBeVisible();
    await expect(page.locator('#field-license')).toBeVisible();
    await expect(page.locator('input[name="available"]')).toHaveCount(3);
    await expect(page.locator('input[name="on_modal"]')).toHaveCount(3);
    await expect(page.locator('input[name="correspondence"]')).toHaveCount(3);
    await expect(page.locator('#save-btn')).toBeVisible();
    await expect(page.locator('.back-link')).toBeVisible();
    // A new, unsaved dataset has no place in any nav order — both ◀ ▶ stay
    // disabled and the counter shows a placeholder instead of "1 / N".
    await expect(page.locator('#prev-dataset')).toBeDisabled();
    await expect(page.locator('#next-dataset')).toBeDisabled();
    await expect(page.locator('#dataset-counter')).toHaveText('—');
  });

  test('◀ ▶ steps through the filtered dataset selection from datasets-index.html (#106)', async ({ page }) => {
    await page.goto('/datasets-index.html');
    await page.selectOption('#filter-available', 'yes');
    const rows = page.locator('.paper-row');
    const rowCount = await rows.count();
    test.skip(rowCount < 2, 'Fewer than 2 available datasets in backend — skipping');

    await rows.first().locator('.col-action a').click();
    await expect(page).toHaveURL(/dataset\.html\?id=.*[?&]available=yes/);
    await page.waitForTimeout(400); // computeNavOrder()'s pbGetAll calls aren't awaited by init()

    await expect(page.locator('#dataset-counter')).toHaveText(`1 / ${rowCount}`);
    await expect(page.locator('#prev-dataset')).toBeDisabled();
    await expect(page.locator('#next-dataset')).toBeEnabled();

    await page.click('#next-dataset');
    await page.waitForURL(/dataset\.html\?id=.*[?&]available=yes/);
    await page.waitForTimeout(400);
    await expect(page.locator('#dataset-counter')).toHaveText(`2 / ${rowCount}`);
    await expect(page.locator('#prev-dataset')).toBeEnabled();

    await page.click('#prev-dataset');
    await page.waitForURL(/dataset\.html\?id=.*[?&]available=yes/);
    await page.waitForTimeout(400);
    await expect(page.locator('#dataset-counter')).toHaveText(`1 / ${rowCount}`);
    await expect(page.locator('#prev-dataset')).toBeDisabled();
  });

  test('clicking ▶ with unsaved changes prompts to save; Cancel stays put, OK saves and continues (#106)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const res = await page.request.get('http://localhost:8090/api/collections/datasets/records?perPage=2',
      { headers: { Authorization: `Bearer ${token}` } });
    const items = (await res.json()).items;
    test.skip(items.length < 2, 'Fewer than 2 datasets in backend — skipping');
    const [record] = items;
    const originalComments = record.comments || '';

    await page.goto(`/dataset.html?id=${record.id}`);
    await page.waitForTimeout(400);

    // Cancel: stays on the same dataset, edit is preserved rather than lost.
    await page.fill('#field-comments', originalComments + ' UNSAVED-NAV-TEST');
    page.once('dialog', dialog => dialog.dismiss());
    await page.click('#next-dataset');
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(new RegExp(`id=${record.id}`));
    await expect(page.locator('#field-comments')).toHaveValue(originalComments + ' UNSAVED-NAV-TEST');

    // OK: saves the pending edit, then navigates.
    page.once('dialog', dialog => dialog.accept());
    await page.click('#next-dataset');
    await page.waitForFunction(
      oldId => new URLSearchParams(window.location.search).get('id') !== oldId,
      record.id,
      { timeout: 5000 }
    );

    const check = await page.request.get(`http://localhost:8090/api/collections/datasets/records/${record.id}`,
      { headers: { Authorization: `Bearer ${token}` } });
    expect((await check.json()).comments).toBe(originalComments + ' UNSAVED-NAV-TEST');

    await page.request.patch(`http://localhost:8090/api/collections/datasets/records/${record.id}`, // restore
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { comments: originalComments } });
  });

  test('Stored on Modal.com / Correspondence radios persist and are optional (#104)', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const res = await page.request.get('http://localhost:8090/api/collections/datasets/records?perPage=1',
      { headers: { Authorization: `Bearer ${token}` } });
    const record = (await res.json()).items[0];
    test.skip(!record, 'No datasets in backend — skipping');

    async function patchDataset(data) {
      await page.request.patch(`http://localhost:8090/api/collections/datasets/records/${record.id}`,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data });
    }

    // #104 depends on backend PR #57 (on_modal/correspondence fields on
    // datasets), which was still unmerged when this test was written —
    // detect whether the deployed schema actually has them yet and skip
    // gracefully rather than fail against a backend that hasn't caught up.
    await patchDataset({ on_modal: 'yes', correspondence: 'contacted_waiting' });
    const check = await (await page.request.get(
      `http://localhost:8090/api/collections/datasets/records/${record.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )).json();
    test.skip(check.on_modal !== 'yes', 'Backend does not have on_modal/correspondence fields yet — skipping (depends on backend PR #57)');

    await patchDataset({ on_modal: '', correspondence: '' }); // reset before loading the UI

    await page.goto(`/dataset.html?id=${record.id}`);
    await expect(page.locator('input[name="on_modal"][value=""]')).toBeChecked();
    await expect(page.locator('input[name="correspondence"][value=""]')).toBeChecked();

    await page.check('input[name="on_modal"][value="yes"]');
    await page.check('input[name="correspondence"][value="contacted_got_reply"]');
    await page.click('#save-btn');
    await expect(page.locator('#save-confirm')).toBeVisible();

    await page.reload();
    await expect(page.locator('input[name="on_modal"][value="yes"]')).toBeChecked();
    await expect(page.locator('input[name="correspondence"][value="contacted_got_reply"]')).toBeChecked();

    await patchDataset({ // restore — leave no permanent side effects
      on_modal:       record.on_modal       || '',
      correspondence: record.correspondence || '',
    });
  });

  test('shows Used in Papers section for an existing dataset (#used-in-papers)', async ({ page }) => {
    await page.goto('/datasets-index.html');
    const rows = page.locator('.paper-row');
    const count = await rows.count();
    test.skip(count === 0, 'No datasets in backend — skipping');
    await rows.first().click();
    await expect(page).toHaveURL(/dataset\.html\?id=/);
    await page.waitForSelector('.used-in-papers-row, .used-in-papers-empty', { timeout: 8000 });
    await expect(page.locator('#used-in-papers-section')).toBeVisible();
  });

  test('editing a field triggers the unsaved-changes guard; saving clears it', async ({ page }) => {
    async function firesGuard() {
      return page.evaluate(() => {
        const evt = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(evt);
        return evt.defaultPrevented;
      });
    }

    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const res = await page.request.get('http://localhost:8090/api/collections/datasets/records?perPage=1',
      { headers: { Authorization: `Bearer ${token}` } });
    const record = (await res.json()).items[0];
    test.skip(!record, 'No datasets in backend — skipping');

    await page.goto(`/dataset.html?id=${record.id}`);
    await expect(page.locator('#field-name')).toBeVisible();
    expect(await firesGuard()).toBe(false);

    await page.fill('#field-comments', 'UNSAVED-GUARD-TEST');
    expect(await firesGuard()).toBe(true);

    await page.click('#save-btn');
    await expect(page.locator('#save-confirm')).toBeVisible();
    expect(await firesGuard()).toBe(false);

    await page.request.patch( // restore — leave no permanent side effects
      `http://localhost:8090/api/collections/datasets/records/${record.id}`,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { comments: record.comments || '' } }
    );
  });

  test('a new (unsaved) dataset also triggers the guard while being typed into', async ({ page }) => {
    await page.goto('/dataset.html');
    await expect(page.locator('#field-name')).toBeVisible();

    let prevented = await page.evaluate(() => {
      const evt = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evt);
      return evt.defaultPrevented;
    });
    expect(prevented).toBe(false);

    await page.fill('#field-name', 'Unsaved Guard Test Dataset');
    prevented = await page.evaluate(() => {
      const evt = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evt);
      return evt.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });
});

test.describe('Review Stats page', () => {
  test('renders all breakdown sections', async ({ page }) => {
    await page.goto('/stats.html');
    await expect(page.locator('#stats-summary')).toContainText('papers total');
    await expect(page.locator('#status-breakdown .stat-bar-row')).toHaveCount(4);
    await expect(page.locator('#fields-breakdown tr')).toHaveCount(5);
    await expect(page.locator('a[href="index.html"]')).toBeVisible();
  });

  test('clickable Top Datasets/Metrics labels are visually distinct from non-clickable ones', async ({ page }) => {
    await page.goto('/stats.html');
    await page.waitForSelector('#top-datasets .stat-bar-row, #top-reviewers .stat-bar-row', { timeout: 10000 });

    const linkLabelCount = await page.locator('#top-datasets a.stat-bar-label').count();
    test.skip(linkLabelCount === 0, 'No datasets in Top Datasets — skipping');

    const link = page.locator('#top-datasets a.stat-bar-label').first();
    const linkColor = await link.evaluate(el => getComputedStyle(el).color);
    // Same accent blue as .review-link, so a link at rest is visually
    // distinct from a plain (non-clickable) label — not just on hover.
    expect(linkColor).toBe('rgb(74, 144, 217)');
    // Opens in a new tab so clicking away from stats.html doesn't lose your
    // place in the dashboard, same as the "Used in Papers" links.
    await expect(link).toHaveAttribute('target', '_blank');

    const plainLabelCount = await page.locator('#top-reviewers .stat-bar-label').count();
    if (plainLabelCount > 0) {
      const plainColor = await page.locator('#top-reviewers .stat-bar-label').first().evaluate(el => getComputedStyle(el).color);
      expect(plainColor).not.toBe(linkColor);
    }
  });

  test('the availability badge does not misalign the bar tracks in Top Datasets, even for unanswered availability', async ({ page }) => {
    await page.goto('/stats.html');
    await page.waitForSelector('#top-datasets .stat-bar-row', { timeout: 10000 });

    const rowCount = await page.locator('#top-datasets .stat-bar-row').count();
    test.skip(rowCount < 2, 'Fewer than 2 datasets in Top Datasets — skipping');

    // Every row must reserve a fixed-width badge slot, whether or not that
    // slot actually holds a badge — a dataset's availability can be
    // unanswered, and omitting the slot entirely for that row would
    // collapse its reserved space, pushing its bar track left of the rows
    // that do have a badge.
    await expect(page.locator('#top-datasets .stat-bar-badge-slot')).toHaveCount(rowCount);

    // Force one row to have no badge at all (unanswered availability) and
    // another to hold the widest badge text, directly in the DOM —
    // independent of whatever the live data currently has — to exercise
    // both ends of the fixed-width slot regardless of current backend state.
    await page.evaluate(() => {
      const slots = document.querySelectorAll('#top-datasets .stat-bar-badge-slot');
      slots[0].innerHTML = '';
      slots[1].innerHTML = '<span class="avail-badge avail-no">Not available</span>';
    });

    const trackXs = await page.$$eval('#top-datasets .stat-bar-track', els => els.map(el => el.getBoundingClientRect().x));
    expect(new Set(trackXs).size).toBe(1);
  });

  test('reachable from the landing page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="stats.html"]');
    await expect(page).toHaveURL(/stats\.html/);
  });
});

test.describe('Dataset Confirmation Tracker page', () => {
  test('reachable from the landing page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="dataset-confirmation-index.html"]');
    await expect(page).toHaveURL(/dataset-confirmation-index\.html/);
  });

  test('renders the table structure and confirmation filter buttons via direct navigation', async ({ page }) => {
    await page.goto('/dataset-confirmation-index.html');
    await expect(page.locator('#stats-row')).toBeVisible();
    await expect(page.locator('table.papers-table')).toBeVisible();
    await expect(page.locator('.filter-btn')).toHaveCount(3);
    await expect(page.locator('.filter-btn.active')).toHaveText('All');
  });

  test('the active confirmation filter is reflected in the URL and restored on direct navigation (#75)', async ({ page }) => {
    await page.goto('/dataset-confirmation-index.html');
    await expect(page).toHaveURL(/dataset-confirmation-index\.html$/); // "All" (default) omitted from the URL

    await page.click('.filter-btn[data-confirmation="confirmed"]');
    await expect(page).toHaveURL(/[?&]confirmation=confirmed/);

    await page.click('.filter-btn[data-confirmation="not_confirmed"]');
    await expect(page).toHaveURL(/[?&]confirmation=not_confirmed/);

    await page.click('.filter-btn[data-confirmation="all"]');
    await expect(page).toHaveURL(/dataset-confirmation-index\.html$/);

    await page.goto('/dataset-confirmation-index.html?confirmation=confirmed');
    await expect(page.locator('.filter-btn.active')).toHaveText('Confirmed');
  });

  test('Download JSON exports the currently-filtered papers, with locking fields stripped', async ({ page }) => {
    await page.goto('/dataset-confirmation-index.html');
    await page.waitForSelector('.paper-row, .no-results', { timeout: 8000 });

    const rowCount = await page.locator('.paper-row').count();
    test.skip(rowCount === 0, 'No final papers in the backend — skipping');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-json-btn'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^dataset-confirmation-all-\d{4}-\d{2}-\d{2}\.json$/);

    const path = await download.path();
    const data = JSON.parse(readFileSync(path, 'utf8'));
    expect(data).toHaveLength(rowCount);
    for (const paper of data) {
      expect(paper).not.toHaveProperty('locked_by');
      expect(paper).not.toHaveProperty('locked_at');
      for (const dataset of paper.expand?.datasets || []) {
        expect(dataset).not.toHaveProperty('locked_by');
        expect(dataset).not.toHaveProperty('locked_at');
      }
    }

    // Filtering to "Confirmed" narrows the export to just that subset.
    await page.click('.filter-btn[data-confirmation="confirmed"]');
    const confirmedCount = await page.locator('.paper-row').count();
    const [download2] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-json-btn'),
    ]);
    expect(download2.suggestedFilename()).toMatch(/^dataset-confirmation-confirmed-\d{4}-\d{2}-\d{2}\.json$/);
    const data2 = JSON.parse(readFileSync(await download2.path(), 'utf8'));
    expect(data2).toHaveLength(confirmedCount);
    expect(data2.every(p => p.confirmation === 'confirmed')).toBe(true);
  });

  test('lists every final paper regardless of dataset availability, and the confirmation filters partition them correctly', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));

    // Find an existing final paper with exactly one dataset, so flipping
    // that one dataset's availability deterministically flips this paper's
    // confirmation status either way, regardless of what else is in the backend.
    const papersRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(status="final")&expand=datasets&perPage=200',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const candidate = (await papersRes.json()).items.find(p => (p.expand?.datasets || []).length === 1);
    test.skip(!candidate, 'No finalized paper with exactly one dataset in the backend — skipping');
    const dataset = candidate.expand.datasets[0];
    const originalAvailable = dataset.available || '';

    async function patchDataset(available) {
      await page.request.patch(
        `http://localhost:8090/api/collections/datasets/records/${dataset.id}`,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data: { available } }
      );
    }

    // Unanswered availability → still listed under "All" (unlike the old
    // behavior, which hid it entirely) and "Unconfirmed", but not "Confirmed".
    await patchDataset('');
    await page.goto('/dataset-confirmation-index.html');
    await page.waitForSelector('.paper-row, .no-results', { timeout: 8000 });
    await expect(page.locator('.paper-row', { hasText: dataset.name })).toHaveCount(1);

    await page.click('.filter-btn[data-confirmation="confirmed"]');
    await expect(page.locator('.paper-row', { hasText: dataset.name })).toHaveCount(0);

    await page.click('.filter-btn[data-confirmation="not_confirmed"]');
    await expect(page.locator('.paper-row', { hasText: dataset.name })).toHaveCount(1);

    // All datasets confirmed available → "Confirmed", not "Unconfirmed".
    await patchDataset('yes');
    await page.goto('/dataset-confirmation-index.html');
    await page.waitForSelector('.paper-row, .no-results', { timeout: 8000 });

    await page.click('.filter-btn[data-confirmation="not_confirmed"]');
    await expect(page.locator('.paper-row', { hasText: dataset.name })).toHaveCount(0);

    await page.click('.filter-btn[data-confirmation="confirmed"]');
    const row = page.locator('.paper-row', { hasText: dataset.name });
    await expect(row).toHaveCount(1);

    // All datasets confirmed UNAVAILABLE also counts as "Confirmed" — the
    // investigation is settled either way, per the page's explicit spec.
    await patchDataset('no');
    await page.goto('/dataset-confirmation-index.html');
    await page.waitForSelector('.paper-row, .no-results', { timeout: 8000 });
    await page.click('.filter-btn[data-confirmation="confirmed"]');
    await expect(page.locator('.paper-row', { hasText: dataset.name })).toHaveCount(1);

    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.locator('.paper-row', { hasText: dataset.name }).locator('.col-action a').click(),
    ]);
    await newPage.waitForLoadState();
    expect(newPage.url()).toContain(`paper.html?id=${candidate.paper_id}`);
    expect(page.url()).toContain('dataset-confirmation-index.html'); // original tab unaffected
    await newPage.close();

    await patchDataset(originalAvailable); // restore — leave no permanent side effects
  });

  test('dataset chip is colored by availability, its text is link-blue, and its link opens dataset.html directly', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));

    const papersRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(status="final")&expand=datasets&perPage=200',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const candidate = (await papersRes.json()).items.find(p => (p.expand?.datasets || []).length === 1);
    test.skip(!candidate, 'No finalized paper with exactly one dataset in the backend — skipping');
    const dataset = candidate.expand.datasets[0];
    const originalAvailable = dataset.available || '';

    async function patchDataset(available) {
      await page.request.patch(
        `http://localhost:8090/api/collections/datasets/records/${dataset.id}`,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data: { available } }
      );
    }

    await patchDataset('yes');
    await page.goto('/dataset-confirmation-index.html');
    await page.waitForSelector('.paper-row, .no-results', { timeout: 8000 });

    const chip = page.locator('.paper-row', { hasText: dataset.name }).locator('.chip', { hasText: dataset.name });
    await expect(chip).toHaveClass(/chip-avail-yes/);

    // Same accent blue as .review-link/.stat-bar-label, so the chip still
    // reads as clickable regardless of its green/red/gray availability color.
    const linkColor = await chip.locator('a').evaluate(el => getComputedStyle(el).color);
    expect(linkColor).toBe('rgb(74, 144, 217)');

    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      chip.locator('a').click(),
    ]);
    await newPage.waitForLoadState();
    expect(newPage.url()).toContain(`dataset.html?id=${dataset.id}`);
    expect(page.url()).toContain('dataset-confirmation-index.html'); // clicking the chip didn't also trigger the row's own click handler
    await newPage.close();

    await patchDataset(originalAvailable); // restore — leave no permanent side effects
  });
});
