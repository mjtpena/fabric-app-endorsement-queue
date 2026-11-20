/**
 * Redesign screenshots (not a test). Run: SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
 * Writes docs/redesign/<screen>-<theme>-<desktop|phone>.png.
 */
import { test, type Page } from '@playwright/test';

import { openApp } from '@x10/shared/e2e';

const ALEX = 'demo-reviewer-alex';
const SAM = 'demo-owner-sam';

type Shot = { name: string; path: string; persona: string; full?: boolean; act?: (page: Page, phone: boolean) => Promise<void> };

const SHOTS: Shot[] = [
  { name: 'hall-level', path: '/', persona: ALEX },
  {
    name: 'hall-expiry',
    path: '/',
    persona: ALEX,
    act: async (page) => {
      await page.getByRole('radio', { name: /Expiry/ }).click();
    },
  },
  {
    name: 'hall-owner-lens',
    path: '/',
    persona: SAM,
    act: async (page) => {
      await page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /^Owner/ }).click();
    },
  },
  {
    name: 'hall-today-focus',
    path: '/',
    persona: ALEX,
    act: async (page, phone) => {
      if (phone) await page.getByRole('button', { name: /^Today/ }).click();
      await page.getByRole('button', { name: /Sales Performance seal is nearly drained/ }).click();
    },
  },
  {
    name: 'hall-list',
    path: '/',
    persona: ALEX,
    full: true,
    act: async (page) => {
      await page.getByRole('radio', { name: 'List' }).click();
    },
  },
  {
    name: 'assay-desk-review',
    path: '/queue',
    persona: ALEX,
    full: true,
    act: async (page) => {
      await page.getByRole('link', { name: 'Field Service Operations', exact: true }).first().click();
      await page.getByTestId('item-rls').getByRole('radio', { name: 'Pass' }).check();
      await page.getByTestId('item-tests').getByRole('radio', { name: 'N/A' }).check();
    },
  },
  {
    name: 'assay-desk-sealed',
    path: '/register',
    persona: ALEX,
    act: async (page) => {
      await page.getByRole('link', { name: 'Customer 360', exact: true }).click();
    },
  },
  {
    name: 'assay-desk-changes',
    path: '/mine',
    persona: SAM,
    act: async (page) => {
      await page.getByRole('link', { name: 'Product Usage', exact: true }).click();
    },
  },
  { name: 'assay-desk-queue', path: '/queue', persona: ALEX },
  { name: 'seal-register', path: '/register', persona: ALEX },
  { name: 'renewals', path: '/renewals', persona: ALEX },
  { name: 'my-requests', path: '/mine', persona: SAM },
  {
    name: 'submit',
    path: '/submit',
    persona: SAM,
    act: async (page) => {
      await page.getByLabel('Model name').fill('Churn Forecast');
      await page.getByLabel('Workspace').fill('Customer Insights');
      await page.getByRole('radio', { name: /Certified/ }).check();
    },
  },
  { name: 'about', path: '/about', persona: ALEX },
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const s of SHOTS) {
      test(`${s.name} ${scheme}`, async ({ page }, info) => {
        test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to write the redesign screenshots.');
        const phone = info.project.name === 'phone';
        await openApp(page, s.path, s.persona);
        await page.getByTestId('demo-banner').getByRole('button').first().click().catch(() => undefined);
        if (s.act) await s.act(page, phone);
        await page.waitForTimeout(1400);
        await page.screenshot({ path: `docs/redesign/${s.name}-${scheme}-${phone ? 'phone' : 'desktop'}.png`, fullPage: !!s.full && !phone });
      });
    }
  });
}
