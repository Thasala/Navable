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

test('requestAssistant opens unknown named websites with local fallback when AI is disabled', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const res = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    window.fetch = async (url, init) => {
      throw new Error(`Unexpected fetch: ${String(url)} ${String(init?.body || '')}`);
    };

    try {
      // @ts-ignore - background.js defines this in the test context
      return await (window as any).requestAssistant('open jordan uni of science and technology website', 'en');
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(res.ok).toBe(true);
  expect(res.mode).toBe('action');
  expect(res.action?.type).toBe('open_site');
  expect(res.url).toBe('https://www.jordanuniofscienceandtechnology.com/');

  const created = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).chrome?.tabs?._created || [];
  });
  expect(created).toContain('https://www.jordanuniofscienceandtechnology.com/');
});

test('requestAssistant uses AI site resolution for unknown named websites when AI is enabled', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const res = await page.evaluate(async () => {
    await new Promise((resolve) => {
      // @ts-ignore
      window.chrome.storage.sync.set({ navable_settings: { aiEnabled: true } }, resolve);
    });

    const originalFetch = window.fetch;
    const calls: any[] = [];
    // @ts-ignore
    window.__resolverCalls = calls;
    window.fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body || '') });
      if (String(url).endsWith('/api/resolve-site')) {
        return new Response(JSON.stringify({
          url: 'https://www.just.edu.jo/',
          name: 'Jordan University of Science and Technology',
          confidence: 0.92
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`Unexpected fetch: ${String(url)} ${String(init?.body || '')}`);
    };

    try {
      // @ts-ignore - background.js defines this in the test context
      return await (window as any).requestAssistant('open jordan uni of science and technology website', 'en');
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(res.ok).toBe(true);
  expect(res.mode).toBe('action');
  expect(res.action?.type).toBe('open_site');
  expect(res.url).toBe('https://www.just.edu.jo/');

  const state = await page.evaluate(() => {
    // @ts-ignore
    return {
      created: (window as any).chrome?.tabs?._created || [],
      calls: (window as any).__resolverCalls || []
    };
  });
  expect(state.created).toContain('https://www.just.edu.jo/');
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0].url).toContain('/api/resolve-site');
  expect(JSON.parse(state.calls[0].body).query).toBe('jordan uni of science and technology');
});

test('openSiteInBrowser uses Chrome default search for explicit search intent', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const res = await page.evaluate(async () => {
    // @ts-ignore - background.js defines this in the test context
    return await (window as any).openSiteInBrowser('search for accessible maps', false, 'en', { sourceTabId: 1 });
  });

  expect(res.ok).toBe(true);
  expect(res.url).toBe('');

  const queries = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).chrome?.search?._queries || [];
  });
  expect(queries).toContainEqual({ text: 'accessible maps', tabId: 1 });
});

test('requestAssistant treats browser history phrasing as an action', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const res = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    // The direct routing should handle this before the backend assistant is called.
    // @ts-ignore
    window.fetch = async () => { throw new Error('backend assistant should not be called'); };
    try {
      // @ts-ignore - background.js defines this in the test context
      return await (window as any).requestAssistant('can you please go back to the previous page', 'en');
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(res.ok).toBe(true);
  expect(res.mode).toBe('action');
  expect(res.action).toEqual({ type: 'browser_history', direction: 'back' });

  const historyAction = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).chrome?.tabs?._lastHistoryAction || null;
  });
  expect(historyAction).toEqual({ direction: 'back', tabId: 1 });
});

test('requestAssistant treats keyboard shortcut phrasing as an extension action', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const res = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    // @ts-ignore
    window.fetch = async () => { throw new Error('backend assistant should not be called'); };
    try {
      // @ts-ignore - background.js defines this in the test context
      return await (window as any).requestAssistant('open keyboard shortcuts', 'en');
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(res.ok).toBe(true);
  expect(res.mode).toBe('action');
  expect(res.action).toEqual({ type: 'open_shortcuts' });

  const created = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).chrome?.tabs?._created || [];
  });
  expect(created).toContain('chrome://extensions/shortcuts');
});

test('requestAssistant handles Arabic open-site requests locally instead of using backend actions', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const res = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    // @ts-ignore
    window.fetch = async (url) => {
      throw new Error(`Unexpected fetch: ${String(url)}`);
    };
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
