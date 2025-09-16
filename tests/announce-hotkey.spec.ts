import { chromium, expect, test } from '@playwright/test';
import path from 'path';

test.setTimeout(60_000);

test('content script announces via fallback hotkey', async () => {
  const extensionPath = path.resolve(process.cwd());

  // run headless in CI, headed locally
  const headless = !!process.env.CI;

  const context = await chromium.launchPersistentContext('', {
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await context.newPage();

  page.on('console', (msg) =>
    console.log('[page console]', msg.type(), msg.text())
  );

  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

  // Wait for our marker (meta is hidden, so use waitForFunction)
  await page.waitForFunction(() => {
    return !!document.querySelector('#navable-marker[data-injected="true"]');
  }, null, { timeout: 30_000 });

  await page.click('body');

  // Trigger Alt+Shift+;
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press(';');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  // Wait for live region update
  await page.waitForFunction(() => {
    const r = document.getElementById('navable-live-region-polite');
    return !!r && (r.textContent || '').includes('Navable: test announcement (fallback hotkey).');
  }, null, { timeout: 5_000 });

  const text = await page.locator('#navable-live-region-polite').textContent();
  expect(text).toContain('Navable: test announcement (fallback hotkey).');

  await context.close();
});
