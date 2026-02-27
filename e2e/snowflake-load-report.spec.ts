/**
 * E2E test: Snowflake load flow and Overview APAP report
 *
 * Run with: npx playwright test e2e/snowflake-load-report.spec.ts --headed
 *
 * Prerequisites:
 * - Dev server running at http://localhost:3000
 * - You may need to complete SSO in the browser window that opens when Snowflake connects
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

async function runLoadAndCapture(
  page: any,
  monthValue: string,
  report: string[],
  snowflakeResponses: Array<{ ok: boolean; body?: any }>
) {
  const monthSelect = page.locator('select').filter({
    has: page.locator('option[value="auto"]'),
  });
  await monthSelect.selectOption(monthValue);
  report.push(`Month selector: ${monthValue}`);

  const loadBtn = page.getByRole('button', { name: /load from snowflake/i });
  await loadBtn.click();
  report.push('Clicking Load from Snowflake...');

  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button');
      return btn && !btn.textContent?.includes('Loading');
    },
    { timeout: 120000 }
  );

  const lastResp = snowflakeResponses[snowflakeResponses.length - 1];
  if (lastResp) {
    report.push(`API response: ok=${lastResp.ok}`);
    if (lastResp.body) {
      report.push(`  monthKey: ${lastResp.body.monthKey ?? 'N/A'}`);
      report.push(`  activityMonth: ${lastResp.body.activityMonth ?? 'N/A'}`);
      const apap = lastResp.body.apap;
      if (apap != null) {
        if (typeof apap === 'object') {
          report.push(`  apap: ${apap.apap?.toFixed(1)}% (${apap.adoptingCount} adopting / ${apap.eligibleCount} eligible agencies)`);
        } else {
          report.push(`  apap: ${apap}%`);
        }
      }
      if (lastResp.body.error) report.push(`  error: ${lastResp.body.error}`);
    }
  }
}

test.describe('Snowflake load and Overview APAP report', () => {
  test('full flow: settings -> upload (Auto) -> load -> overview (Auto) -> upload (2026-01) -> load -> overview', async ({
    page,
  }) => {
    const report: string[] = [];
    const snowflakeResponses: Array<{ ok: boolean; body?: any }> = [];

    const pushResponse = (resp: { ok: boolean; body?: any }) => {
      snowflakeResponses.push(resp);
    };

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/snowflake/process') && response.request().method() === 'POST') {
        try {
          const body = await response.json().catch(() => ({}));
          pushResponse({ ok: response.ok(), body: body as Record<string, unknown> });
        } catch {
          pushResponse({ ok: false, body: {} });
        }
      }
    });

    // 1. Settings - Clear cached snapshots (if enabled)
    report.push('=== Step 1: Settings ===');
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
    const clearBtn = page.getByRole('button', { name: /clear cached snapshots/i });
    const clearEnabled = await clearBtn.isEnabled();
    report.push(`Clear cached snapshots: ${clearEnabled ? 'enabled' : 'disabled'}`);
    if (clearEnabled) {
      await clearBtn.click();
      await page.waitForURL(/\//, { timeout: 5000 });
      report.push('Cleared. Redirected to Home.');
    }

    // 2a. Upload - Auto, Load from Snowflake
    report.push('\n=== Step 2a: Upload (Month = Auto) ===');
    await page.goto(`${BASE_URL}/upload`, { waitUntil: 'networkidle' });
    await runLoadAndCapture(page, 'auto', report, snowflakeResponses);

    // 3a. Overview - Auto load results
    report.push('\n=== Step 3a: Overview (after Auto load) ===');
    await page.goto(`${BASE_URL}/overview`, { waitUntil: 'networkidle' });
    const apapText1 = page.locator('text=/\\d+\\.\\d+%/').first();
    const pointsLine1 = page.locator('text=/\\d+ adopting \\/ \\d+ eligible points/');
    const agenciesLine1 = page.locator('text=/\\d+ adopting \\/ \\d+ eligible agencies/');
    report.push(`Overall APAP: ${(await apapText1.textContent()) ?? 'N/A'}`);
    if ((await pointsLine1.count()) > 0) report.push(`Points: ${(await pointsLine1.first().textContent())?.trim() ?? 'N/A'}`);
    if ((await agenciesLine1.count()) > 0) report.push(`Agencies: ${(await agenciesLine1.first().textContent())?.trim() ?? 'N/A'}`);

    // 2b. Upload - 2026-01, Load from Snowflake
    report.push('\n=== Step 2b: Upload (Month = 2026-01) ===');
    await page.goto(`${BASE_URL}/upload`, { waitUntil: 'networkidle' });
    const has202601 = await page.locator('option[value="2026-01"]').count() > 0;
    if (has202601) {
      await runLoadAndCapture(page, '2026-01', report, snowflakeResponses);
    } else {
      report.push('2026-01 not available in month selector; skipping.');
    }

    // 3b. Overview - 2026-01 load results
    report.push('\n=== Step 3b: Overview (after 2026-01 load) ===');
    await page.goto(`${BASE_URL}/overview`, { waitUntil: 'networkidle' });
    const apapText2 = page.locator('text=/\\d+\\.\\d+%/').first();
    const pointsLine2 = page.locator('text=/\\d+ adopting \\/ \\d+ eligible points/');
    const agenciesLine2 = page.locator('text=/\\d+ adopting \\/ \\d+ eligible agencies/');
    report.push(`Overall APAP: ${(await apapText2.textContent()) ?? 'N/A'}`);
    if ((await pointsLine2.count()) > 0) report.push(`Points: ${(await pointsLine2.first().textContent())?.trim() ?? 'N/A'}`);
    if ((await agenciesLine2.count()) > 0) report.push(`Agencies: ${(await agenciesLine2.first().textContent())?.trim() ?? 'N/A'}`);

    console.log('\n' + '='.repeat(60));
    console.log('SNOWFLAKE LOAD & OVERVIEW REPORT');
    console.log('='.repeat(60));
    report.forEach((line) => console.log(line));
    console.log('='.repeat(60));
  });

  test('Biggest movers: clear cache, load Auto, verify movers and Jan snapshot', async ({
    page,
  }) => {
    const report: string[] = [];

    // 1. Settings - Clear cached snapshots (if enabled)
    report.push('=== Step 1: Settings ===');
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'load', timeout: 15000 });
    const clearBtn = page.getByRole('button', { name: /clear cached snapshots/i });
    const clearEnabled = await clearBtn.isEnabled();
    report.push(`Clear cached snapshots: ${clearEnabled ? 'enabled' : 'disabled'}`);
    if (clearEnabled) {
      await clearBtn.click();
      await page.waitForURL(/\//, { timeout: 5000 });
      report.push('Cleared. Redirected to Home.');
    }

    // 2. Upload - Auto, Load from Snowflake
    report.push('\n=== Step 2: Upload (Month = Auto) ===');
    await page.goto(`${BASE_URL}/upload`, { waitUntil: 'load', timeout: 15000 });
    const monthSelect = page.locator('select').filter({
      has: page.locator('option[value="auto"]'),
    });
    await monthSelect.selectOption('auto');
    const loadBtn = page.getByRole('button', { name: /load from snowflake/i });
    await loadBtn.click();
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button');
        return btn && !btn.textContent?.includes('Loading');
      },
      { timeout: 120000 }
    );
    report.push('Load from Snowflake completed.');

    // 3. Overview - scroll to Biggest movers
    report.push('\n=== Step 3: Overview - Biggest movers ===');
    await page.goto(`${BASE_URL}/overview`, { waitUntil: 'load', timeout: 15000 });

    const biggestMoversSection = page.getByRole('heading', {
      name: /biggest movers \(month over month\)/i,
    });
    await biggestMoversSection.scrollIntoViewIfNeeded();

    const noPositiveMsg = page.locator('text=/No positive MoM changes this period/i');
    const noNegativeMsg = page.locator('text=/No negative MoM changes this period/i');

    const hasPositiveEntries = (await noPositiveMsg.count()) === 0;
    const hasNegativeEntries = (await noNegativeMsg.count()) === 0;

    const positiveList = page.locator('h3:has-text("Top 3 positive")').locator('..').locator('ul li');
    const negativeList = page.locator('h3:has-text("Top 3 negative")').locator('..').locator('ul li');
    const positiveCount = await positiveList.count();
    const negativeCount = await negativeList.count();

    report.push(`Top 3 positive: ${hasPositiveEntries ? `${positiveCount} entries` : 'No positive MoM changes this period.'}`);
    report.push(`Top 3 negative: ${hasNegativeEntries ? `${negativeCount} entries` : 'No negative MoM changes this period.'}`);

    // 4. Check previous month (Jan) snapshot present via Settings
    report.push('\n=== Step 4: Previous month snapshot ===');
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'load', timeout: 15000 });
    const bodyText = await page.locator('main').textContent() ?? '';
    const hasJan2026 = bodyText.includes('2026-01') || bodyText.includes('Jan 2026');
    const hasFeb2026 = bodyText.includes('2026-02') || bodyText.includes('Feb 2026');
    report.push(`Jan 2026 snapshot present: ${hasJan2026 ? 'yes' : 'no'}`);
    report.push(`Feb 2026 snapshot present: ${hasFeb2026 ? 'yes' : 'no'}`);

    console.log('\n' + '='.repeat(60));
    console.log('BIGGEST MOVERS & SNAPSHOT REPORT');
    console.log('='.repeat(60));
    report.forEach((line) => console.log(line));
    console.log('='.repeat(60));
  });

  test('Goal Progress + Biggest movers + cached snapshots (2025-11, current, previous)', async ({
    page,
  }) => {
    const report: string[] = [];
    test.setTimeout(360000); // 6 min for SSO + 3 Snowflake API calls (main, prev, baseline)

    // 1. Settings - Clear cached snapshots (if enabled)
    report.push('=== Step 1: Settings ===');
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'load', timeout: 15000 });
    const clearBtn = page.getByRole('button', { name: /clear cached snapshots/i });
    const clearEnabled = await clearBtn.isEnabled();
    report.push(`Clear cached snapshots: ${clearEnabled ? 'enabled' : 'disabled'}`);
    if (clearEnabled) {
      await clearBtn.click();
      await page.waitForURL(/\//, { timeout: 5000 });
      report.push('Cleared. Redirected to Home.');
    }

    // 2. Upload - Auto, Load from Snowflake
    report.push('\n=== Step 2: Upload (Month = Auto) ===');
    await page.goto(`${BASE_URL}/upload`, { waitUntil: 'load', timeout: 15000 });
    const monthSelect = page.locator('select').filter({
      has: page.locator('option[value="auto"]'),
    });
    await monthSelect.selectOption('auto');
    const loadBtn = page.getByRole('button', { name: /load from snowflake/i });
    await loadBtn.click();
    report.push('Clicking Load from Snowflake... (complete SSO if prompted)');
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button');
        return btn && !btn.textContent?.includes('Loading');
      },
      { timeout: 300000 }
    );
    report.push('Load from Snowflake completed.');

    // 3. Overview - Goal Progress, baseline warning, Biggest movers
    report.push('\n=== Step 3: Overview ===');
    await page.goto(`${BASE_URL}/overview`, { waitUntil: 'load', timeout: 15000 });

    // Goal Progress section (Cohort Goal Progress table with retention/conversion/baseline_ineligible/new_customer)
    const cohortGoalHeading = page.getByRole('heading', { name: 'Cohort Goal Progress', exact: true });
    await cohortGoalHeading.scrollIntoViewIfNeeded();

    const baselineWarning = page.locator('text=/Upload baseline month \\(2025-11\\) to unlock retention/i');
    const baselineWarningVisible = (await baselineWarning.count()) > 0;
    report.push(`Baseline warning visible: ${baselineWarningVisible ? 'yes (baselineAvailable=false)' : 'no (baselineAvailable=true)'}`);

    const driverLabels = [
      '2025 Adopting Retention Rate',
      '2025 Unadopting Conversion Rate',
      "H2 2025 Customers",
      "H1 2026 New Customers",
    ];
    for (const label of driverLabels) {
      const hasLabel = (await page.locator(`text=/${label}/`).count()) > 0;
      report.push(`  Goal Progress has "${label}...": ${hasLabel ? 'yes' : 'no'}`);
    }
    const hasMajor = (await page.locator('table td:has-text("Major")').count()) > 0;
    const hasT1200 = (await page.locator('table td:has-text("T1200")').count()) > 0;
    const hasDirect = (await page.locator('table td:has-text("Direct")').count()) > 0;
    report.push(`  Line sizes (Major, T1200, Direct): ${hasMajor && hasT1200 && hasDirect ? 'all present' : `Major=${hasMajor} T1200=${hasT1200} Direct=${hasDirect}`}`);

    // Biggest movers
    const biggestMoversHeading = page.getByRole('heading', { name: /biggest movers/i });
    await biggestMoversHeading.scrollIntoViewIfNeeded();
    const noPositiveMsg = page.locator('text=/No positive MoM changes this period/i');
    const noNegativeMsg = page.locator('text=/No negative MoM changes this period/i');
    const hasPositiveEntries = (await noPositiveMsg.count()) === 0;
    const hasNegativeEntries = (await noNegativeMsg.count()) === 0;
    const positiveList = page.locator('h3:has-text("Top 3 positive")').locator('..').locator('ul li');
    const negativeList = page.locator('h3:has-text("Top 3 negative")').locator('..').locator('ul li');
    report.push(`Biggest movers - Top 3 positive: ${hasPositiveEntries ? `${await positiveList.count()} entries` : 'No positive MoM changes'}`);
    report.push(`Biggest movers - Top 3 negative: ${hasNegativeEntries ? `${await negativeList.count()} entries` : 'No negative MoM changes'}`);

    // 4. Settings - cached snapshots
    report.push('\n=== Step 4: Cached snapshots ===');
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'load', timeout: 15000 });
    const mainText = await page.locator('main').textContent() ?? '';
    const has202511 = mainText.includes('2025-11') || mainText.includes('Nov 2025');
    const hasCurrent = mainText.includes('2026-02') || mainText.includes('Feb 2026');
    const hasPrevious = mainText.includes('2026-01') || mainText.includes('Jan 2026');
    report.push(`2025-11 (baseline): ${has202511 ? 'yes' : 'no'}`);
    report.push(`Current month (e.g. Feb 2026): ${hasCurrent ? 'yes' : 'no'}`);
    report.push(`Previous month (e.g. Jan 2026): ${hasPrevious ? 'yes' : 'no'}`);

    console.log('\n' + '='.repeat(60));
    console.log('GOAL PROGRESS + BIGGEST MOVERS + CACHED SNAPSHOTS REPORT');
    console.log('='.repeat(60));
    report.forEach((line) => console.log(line));
    console.log('='.repeat(60));
  });

  test('H1 2026 New Customers Adoption Rate - 2026-01 load, denom/numerator/actual%', async ({
    page,
  }) => {
    const report: string[] = [];
    test.setTimeout(300000);

    // 1. Settings - Clear cached snapshots (if enabled)
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'load', timeout: 15000 });
    const clearBtn = page.getByRole('button', { name: /clear cached snapshots/i });
    if (await clearBtn.isEnabled()) {
      await clearBtn.click();
      await page.waitForURL(/\//, { timeout: 5000 });
    }

    // 2. Upload - 2026-01, Load from Snowflake
    await page.goto(`${BASE_URL}/upload`, { waitUntil: 'load', timeout: 15000 });
    const monthSelect = page.locator('select').filter({
      has: page.locator('option[value="auto"]'),
    });
    await monthSelect.selectOption('2026-01');
    const loadBtn = page.getByRole('button', { name: /load from snowflake/i });
    await loadBtn.click();
    report.push('Load from Snowflake (2026-01)... complete SSO if prompted');
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button');
        return btn && !btn.textContent?.includes('Loading');
      },
      { timeout: 300000 }
    );
    report.push('Load completed.');

    // 3. Overview - Goal Progress table, H1 2026 New Customers section
    await page.goto(`${BASE_URL}/overview`, { waitUntil: 'load', timeout: 15000 });
    await page.getByRole('heading', { name: 'Cohort Goal Progress', exact: true }).scrollIntoViewIfNeeded();

    // Extract new_customer rows (H1 2026 New Customers' Adoption Rate)
    report.push('\n=== H1 2026 New Customers\' Adoption Rate (new_customer) ===');
    const newCustomerRows = page.locator('tr[data-driver="new_customer"]');
    const count = await newCustomerRows.count();
    for (let i = 0; i < count; i++) {
      const row = newCustomerRows.nth(i);
      const lineSize = await row.getAttribute('data-line-size');
      const denom = await row.getAttribute('data-denominator');
      const numerator = await row.getAttribute('data-numerator');
      const actualPct = await row.getAttribute('data-actual-pct');
      report.push(`  ${lineSize}: denom=${denom ?? 'N/A'}, numerator=${numerator ?? 'N/A'}, actual%=${actualPct ?? 'N/A'}%`);
    }

    // Retention and conversion sections - check denominators
    report.push('\n=== Retention (2025 Adopting Retention Rate) ===');
    const retentionRows = page.locator('tr[data-driver="retention"]');
    const retCount = await retentionRows.count();
    for (let i = 0; i < retCount; i++) {
      const row = retentionRows.nth(i);
      const lineSize = await row.getAttribute('data-line-size');
      const denom = await row.getAttribute('data-denominator');
      const actualPct = await row.getAttribute('data-actual-pct');
      report.push(`  ${lineSize}: denom=${denom ?? 'N/A'}, actual%=${actualPct ?? 'N/A'}%`);
    }

    report.push('\n=== Conversion (2025 Unadopting Conversion Rate) ===');
    const conversionRows = page.locator('tr[data-driver="conversion"]');
    const convCount = await conversionRows.count();
    for (let i = 0; i < convCount; i++) {
      const row = conversionRows.nth(i);
      const lineSize = await row.getAttribute('data-line-size');
      const denom = await row.getAttribute('data-denominator');
      const actualPct = await row.getAttribute('data-actual-pct');
      report.push(`  ${lineSize}: denom=${denom ?? 'N/A'}, actual%=${actualPct ?? 'N/A'}%`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('H1 2026 NEW CUSTOMERS ADOPTION RATE REPORT');
    console.log('='.repeat(60));
    report.forEach((line) => console.log(line));
    console.log('='.repeat(60));
  });

  test('Auto load: Biggest movers entries + Goal Progress MoM column', async ({
    page,
  }) => {
    const report: string[] = [];
    test.setTimeout(360000);

    // 0. Settings - Clear cached snapshots (if enabled)
    report.push('=== Step 0: Settings - Clear cached snapshots ===');
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'load', timeout: 15000 });
    const clearBtn = page.getByRole('button', { name: /clear cached snapshots/i });
    if (await clearBtn.isEnabled()) {
      await clearBtn.click();
      await page.waitForURL(/\//, { timeout: 5000 });
      report.push('Cleared. Redirected to Home.');
    } else {
      report.push('Clear disabled (no cached snapshots).');
    }

    // 1. Upload - Auto, Load from Snowflake
    report.push('\n=== Step 1: Upload (Auto) - Load from Snowflake ===');
    await page.goto(`${BASE_URL}/upload`, { waitUntil: 'load', timeout: 15000 });
    const monthSelect = page.locator('select').filter({
      has: page.locator('option[value="auto"]'),
    });
    await monthSelect.selectOption('auto');
    const loadBtn = page.getByRole('button', { name: /load from snowflake/i });
    await loadBtn.click();
    report.push('Clicking Load from Snowflake (Auto)... complete SSO if needed');
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button');
        return btn && !btn.textContent?.includes('Loading');
      },
      { timeout: 300000 }
    );
    report.push('Load completed.');

    // 2. Settings - Confirm cached months and current month
    report.push('\n=== Step 2: Settings - Cached months ===');
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'load', timeout: 15000 });
    const mainText = await page.locator('main').textContent() ?? '';
    const hasCurrent = mainText.includes('2026-02') || mainText.includes('Feb 2026');
    const hasPrevious = mainText.includes('2026-01') || mainText.includes('Jan 2026');
    const hasBaseline = mainText.includes('2025-11') || mainText.includes('Nov 2025');
    report.push(`Current (2026-02): ${hasCurrent ? 'yes' : 'no'}`);
    report.push(`Previous (2026-01): ${hasPrevious ? 'yes' : 'no'}`);
    report.push(`Baseline (2025-11): ${hasBaseline ? 'yes' : 'no'}`);

    // 3. Overview - Biggest movers
    report.push('\n=== Step 3: Biggest movers ===');
    await page.goto(`${BASE_URL}/overview`, { waitUntil: 'load', timeout: 15000 });
    const biggestMoversHeading = page.getByRole('heading', { name: /biggest movers \(month over month\)/i });
    await biggestMoversHeading.scrollIntoViewIfNeeded();

    const noPositiveMsg = page.locator('text=/No positive MoM changes this period/i');
    const noNegativeMsg = page.locator('text=/No negative MoM changes this period/i');
    const hasPositiveEntries = (await noPositiveMsg.count()) === 0;
    const hasNegativeEntries = (await noNegativeMsg.count()) === 0;

    const positiveList = page.locator('h3:has-text("Top 3 positive")').locator('..').locator('ul li');
    const negativeList = page.locator('h3:has-text("Top 3 negative")').locator('..').locator('ul li');
    const positiveCount = await positiveList.count();
    const negativeCount = await negativeList.count();

    report.push(`Top 3 positive: ${hasPositiveEntries ? `${positiveCount} entries` : 'No positive MoM changes (empty state)'}`);
    if (hasPositiveEntries && positiveCount > 0) {
      for (let i = 0; i < Math.min(3, positiveCount); i++) {
        const text = await positiveList.nth(i).textContent();
        report.push(`  [${i + 1}] ${text?.trim() ?? ''}`);
      }
    }
    report.push(`Top 3 negative: ${hasNegativeEntries ? `${negativeCount} entries` : 'No negative MoM changes (empty state)'}`);
    if (hasNegativeEntries && negativeCount > 0) {
      for (let i = 0; i < Math.min(3, negativeCount); i++) {
        const text = await negativeList.nth(i).textContent();
        report.push(`  [${i + 1}] ${text?.trim() ?? ''}`);
      }
    }

    // 4. Goal Progress - MoM (pp) column for retention and conversion
    report.push('\n=== Step 4: Goal Progress - MoM (pp) column ===');
    await page.getByRole('heading', { name: 'Cohort Goal Progress', exact: true }).scrollIntoViewIfNeeded();

    // Table columns: Line size(0), High conf(1), Hard climb(2), Actual(3), HC var(4), HC climb var(5), MoM pp(6), Progress(7)
    const momColIndex = 6;
    report.push('Retention (2025 Adopting Retention Rate):');
    const retentionRows = page.locator('tr[data-driver="retention"]');
    const retCount = await retentionRows.count();
    for (let i = 0; i < retCount; i++) {
      const row = retentionRows.nth(i);
      const lineSize = await row.getAttribute('data-line-size');
      const momTd = row.locator('td').nth(momColIndex);
      const momText = await momTd.textContent();
      report.push(`  ${lineSize}: MoM (pp) = ${momText?.trim() ?? 'N/A'}`);
    }
    report.push('Conversion (2025 Unadopting Conversion Rate):');
    const conversionRows = page.locator('tr[data-driver="conversion"]');
    const convCount = await conversionRows.count();
    for (let i = 0; i < convCount; i++) {
      const row = conversionRows.nth(i);
      const lineSize = await row.getAttribute('data-line-size');
      const momTd = row.locator('td').nth(momColIndex);
      const momText = await momTd.textContent();
      report.push(`  ${lineSize}: MoM (pp) = ${momText?.trim() ?? 'N/A'}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('AUTO LOAD: BIGGEST MOVERS + GOAL PROGRESS MoM REPORT');
    console.log('='.repeat(60));
    report.forEach((line) => console.log(line));
    console.log('='.repeat(60));
  });

  test('Goal Progress: H2 2025 + H1 2026 sections - Actual, denom, data quality', async ({
    page,
  }) => {
    const report: string[] = [];
    test.setTimeout(360000);

    // 1. Settings - Clear cached snapshots (if enabled)
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'load', timeout: 15000 });
    const clearBtn = page.getByRole('button', { name: /clear cached snapshots/i });
    if (await clearBtn.isEnabled()) {
      await clearBtn.click();
      await page.waitForURL(/\//, { timeout: 5000 });
    }

    // 2. Upload - Auto, Load from Snowflake
    await page.goto(`${BASE_URL}/upload`, { waitUntil: 'load', timeout: 15000 });
    const monthSelect = page.locator('select').filter({
      has: page.locator('option[value="auto"]'),
    });
    await monthSelect.selectOption('auto');
    const loadBtn = page.getByRole('button', { name: /load from snowflake/i });
    await loadBtn.click();
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button');
        return btn && !btn.textContent?.includes('Loading');
      },
      { timeout: 300000 }
    );

    // 3. Overview - Goal Progress H2 2025 and H1 2026
    await page.goto(`${BASE_URL}/overview`, { waitUntil: 'load', timeout: 15000 });
    await page.getByRole('heading', { name: 'Cohort Goal Progress', exact: true }).scrollIntoViewIfNeeded();

    report.push('=== H2 2025 Customers\' Adoption Rate (baseline_ineligible) ===');
    const baselineIneligibleRows = page.locator('tr[data-driver="baseline_ineligible"]');
    const biCount = await baselineIneligibleRows.count();
    for (let i = 0; i < biCount; i++) {
      const row = baselineIneligibleRows.nth(i);
      const lineSize = await row.getAttribute('data-line-size');
      const denom = await row.getAttribute('data-denominator');
      const numerator = await row.getAttribute('data-numerator');
      const actualPct = await row.getAttribute('data-actual-pct');
      const actualDisplay = actualPct ? `${actualPct}%` : '—';
      const reason = denom === '0' ? '(denom=0, no eligible agencies)' : '';
      report.push(`  ${lineSize}: Actual=${actualDisplay}, denom=${denom ?? 'N/A'}, numerator=${numerator ?? 'N/A'} ${reason}`);
    }

    report.push('\n=== H1 2026 New Customers\' Adoption Rate (new_customer) ===');
    const newCustomerRows = page.locator('tr[data-driver="new_customer"]');
    const ncCount = await newCustomerRows.count();
    for (let i = 0; i < ncCount; i++) {
      const row = newCustomerRows.nth(i);
      const lineSize = await row.getAttribute('data-line-size');
      const denom = await row.getAttribute('data-denominator');
      const numerator = await row.getAttribute('data-numerator');
      const actualPct = await row.getAttribute('data-actual-pct');
      const actualDisplay = actualPct ? `${actualPct}%` : '—';
      const reason = denom === '0' ? '(denom=0, no H1 2026 new customers in cohort)' : '';
      report.push(`  ${lineSize}: Actual=${actualDisplay}, denom=${denom ?? 'N/A'}, numerator=${numerator ?? 'N/A'} ${reason}`);
    }

    report.push('\n=== Data quality (excluded counts) ===');
    const dataQualityText = page.locator('text=/Data quality:.*excluded/');
    if ((await dataQualityText.count()) > 0) {
      const text = await dataQualityText.first().textContent();
      report.push(`  ${text?.trim() ?? 'N/A'}`);
    } else {
      report.push('  (not visible)');
    }

    console.log('\n' + '='.repeat(60));
    console.log('GOAL PROGRESS: H2 2025 + H1 2026 SECTIONS REPORT');
    console.log('='.repeat(60));
    report.forEach((line) => console.log(line));
    console.log('='.repeat(60));
  });

  test('Summary: AI generate + chat', async ({
    page,
  }) => {
    const report: string[] = [];
    test.setTimeout(180000);

    // 1. Upload - Load from Snowflake (Auto) if needed to ensure data exists
    report.push('=== Step 1: Ensure data exists ===');
    await page.goto(`${BASE_URL}/upload`, { waitUntil: 'load', timeout: 15000 });
    const loadBtn = page.getByRole('button', { name: /load from snowflake/i });
    if (await loadBtn.isEnabled()) {
      const monthSelect = page.locator('select').filter({
        has: page.locator('option[value="auto"]'),
      });
      await monthSelect.selectOption('auto');
      await loadBtn.click();
      report.push('Loading from Snowflake (Auto)...');
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('button');
          return btn && !btn.textContent?.includes('Loading');
        },
        { timeout: 180000 }
      );
      report.push('Load completed.');
    } else {
      report.push('Load button disabled; assuming data exists.');
    }

    // 2. Summary page
    report.push('\n=== Step 2: Summary page ===');
    await page.goto(`${BASE_URL}/summary`, { waitUntil: 'load', timeout: 15000 });

    const generateBtn = page.getByRole('button', { name: /generate summary|regenerate summary/i });
    const hasGenerateBtn = (await generateBtn.count()) > 0;
    report.push(`Generate/Regenerate button present: ${hasGenerateBtn}`);

    if (!hasGenerateBtn) {
      report.push('No Generate button - may need data. Skipping.');
      console.log('\n' + '='.repeat(60));
      console.log('AI SUMMARY REPORT');
      console.log('='.repeat(60));
      report.forEach((line) => console.log(line));
      console.log('='.repeat(60));
      return;
    }

    // 3. Click Generate summary
    report.push('\n=== Step 3: Generate AI summary ===');
    await generateBtn.click();
    report.push('Clicked Generate/Regenerate summary. Waiting for completion...');

    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button');
        return btn && !btn.textContent?.includes('Generating');
      },
      { timeout: 90000 }
    );
    report.push('Generation completed.');

    // 4. Check result: markdown or error
    const errorEl = page.locator('text=/Error:|Failed|error/i').first();
    const errorBox = page.locator('[style*="background: var(--bg-alert)"]');
    const hasError = (await errorBox.count()) > 0 || (await errorEl.count()) > 0;
    const markdownContent = page.locator('[style*="markdown"], .markdown, [data-testid="summary-content"]').first();
    const summarySection = page.locator('div').filter({ has: page.locator('h1, h2, h3') }).first();
    const bodyText = await page.locator('body').textContent() ?? '';

    if (hasError) {
      const errorMsg = await errorBox.textContent().catch(() => '') || await errorEl.textContent().catch(() => '');
      report.push(`Result: ERROR`);
      report.push(`Error message: ${errorMsg?.trim().slice(0, 200) ?? 'N/A'}`);
      const showDetailsBtn = page.locator('button:has-text("Show details")');
      if ((await showDetailsBtn.count()) > 0) {
        await showDetailsBtn.click();
        const detailsText = await page.locator('pre').first().textContent().catch(() => '');
        report.push(`Error details: ${detailsText?.slice(0, 300) ?? 'N/A'}`);
      }
    } else {
      const hasMarkdown = bodyText.includes('##') || bodyText.includes('###') || bodyText.length > 500;
      report.push(`Result: ${hasMarkdown ? 'MARKDOWN (summary content present)' : 'Unknown'}`);
      report.push(`Content length: ${bodyText.length} chars`);
    }

    // 5. Chat UI - try sending a short message
    report.push('\n=== Step 4: Chat UI ===');
    const askQuestionsBtn = page.getByRole('button', { name: /ask questions/i });
    const hasChatBtn = (await askQuestionsBtn.count()) > 0;
    report.push(`Ask Questions button present: ${hasChatBtn}`);

    if (hasChatBtn) {
      await askQuestionsBtn.click();
      const chatInput = page.getByPlaceholder(/ask a question about the summary/i);
      await chatInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await chatInput.fill('What is the overall APAP?');
      const submitBtn = page.locator('form').locator('button[type="submit"]');
      if ((await submitBtn.count()) > 0 && (await submitBtn.isEnabled())) {
        await submitBtn.click();
        report.push('Sent chat message: "What is the overall APAP?"');
        try {
          await expect(page.locator('div').filter({ hasText: /Error:|APAP|%/ }).last()).toBeVisible({ timeout: 25000 });
        } catch {
          report.push('(Waited for chat response; may still be loading)');
        }
        const allText = await page.locator('body').textContent() ?? '';
        const hasErrorInChat = allText.includes('Error:');
        const hasApapInResponse = allText.includes('APAP') || allText.includes('%');
        report.push(`Chat result: ${hasErrorInChat ? 'Error in response' : hasApapInResponse ? 'Response received (contains APAP or %)' : 'Unknown'}`);
      } else {
        report.push('Chat submit disabled or not found.');
      }
    } else {
      report.push('Chat UI not found.');
    }

    console.log('\n' + '='.repeat(60));
    console.log('AI SUMMARY REPORT');
    console.log('='.repeat(60));
    report.forEach((line) => console.log(line));
    console.log('='.repeat(60));
  });

  test('Summary: hard refresh, confirm Generate button visible', async ({
    page,
  }) => {
    const report: string[] = [];

    report.push('=== Step 1: Navigate to Summary ===');
    await page.goto(`${BASE_URL}/summary`, { waitUntil: 'load', timeout: 15000 });
    report.push('Loaded /summary');

    report.push('\n=== Step 2: Hard refresh (cache-bypass) ===');
    await page.keyboard.press('Meta+Shift+r');
    await page.waitForLoadState('load');
    report.push('Hard refresh performed (Cmd+Shift+R)');

    report.push('\n=== Step 3: Confirm page and Generate button ===');
    const generateBtn = page.getByRole('button', { name: /generate summary|regenerate summary/i });
    const isVisible = await generateBtn.isVisible();
    report.push(`Generate Summary button visible: ${isVisible ? 'yes' : 'no'}`);

    if (!isVisible) {
      report.push('Button not visible - trying new tab simulation (re-navigate)...');
      await page.goto(`${BASE_URL}/summary`, { waitUntil: 'load', timeout: 15000 });
      const visibleRetry = await generateBtn.isVisible();
      report.push(`After re-navigate, button visible: ${visibleRetry ? 'yes' : 'no'}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY HARD REFRESH REPORT');
    console.log('='.repeat(60));
    report.forEach((line) => console.log(line));
    console.log('='.repeat(60));
  });
});
