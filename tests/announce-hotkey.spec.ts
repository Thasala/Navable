import { chromium, expect, test } from '@playwright/test';
import path from 'path';

test.setTimeout(60_000);

test('content script announces via fallback hotkey', async () => {
  const extensionPath = path.resolve(process.cwd());
  const context = await chromium.launchPersistentContext('', {
    headless: false, // required for extensions
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await context.newPage();

  // Log page console so we can see content-script messages
  page.on('console', (msg) => console.log('[page console]', msg.type(), msg.text()));

  await page.goto('https://example.com');

  // 1) Prove content script injected
  await expect(page.locator('#navable-marker')).toHaveAttribute('data-injected', 'true', { timeout: 10000 });

  // 2) Ensure page focus
  await page.click('body');

  // 3) Trigger Alt+Shift+;
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press(';');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  // 4) Assert announcement
  const text = await page.locator('#navable-live-region-polite').textContent({ timeout: 5000 });
  expect(text).toContain('Navable: test announcement (fallback hotkey).');

  await context.close();
});
