import { test, expect } from '@playwright/test';

test('announce.js updates polite/assertive live regions', async ({ page }) => {
  await page.setContent('<main><h1>Test</h1><button id="b">Focus</button></main>');
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.click('#b');

  await page.evaluate(() => {
    // @ts-ignore
    window.NavableAnnounce.speak('Hello from Navable.', { mode: 'polite' });
    // @ts-ignore
    window.NavableAnnounce.speak('Important message.', { mode: 'assertive' });
  });

  await expect(page.locator('#navable-live-region-polite')).toHaveText('Hello from Navable.');
  await expect(page.locator('#navable-live-region-assertive')).toHaveText('Important message.');

  const role = await page.getAttribute('#navable-live-region-assertive', 'role');
  expect(role).toBe('alert');
});

