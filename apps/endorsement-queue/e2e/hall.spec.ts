import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

const ALEX = 'demo-reviewer-alex';
const SAM = 'demo-owner-sam';

/** Today lives in the side panel on desktop and behind a "Today" button (bottom sheet) on phones. */
async function openToday(page: Page) {
  const panel = page.getByRole('complementary', { name: 'Today' });
  if (await panel.isVisible()) return panel;
  await page.getByRole('button', { name: /^Today/ }).click();
  return page.getByRole('dialog');
}

test('the hall renders every seal and blank, with a lens switch', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/', ALEX);
  await expect(page.getByRole('heading', { level: 1, name: 'The hall of seals' })).toBeVisible();
  await expect(page.getByTestId('hall-seal')).toHaveCount(6);
  await expect(page.getByTestId('hall-blank')).toHaveCount(7);
  const svg = page.getByTestId('hall').locator('svg').first();
  await expect(svg).toHaveAttribute('data-lens', 'level');
  await page.getByRole('radio', { name: /Expiry/ }).click();
  await expect(svg).toHaveAttribute('data-lens', 'expiry');
  await page.keyboard.press('3');
  await expect(svg).toHaveAttribute('data-lens', 'owner');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('a Today item focuses its seal and switches to its lens', async ({ page }) => {
  await openApp(page, '/', ALEX);
  const today = await openToday(page);
  await today.getByRole('button', { name: /Sales Performance seal is nearly drained/ }).click();
  await expect(page.locator('[data-testid="hall-seal"][data-model="Sales Performance"]')).toHaveAttribute('data-focused', 'true');
  await expect(page.getByRole('heading', { level: 1, name: 'Sales Performance' })).toBeVisible();
  await expect(page.getByTestId('hall').locator('svg').first()).toHaveAttribute('data-lens', 'expiry');
  await page.getByTestId('focus-open').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sales Performance' })).toBeVisible();
  await expect(page.getByTestId('expiry-chip')).toHaveAttribute('data-kind', 'due');
});

test('view as owner ranks the owner’s own work', async ({ page }) => {
  await openApp(page, '/', SAM);
  await page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: 'Owner', exact: true }).click();
  const today = await openToday(page);
  await expect(today.getByRole('button', { name: /Product Usage came back with changes/ })).toBeVisible();
});

test('the list view shows the same seals and blanks', async ({ page }) => {
  await openApp(page, '/', ALEX);
  await page.getByRole('radio', { name: 'List' }).click();
  await expect(page.getByTestId('hall-list-row')).toHaveCount(13);
  await expect(page.locator('[data-testid="hall-list-row"][data-model="Finance General Ledger"]')).toContainText('Sealed');
  await assertNoHorizontalScroll(page);
});

test('without WebGL the hall still renders (it is SVG)', async ({ page }) => {
  await page.goto(`/?nowebgl&as=${ALEX}#/`);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByTestId('hall-seal')).toHaveCount(6);
});

test('approving a request strikes its seal and the hall shows it', async ({ page }) => {
  await openApp(page, '/queue', ALEX);
  await page.getByRole('link', { name: 'Field Service Operations', exact: true }).first().click();
  for (const key of ['rls', 'measures', 'tests', 'lineage', 'label', 'cleanup']) {
    await page.getByTestId(`item-${key}`).getByRole('radio', { name: 'Pass' }).check();
  }
  await page.getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Decision note').fill('All items pass.');
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('wax-stamp')).toBeVisible();
  await expect(page.getByTestId('badge-reminder')).toContainText('Settings → Endorsement');
  await page.getByTestId('see-in-hall').click();
  await expect(page.getByTestId('hall-seal')).toHaveCount(7);
  await expect(page.locator('[data-testid="hall-seal"][data-model="Field Service Operations"]')).toHaveAttribute('data-focused', 'true');
});
