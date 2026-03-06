/**
 * One-off script to search for specific agencies on /actions and /action-list.
 * Run: npx playwright test e2e/search-agencies.spec.ts
 */
import { test } from '@playwright/test';

const SEARCH_TERMS = [
  'Maryland State Police',
  'Pittsburg Bureau of Police',
  'Pittsburgh Bureau of Police',
  'Pittsburg Bureau of Police -BA',
];

test.describe('Agency search on /actions and /action-list', () => {
  test('actions page: check filter defaults and search for agencies', async ({ page }) => {
    await page.goto('/actions');
    await page.waitForLoadState('networkidle');

    const noData = page.getByText('No data available');
    const noMatch = page.getByText('No agencies match the current filters');
    const hasData = !(await noData.isVisible());
    console.log(`[ACTIONS] Has data: ${hasData}`);

    if (!hasData) {
      console.log('[ACTIONS] No data - skipping search. Upload files first.');
      return;
    }

    const lineSizeCheckboxes = page.locator('input[type="checkbox"]');
    const checkedCount = await lineSizeCheckboxes.filter({ has: page.locator(':checked') }).count();
    console.log(`[ACTIONS] Line size checkboxes checked by default: ${checkedCount} (0 = no filters)`);

    const searchInput = page.getByPlaceholder('Search agency name or ID...');
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });

    for (const term of SEARCH_TERMS) {
      await searchInput.clear();
      await searchInput.fill(term);
      await page.waitForTimeout(500);

      const noMatchVisible = await noMatch.isVisible();
      const found = hasData && !noMatchVisible;

      let section = '';
      let churnType = '';
      let monthChurned = '';

      if (found) {
        const row = page.locator('table tbody tr').filter({ hasText: term }).first();
        if (await row.isVisible()) {
          const allCells = await row.locator('td').allTextContents();
          const rowText = allCells.join(' ');
          if (rowText.includes('2025 churned') || rowText.includes('2026 churned')) {
            section = 'Agencies Churned';
            churnType = rowText.includes('2025 churned') ? '2025 churned' : '2026 churned';
            const match = rowText.match(/(20\d{2}-\d{2})/);
            monthChurned = match ? match[1] : '';
          } else if (rowText.includes('At risk')) {
            section = 'At Risk';
          } else if (rowText.includes('Close to')) {
            section = 'Close to Adopting';
          } else {
            section = 'Agencies Churned';
            churnType = rowText.includes('2025 churned') ? '2025 churned' : rowText.includes('2026 churned') ? '2026 churned' : '';
            const match = rowText.match(/(20\d{2}-\d{2})/);
            monthChurned = match ? match[1] : '';
          }
        }
      }

      console.log(`[ACTIONS] "${term}": found=${found}, section=${section || 'N/A'}, churnType=${churnType || 'N/A'}, monthChurned=${monthChurned || 'N/A'}`);
    }
  });

  test('action-list page: check filter defaults and search for agencies', async ({ page }) => {
    await page.goto('/action-list');
    await page.waitForLoadState('networkidle');

    const noData = page.getByText('No data available');
    const noMatch = page.getByText('No agencies match the current filters');
    const hasData = !(await noData.isVisible());
    console.log(`[ACTION-LIST] Has data: ${hasData}`);

    if (!hasData) {
      console.log('[ACTION-LIST] No data - skipping search. Upload files first.');
      return;
    }

    const labelSelect = page.locator('select');
    const labelValue = await labelSelect.first().inputValue();
    console.log(`[ACTION-LIST] Label filter default: ${labelValue || 'all'}`);
    console.log(`[ACTION-LIST] Line size filter: not present`);

    for (const term of SEARCH_TERMS) {
      const searchInput = page.getByPlaceholder('Search agency name or ID...');
      await searchInput.clear();
      await searchInput.fill(term);
      await page.waitForTimeout(500);

      const noMatchVisible = await noMatch.isVisible();
      const found = hasData && !noMatchVisible;

      let label = '';
      if (found) {
        const row = page.locator('table tbody tr').filter({ hasText: term }).first();
        if (await row.isVisible()) {
          const labelSpan = row.locator('span').filter({ hasText: /Adopting|At Risk|Churned|Not Adopting|Top Performer|Ineligible/ }).first();
          label = await labelSpan.textContent() || '';
        }
      }

      console.log(`[ACTION-LIST] "${term}": found=${found}, label=${label || 'N/A'}`);
    }
  });
});
