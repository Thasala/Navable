import { chromium, expect, test } from '@playwright/test';
import path from 'path';

test.setTimeout(60_000);

test('content script announces via fallback hotkey', async () => {
  const extensionPath = path.resolve(process.cwd());
  const headless = !!process.env.CI;

  const context = await chromium.launchPersistentContext('', {
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await context.newPage();
  page.on('console', (m) => console.log('[page console]', m.type(), m.text()));

  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

  // meta is hidden; just wait until it exists
  await page.waitForFunction(
    () => !!document.querySelector('#navable-marker[data-injected="true"]'),
    null,
    { timeout: 30_000 }
  );

  await page.click('body');

  // Alt+Shift+;
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press(';');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  // live region text appears
  await page.waitForFunction(() => {
    const r = document.getElementById('navable-live-region-polite');
    return !!r && (r.textContent || '').includes('Navable: test announcement (fallback hotkey).');
  }, null, { timeout: 5_000 });

  const text = await page.locator('#navable-live-region-polite').textContent();
  expect(text).toContain('Navable: test announcement (fallback hotkey).');

  await context.close();
});
