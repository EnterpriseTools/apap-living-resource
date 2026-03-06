/**
 * Check /overview for runtime error overlay and month-over-month table.
 * Run: npx playwright test e2e/overview-check.spec.ts
 */
import { test } from '@playwright/test';

test('overview page: check for error overlay and month-over-month table', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message + '\n' + err.stack));

  await page.goto('/overview');
  await page.waitForLoadState('networkidle');

  // Check for Next.js/React error overlay (common selectors)
  const overlaySelectors = [
    '[data-nextjs-dialog]',
    '.nextjs-toast-errors',
    '[class*="error-overlay"]',
    '[id*="error-overlay"]',
    'iframe[src*="error"]',
    'body:has([class*="ReactErrorOverlay"])',
  ];

  let overlayFound = false;
  let overlayMessage = '';
  let overlayStack = '';

  for (const sel of overlaySelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 })) {
        overlayFound = true;
        overlayMessage = await el.textContent() || '';
        break;
      }
    } catch {
      // selector not found, continue
    }
  }

  // Also check for visible error text (red overlay often shows "Error" or "Unhandled")
  if (!overlayFound) {
    const errorText = page.locator('text=/Error:|Unhandled|Runtime Error|Something went wrong/i').first();
    if (await errorText.isVisible({ timeout: 500 })) {
      overlayFound = true;
      overlayMessage = await errorText.textContent() || '';
      const stackEl = page.locator('pre, code, [class*="stack"]').first();
      if (await stackEl.isVisible({ timeout: 300 })) {
        overlayStack = await stackEl.textContent() || '';
      }
    }
  }

  if (overlayFound || errors.length > 0) {
    console.log('=== RUNTIME ERROR DETECTED ===');
    if (overlayMessage) console.log('Overlay message:', overlayMessage);
    if (overlayStack) console.log('Stack:', overlayStack);
    errors.forEach((e, i) => console.log(`Page error ${i + 1}:`, e));
  } else {
    console.log('No runtime error overlay visible.');
  }

  // Scroll to month-over-month table (look for table with Metric/Agencies/Eligible points/Adopting points impact headers)
  const momTable = page.locator('table').filter({
    has: page.locator('th:has-text("Metric")'),
  }).filter({
    has: page.locator('th:has-text("Adopting points impact")'),
  }).first();

  let tableVisible = false;
  let hasMetric = false;
  let hasAgencies = false;
  let hasEligiblePoints = false;
  let hasAdoptingImpact = false;

  try {
    await momTable.scrollIntoViewIfNeeded({ timeout: 8000 });
    await page.waitForTimeout(300);
    tableVisible = await momTable.isVisible();
    if (tableVisible) {
      hasMetric = await momTable.locator('th:has-text("Metric")').isVisible();
      hasAgencies = await momTable.locator('th:has-text("Agencies")').isVisible();
      hasEligiblePoints = await momTable.locator('th:has-text("Eligible points")').isVisible();
      hasAdoptingImpact = await momTable.locator('th:has-text("Adopting points impact")').isVisible();
    }
  } catch {
    // Table not present (e.g. no data or only one month)
  }

  console.log('=== MONTH-OVER-MONTH TABLE ===');
  console.log('Table visible:', tableVisible);
  console.log('Column "Metric":', hasMetric);
  console.log('Column "Agencies":', hasAgencies);
  console.log('Column "Eligible points":', hasEligiblePoints);
  console.log('Column "Adopting points impact":', hasAdoptingImpact);
  console.log('Table renders correctly:', tableVisible && hasMetric && hasAgencies && hasEligiblePoints && hasAdoptingImpact);
});
