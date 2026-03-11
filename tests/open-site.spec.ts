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

test('resolveOpenQueryToUrl supports spoken dot/slash and search fallback', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const urls = await page.evaluate(() => {
    // @ts-ignore
    return {
      login: (window as any).resolveOpenQueryToUrl('example dot com slash login'),
      search: (window as any).resolveOpenQueryToUrl('stack overflow')
    };
  });

  expect(urls.login).toBe('https://example.com/login');
  expect(urls.search).toContain('https://www.google.com/search?q=');
});

test('resolveOpenQueryToUrl supports site-specific search commands', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const urls = await page.evaluate(() => {
    // @ts-ignore
    return {
      youtube: (window as any).resolveOpenQueryToUrl('search despacito on youtube'),
      facebook: (window as any).resolveOpenQueryToUrl('search Messi on facebook'),
      amazon: (window as any).resolveOpenQueryToUrl('search laptops on amazon'),
      google: (window as any).resolveOpenQueryToUrl('search weather in Amman on google')
    };
  });

  expect(urls.youtube).toBe('https://www.youtube.com/results?search_query=despacito');
  expect(urls.facebook).toBe('https://www.facebook.com/search/top?q=Messi');
  expect(urls.amazon).toBe('https://www.amazon.com/s?k=laptops');
  expect(urls.google).toBe('https://www.google.com/search?q=weather%20in%20Amman');
});

test('resolveOpenQueryToUrl uses supported current site for generic search commands', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const urls = await page.evaluate(() => {
    // @ts-ignore
    return {
      youtube: (window as any).resolveOpenQueryToUrl('search despacito', 'www.youtube.com'),
      amazon: (window as any).resolveOpenQueryToUrl('search laptops', 'amazon.com'),
      facebook: (window as any).resolveOpenQueryToUrl('search Messi', 'm.facebook.com'),
      google: (window as any).resolveOpenQueryToUrl('search weather in Amman', 'google.com'),
      fallback: (window as any).resolveOpenQueryToUrl('search navable', 'example.com')
    };
  });

  expect(urls.youtube).toBe('https://www.youtube.com/results?search_query=despacito');
  expect(urls.amazon).toBe('https://www.amazon.com/s?k=laptops');
  expect(urls.facebook).toBe('https://www.facebook.com/search/top?q=Messi');
  expect(urls.google).toBe('https://www.google.com/search?q=weather%20in%20Amman');
  expect(urls.fallback).toBe('https://www.google.com/search?q=navable');
});

