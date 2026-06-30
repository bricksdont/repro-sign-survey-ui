import { test, expect } from '@playwright/test';

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
  test('shows task cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.task-card')).toHaveCount(2);
    await expect(page.locator('a[href="review-index.html"]')).toBeVisible();
    await expect(page.locator('a[href="check-index.html"]')).toBeVisible();
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
});

test.describe('Review detail page', () => {
  test('loads core UI elements', async ({ page }) => {
    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#pdf-iframe')).toBeVisible();
    await expect(page.locator('#status-badge')).toBeVisible();
    await expect(page.locator('#save-btn')).toBeVisible();
    await expect(page.locator('#save-next-btn')).toBeVisible();
    await expect(page.locator('#flag-btn')).toBeVisible();
    await expect(page.locator('#reject-btn')).toBeVisible();
  });

  test('Save marks paper as Final', async ({ page }) => {
    await page.goto('/login.html');
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    const listRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { items } = await listRes.json();
    const pbId = items[0]?.id;

    async function setStatus(status) {
      if (!pbId) return;
      await page.request.patch(
        `http://localhost:8090/api/collections/papers/records/${pbId}`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: { status },
        }
      );
    }

    await setStatus('needs_review');
    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#status-badge')).toContainText('Needs Review');
    await page.click('#save-btn');
    await expect(page.locator('#status-badge')).toContainText('Final');
    await setStatus('needs_review'); // restore — leave no permanent side effects
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
});
