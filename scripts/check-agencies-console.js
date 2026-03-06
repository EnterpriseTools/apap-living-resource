/**
 * Paste this into the browser console while on http://localhost:3000/actions or /action-list
 * to check for agencies. Run once on each page.
 *
 * Usage:
 * 1. Open http://localhost:3000/actions (or /action-list)
 * 2. Open DevTools (F12 or Cmd+Option+I) → Console
 * 3. Paste this script and press Enter
 */
(function () {
  const SEARCH_TERMS = [
    'Maryland State Police',
    'Pittsburg Bureau of Police',
    'Pittsburgh Bureau of Police',
    'Pittsburg Bureau of Police -BA',
  ];

  const isActions = window.location.pathname === '/actions';
  const isActionList = window.location.pathname === '/action-list';

  if (!isActions && !isActionList) {
    console.log('Run this on /actions or /action-list');
    return;
  }

  // Get data from the page - we need to access React state or DOM
  const tables = document.querySelectorAll('table tbody');
  const allRows = Array.from(document.querySelectorAll('table tbody tr'));
  const noMatch = document.body.textContent.includes('No agencies match the current filters');
  const noData = document.body.textContent.includes('No data available');

  console.log('=== Filter defaults ===');
  if (isActions) {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    const checked = Array.from(checkboxes).filter((c) => c.checked);
    console.log('Line size filters checked by default:', checked.length, '(0 = no filters, all shown)');
  }
  if (isActionList) {
    const select = document.querySelector('select');
    console.log('Label filter default:', select?.value || 'all');
    console.log('Line size filter: not present on this page');
  }

  console.log('=== Has data:', !noData, '===');
  if (noData) {
    console.log('No data - upload files first.');
    return;
  }

  console.log('=== Search results (use page search box to verify) ===');
  for (const term of SEARCH_TERMS) {
    const matchingRows = allRows.filter((r) => r.textContent.toLowerCase().includes(term.toLowerCase()));
    const found = matchingRows.length > 0 && !noMatch;

    let section = '';
    let label = '';
    let churnType = '';
    let monthChurned = '';

    if (matchingRows.length > 0) {
      const row = matchingRows[0];
      const text = row.textContent;
      if (isActions) {
        if (text.includes('2025 churned')) {
          section = 'Agencies Churned';
          churnType = '2025 churned';
        } else if (text.includes('2026 churned')) {
          section = 'Agencies Churned';
          churnType = '2026 churned';
        } else if (text.includes('At Risk')) {
          section = 'At Risk';
        } else if (text.includes('Close to')) {
          section = 'Close to Adopting';
        }
        const m = text.match(/(20\d{2}-\d{2})/);
        monthChurned = m ? m[1] : '';
      }
      if (isActionList) {
        const labelMatch = text.match(/(?:Adopting|At Risk \(Next (?:Month|Quarter)\)|Churned Out|Not Adopting|Top Performer|Ineligible[^)]*)/);
        label = labelMatch ? labelMatch[0] : '';
      }
    }

    console.log(
      `"${term}":`,
      'found=' + (matchingRows.length > 0),
      isActions ? `section=${section || 'N/A'}, churnType=${churnType || 'N/A'}, monthChurned=${monthChurned || 'N/A'}` : `label=${label || 'N/A'}`
    );
  }
})();
