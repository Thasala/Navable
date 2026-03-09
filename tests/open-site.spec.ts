import { test, expect } from '@playwright/test';

test('openSiteInBrowser resolves a single token to a .com URL', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const res = await page.evaluate(async () => {
    // @ts-ignore - background.js defines this in the test context
    return await (window as any).openSiteInBrowser('facebook', true);
  });

  expect(res.ok).toBe(true);
  expect(res.url).toContain('https://www.facebook.com');

  const created = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).chrome?.tabs?._created || [];
  });
  expect(created).toContain(res.url);
});

test('resolveOpenQueryToUrl supports spoken dot/slash, multilingual site aliases, and direct-open preference', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const urls = await page.evaluate(() => {
    // @ts-ignore
    return {
      login: (window as any).resolveOpenQueryToUrl('example dot com slash login'),
      arabicYoutube: (window as any).resolveOpenQueryToUrl('يوتيوب'),
      knownAlias: (window as any).resolveOpenQueryToUrl('stack overflow'),
      guessedHost: (window as any).resolveOpenQueryToUrl('new york times'),
      genericHost: (window as any).resolveOpenQueryToUrl('weather tomorrow')
    };
  });

  expect(urls.login).toBe('https://example.com/login');
  expect(urls.arabicYoutube).toBe('https://www.youtube.com/');
  expect(urls.knownAlias).toBe('https://stackoverflow.com/');
  expect(urls.guessedHost).toBe('https://www.newyorktimes.com/');
  expect(urls.genericHost).toBe('https://www.weathertomorrow.com/');
});
