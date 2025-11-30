import { test, expect } from '@playwright/test';

test('speaks Navable ready on activation', async ({ page }) => {
  await page.setContent('<main><h1>Ready</h1><button id="f">Focus</button></main>');
  await page.click('#f');

  // Inject announcer then content script (which will call announce on load)
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  const polite = page.locator('#navable-live-region-polite');
  await expect(polite).toContainText('Navable is ready', { timeout: 5000 });
});

