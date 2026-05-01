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

test('requestAssistant treats polite open-site phrasing as an action', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const res = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    // The direct routing should handle this before the backend assistant is called.
    // @ts-ignore
    window.fetch = async () => { throw new Error('backend assistant should not be called'); };
    try {
      // @ts-ignore - background.js defines this in the test context
      return await (window as any).requestAssistant('can you please open facebook for me', 'en');
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(res.ok).toBe(true);
  expect(res.mode).toBe('action');
  expect(res.action?.type).toBe('open_site');
  expect(res.url).toContain('https://www.facebook.com');

  const created = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).chrome?.tabs?._created || [];
  });
  expect(created).toContain(res.url);
});

test('requestAssistant executes assistant-returned open-site actions instead of speaking a denial', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const res = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    // @ts-ignore
    window.fetch = async () => ({
      ok: true,
      json: async () => ({
        mode: 'action',
        speech: '',
        summary: '',
        answer: '',
        suggestions: [],
        plan: { steps: [] },
        action: { type: 'open_site', query: 'facebook', newTab: true }
      })
    });
    try {
      // @ts-ignore - background.js defines this in the test context
      return await (window as any).requestAssistant('خذني على فيسبوك', 'ar');
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(res.ok).toBe(true);
  expect(res.mode).toBe('action');
  expect(res.action?.type).toBe('open_site');
  expect(res.url).toContain('https://www.facebook.com');

  const created = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).chrome?.tabs?._created || [];
  });
  expect(created).toContain(res.url);
});
