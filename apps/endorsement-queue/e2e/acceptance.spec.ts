import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

const ALEX = 'demo-reviewer-alex'; // reviewer who also owns Procurement Spend
const JORDAN = 'demo-reviewer-jordan';
const SAM = 'demo-owner-sam';

async function openRequest(page: Page, listPath: string, persona: string, model: string) {
  await openApp(page, listPath, persona);
  await page.getByRole('link', { name: model, exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: model })).toBeVisible();
}

test('AC2: a reviewer who owns the request cannot claim it; another reviewer can', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/queue', ALEX);
  const row = page.getByTestId('queue-row').filter({ hasText: 'Procurement Spend' });
  await expect(row.getByText('Your request')).toBeVisible();
  await expect(row.getByRole('button', { name: /Claim/ })).toHaveCount(0);

  await row.getByRole('link', { name: 'Procurement Spend' }).click();
  await expect(page.getByTestId('claim-blocked')).toHaveText(/You own this request/);
  await expect(page.getByRole('button', { name: 'Claim for review' })).toBeDisabled();

  await openRequest(page, '/queue', JORDAN, 'Procurement Spend');
  await page.getByRole('button', { name: 'Claim for review' }).click();
  await expect(page.getByTestId('status-chip')).toHaveText(/In review/);
  await expect(page.getByTestId('review-progress')).toHaveText('0 of 10 reviewed');
  consoleWatch.assertClean();
});

test('AC3 + AC4: approving a certified model sets a 12-month expiry, shows the badge reminder, and the trail lists every step', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openRequest(page, '/queue', ALEX, 'Field Service Operations');
  await expect(page.getByTestId('review-progress')).toHaveText('4 of 10 reviewed');
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();

  for (const key of ['rls', 'measures', 'lineage', 'label', 'cleanup']) {
    await page.getByTestId(`item-${key}`).getByRole('radio', { name: 'Pass' }).check();
  }
  // Tests: N/A is allowed for this item, but only with evidence.
  await page.getByTestId('item-tests').getByRole('radio', { name: 'N/A' }).check();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(page.getByTestId('decision-panel')).toContainText('N/A needs evidence text for: Test suite passing');
  await page.getByTestId('item-tests').getByLabel(/Evidence for Test suite passing/).fill('Simple counts only; covered by row-count checks.');
  await expect(page.getByTestId('review-progress')).toHaveText('10 of 10 reviewed');

  await page.getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('badge-reminder')).toContainText('Settings → Endorsement');
  // Twelve months from today, formatted in the browser's own locale.
  const expected = await page.evaluate(() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
  });
  await expect(dialog.getByTestId('approve-expiry')).toHaveText(expected);
  await dialog.getByLabel('Decision note').fill('All items pass; tests N/A with evidence.');
  await dialog.getByRole('button', { name: 'Approve' }).click();

  await expect(page.getByTestId('status-chip')).toHaveText(/Approved/);
  await expect(page.getByTestId('badge-reminder')).toBeVisible();
  await expect(page.getByTestId('expiry-chip')).toHaveAttribute('data-kind', 'valid');
  await expect(page.getByTestId('trail-event')).toHaveText([/Submitted.*Priya Nair/, /Claimed for review.*Alex Rivera/, /Approved.*Alex Rivera/]);

  // The register lists the new approval and the seeded renewal-due and expired models with the right chips.
  await openApp(page, '/register', ALEX);
  const chip = (model: string) => page.locator(`[data-testid="register-row"][data-model="${model}"]`).getByTestId('expiry-chip');
  await expect(chip('Field Service Operations')).toHaveAttribute('data-kind', 'valid');
  await expect(chip('Sales Performance')).toHaveAttribute('data-kind', 'due');
  await expect(chip('Sales Performance')).toHaveText(/Renewal due · 10 d left/);
  await expect(chip('Finance General Ledger')).toHaveAttribute('data-kind', 'expired');
  await expect(chip('Finance General Ledger')).toHaveText(/Expired 5 d ago/);
  await expect(chip('HR Headcount')).toHaveText(/No expiry/);
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('changes requested: the owner sees failing items, resubmits, and it returns to the same reviewer', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openRequest(page, '/mine', SAM, 'Product Usage');
  const panel = page.getByTestId('resubmit-panel');
  await expect(panel).toContainText('Changes requested by Jordan Lee');
  await expect(panel.getByTestId('item-measures')).toContainText('Needs work');
  await expect(panel.getByTestId('item-tests')).toContainText('Needs work');
  await panel.getByTestId('item-measures').getByLabel(/Evidence for Measures documented/).fill('All 14 measures now have descriptions.');
  await panel.getByTestId('item-tests').getByLabel(/Evidence for Test suite passing/).fill('Suite re-run today: all passed.');
  await panel.getByLabel('What changed').fill('Described the 14 measures and re-ran the test suite.');
  await panel.getByRole('button', { name: 'Resubmit for review' }).click();

  await expect(page.getByTestId('status-chip')).toHaveText(/In review/);
  await expect(page.getByText('In review with Jordan Lee.')).toBeVisible();
  await expect(page.getByTestId('trail-event').last()).toContainText('Resubmitted');

  // The reviewer only has the two cleared items left.
  await openRequest(page, '/queue', JORDAN, 'Product Usage');
  await expect(page.getByTestId('review-progress')).toHaveText('8 of 10 reviewed');
  consoleWatch.assertClean();
});

test('a duplicate open request for the same model and workspace is blocked with a link to the open one', async ({ page }) => {
  await openApp(page, '/submit', SAM);
  await page.getByLabel('Model name').fill('web analytics');
  await page.getByLabel('Workspace').fill('Digital');
  await page.getByRole('radio', { name: /Promoted/ }).check();
  await page.getByLabel('Justification').fill('Trying to submit the same model twice.');
  await page.getByRole('button', { name: /Mark 4 unanswered as Pass/ }).click();
  await page.getByRole('button', { name: 'Submit request' }).click();
  const failure = page.getByTestId('submit-failure');
  await expect(failure).toContainText('already has an open request');
  await failure.getByRole('link', { name: 'Open the existing request' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Web Analytics' })).toBeVisible();
});

test('renewals: the first admin visit records renewal_due once, and Start renewal prefills a new request', async ({ page }) => {
  await openApp(page, '/renewals', ALEX);
  await expect(page.getByTestId('renewal-events-written')).toContainText('2 models');
  await expect(page.getByTestId('renewal-row')).toHaveCount(3);

  await page.reload();
  await expect(page.getByTestId('renewal-row')).toHaveCount(3);
  await expect(page.getByTestId('renewal-events-written')).toHaveCount(0);

  const sales = page.locator('[data-testid="renewal-row"][data-model="Sales Performance"]');
  await sales.getByRole('link', { name: 'Sales Performance' }).click();
  await expect(page.getByTestId('trail-event').last()).toContainText('Renewal due');
  await page.goBack();

  await page.locator('[data-testid="renewal-row"][data-model="Sales Performance"]').getByTestId('start-renewal').click();
  await expect(page.getByRole('heading', { name: 'Renew Sales Performance' })).toBeVisible();
  await expect(page.getByLabel('Model name')).toHaveValue('Sales Performance');
  await expect(page.getByLabel('Workspace')).toHaveValue('Sales Analytics');
  await expect(page.getByRole('radio', { name: /Certified/ })).toBeChecked();
});

test('model owners do not see the assay desk', async ({ page }) => {
  await openApp(page, '/queue', SAM);
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Assay desk' })).toHaveCount(0);
});
