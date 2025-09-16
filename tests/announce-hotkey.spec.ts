import { chromium, expect, test } from '@playwright/test';
import path from 'path';

test.setTimeout(60_000);

test('content script announces via fallback hotkey', async () => {
  const extensionPath = path.resolve(process.cwd());

  const isCI = !!process.env.CI;        // headless on CI, headed locally
  const context = await chromium.launchPersistentContext('', {
    headless: isCI,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await context.newPage();
  page.on('console', (msg) => console.log('[page console]', msg.type(), msg.text()));

  await page.goto('https://example.com');
  await page.waitForSelector('#navable-marker[data-injected="true"]', { timeout: 30000, state: "attached" });
  await page.click('body');

  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press(';');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  const text = await page.locator('#navable-live-region-polite').textContent({ timeout: 5000 });
  expect(text).toContain('Navable: test announcement (fallback hotkey).');

  await context.close();
});
