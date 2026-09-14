import { test, expect } from '@playwright/test';

test('host probe boots with snapshots', async ({ page }) => {
  await page.goto('/tests/fixtures/workspace/probe.html');
  await expect(page.getByTestId('probe-screen')).toHaveCount(2);
  await expect(page.getByRole('img', { name: /Probe snapshot/ })).toHaveCount(2);
  await expect(page.locator('iframe[data-live-screen]')).toHaveCount(0);
});

test('Escape returns an activated probe to its snapshot', async ({ page }) => {
  await page.goto('/tests/fixtures/workspace/probe.html');
  await page.getByRole('button', { name: 'Activate' }).first().click();
  await expect(page.locator('iframe[data-live-screen]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe[data-live-screen]')).toHaveCount(0);
});
