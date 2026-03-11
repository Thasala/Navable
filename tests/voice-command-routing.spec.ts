import { test, expect } from '@playwright/test';

test('content script executes VOICE_COMMAND messages on the page', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-ignore
    (window as any).chrome = {
      runtime: {
        _listeners: [] as any[],
        onMessage: {
          addListener(fn: any) {
            // @ts-ignore
            (window as any).chrome.runtime._listeners.push(fn);
          }
        },
        sendMessage() {
          return Promise.resolve({ ok: true });
        }
      },
      storage: {
        sync: {
          get(defaults: any, cb: (res: any) => void) {
            cb(defaults);
          }
        },
        onChanged: {
          addListener(_fn: any) {
            // no-op for tests
          }
        }
      }
    };
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <main style="height: 3000px">
      <h1>Page Title</h1>
      <p>Scrollable content for voice command execution.</p>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  const initialScroll = await page.evaluate(() => window.scrollY);

  await page.evaluate(() => {
    return new Promise((resolve) => {
      // @ts-ignore
      const listeners = (window as any).chrome.runtime._listeners || [];
      for (const fn of listeners) {
        try {
          fn({ type: 'VOICE_COMMAND', text: 'scroll down' }, {}, () => resolve(null));
        } catch {
          // ignore listener errors in tests
        }
      }
      setTimeout(() => resolve(null), 0);
    });
  });

  await page.waitForFunction(() => window.scrollY > 0);
  const afterScroll = await page.evaluate(() => window.scrollY);
  expect(afterScroll).toBeGreaterThan(initialScroll);
});

test('background forwards recognized transcripts as VOICE_COMMAND messages', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-ignore
    (window as any).__sentMessage = null;
    // @ts-ignore
    (window as any).chrome = {
      commands: {
        onCommand: {
          addListener(_fn: any) {
            // no-op for tests
          }
        }
      },
      tabs: {
        onCreated: { addListener() {} },
        onUpdated: { addListener() {} },
        onActivated: { addListener() {} },
        query() {
          return Promise.resolve([{ id: 7, url: 'https://example.com' }]);
        },
        sendMessage(tabId: number, payload: any) {
          // @ts-ignore
          (window as any).__sentMessage = { tabId, payload };
          return Promise.resolve({ ok: true });
        },
        create(createProperties: any) {
          return Promise.resolve({ id: 8, url: createProperties?.url || 'about:blank' });
        },
        update(tabId: number, updateProperties: any) {
          return Promise.resolve({ id: tabId || 7, url: updateProperties?.url || 'https://example.com' });
        }
      },
      runtime: {
        _listeners: [] as any[],
        getURL(path?: string) {
          const p = String(path || '').replace(/^\/+/, '');
          return 'chrome-extension://test-extension/' + p;
        },
        onMessage: {
          addListener(fn: any) {
            // @ts-ignore
            (window as any).chrome.runtime._listeners.push(fn);
          }
        },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        sendMessage() {
          return Promise.resolve({ ok: true });
        }
      },
      storage: {
        local: {
          get(defaults: any, cb: (res: any) => void) {
            cb(defaults);
          },
          set(_values: any, cb?: () => void) {
            if (typeof cb === 'function') cb();
          }
        },
        sync: {
          get(defaults: any, cb: (res: any) => void) {
            cb(defaults);
          }
        },
        onChanged: {
          addListener(_fn: any) {
            // no-op for tests
          }
        }
      }
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).dispatchVoiceTranscript('search Jordan the country');
  });

  const sentMessage = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).__sentMessage;
  });

  expect(sentMessage).toEqual({
    tabId: 7,
    payload: {
      type: 'VOICE_COMMAND',
      text: 'search Jordan the country'
    }
  });
});
