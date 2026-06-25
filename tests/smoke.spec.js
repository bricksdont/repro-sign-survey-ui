import { test, expect } from '@playwright/test';

const TEST_EMAIL    = process.env.PB_TEST_EMAIL;
const TEST_PASSWORD = process.env.PB_TEST_PASSWORD;

// Skip all tests if backend credentials aren't configured (e.g. in CI without PocketBase)
test.skip(!TEST_EMAIL || !TEST_PASSWORD,
  'Skipped: set PB_TEST_EMAIL and PB_TEST_PASSWORD env vars to run with PocketBase backend');

test.beforeEach(async ({ page }) => {
  // Navigate first so the page's origin is set, then inject auth token into sessionStorage
  await page.goto('/login.html');
  const res = await page.request.post(
    'http://localhost:8090/api/collections/users/auth-with-password',
    { data: { identity: TEST_EMAIL, password: TEST_PASSWORD } }
  );
  const { token, record } = await res.json();
  await page.evaluate(({ token, userId }) => {
    sessionStorage.setItem('pb_token', token);
    sessionStorage.setItem('pb_user_id', userId);
  }, { token, userId: record.id });
});

test.describe('Overview page', () => {
  test('renders paper list and controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.paper-row').first()).toBeVisible();
    await expect(page.locator('#stats-row')).toBeVisible();
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('.filter-btn')).toHaveCount(5);
    await expect(page.locator('#review-next-btn')).toBeVisible();
  });

  test('search filters rows live', async ({ page }) => {
    await page.goto('/');
    await page.fill('#search-input', 'SignCLIP');
    await expect(page.locator('.paper-row')).toHaveCount(1);
    await expect(page.locator('#results-count')).toContainText('Showing 1 of');
  });

  test('status filter shows empty state when no papers match', async ({ page }) => {
    await page.goto('/');
    // Search for something that won't match any paper, to guarantee no-results
    await page.fill('#search-input', 'zzz-no-match-zzz');
    await expect(page.locator('.no-results')).toBeVisible();
    await expect(page.locator('#results-count')).toContainText('Showing 0 of');
  });

  test('clicking a row navigates to the detail page', async ({ page }) => {
    await page.goto('/');
    await page.locator('.paper-row').first().click();
    await expect(page).toHaveURL(/paper\.html\?id=/);
  });
});

test.describe('Paper detail page', () => {
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
    // Reset status to needs_review first so the test is repeatable
    await page.goto('/login.html');
    const token = await page.evaluate(() => sessionStorage.getItem('pb_token'));
    // Find the record by paper_id
    const listRes = await page.request.get(
      'http://localhost:8090/api/collections/papers/records?filter=(paper_id="emnlp-2024-518")',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { items } = await listRes.json();
    if (items.length) {
      await page.request.patch(
        `http://localhost:8090/api/collections/papers/records/${items[0].id}`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: { status: 'needs_review' },
        }
      );
    }

    await page.goto('/paper.html?id=emnlp-2024-518');
    await expect(page.locator('#status-badge')).toContainText('Needs Review');
    await page.click('#save-btn');
    await expect(page.locator('#status-badge')).toContainText('Final');
  });

  test('paper navigation updates URL', async ({ page }) => {
    await page.goto('/paper.html?id=emnlp-2024-518');
    const initialUrl = page.url();
    await page.click('#next-paper');
    // URL should change to a different paper
    await expect(page).not.toHaveURL(initialUrl);
    await expect(page).toHaveURL(/paper\.html\?id=/);
  });

  test('back link returns to overview', async ({ page }) => {
    await page.goto('/paper.html?id=emnlp-2024-518');
    await page.click('.back-link');
    await expect(page).toHaveURL(/index\.html/);
  });
});
