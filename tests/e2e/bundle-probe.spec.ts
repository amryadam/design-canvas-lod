import { test, expect } from '@playwright/test';

test('IIFE bundle mounts inside a local parent iframe', async ({ page }) => {
  await page.goto('/tests/fixtures/workspace/bundle-parent.html');
  const bundle = page.frameLocator('iframe[title="bundle parent probe"]');
  await expect(bundle.getByTestId('probe-screen')).toHaveCount(2);
  await expect(bundle.getByRole('img', { name: /Probe snapshot/ })).toHaveCount(2);
  await expect(bundle.locator('iframe[data-live-screen]')).toHaveCount(0);
});
