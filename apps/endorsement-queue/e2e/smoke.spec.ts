import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

test('loads, creates a record, sees it listed, no console errors', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/mine');
  await expect(page.getByRole('heading', { name: 'My requests' })).toBeVisible();
  await assertNoHorizontalScroll(page);

  await openApp(page, '/submit');
  await page.getByLabel('Model name').fill('Smoke Test Model');
  await page.getByLabel('Workspace').fill('Smoke Workspace');
  await page.getByRole('radio', { name: /Promoted/ }).check();
  await page.getByLabel('Justification').fill('Used by the smoke test to prove the submit flow works.');
  await page.getByRole('button', { name: /Mark 4 unanswered as Pass/ }).click();
  await page.getByRole('button', { name: 'Submit request' }).click();

  await expect(page.getByRole('heading', { name: 'Smoke Test Model' })).toBeVisible();
  await expect(page.getByTestId('status-chip')).toHaveText(/Submitted/);
  await page.goto('/#/mine');
  await expect(page.getByTestId('my-requests').getByRole('link', { name: 'Smoke Test Model' })).toBeVisible();
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});
