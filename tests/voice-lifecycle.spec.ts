import { expect, test } from '@playwright/test';

test('spoken summary output stays visible through the shared live region', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Docs</h1>
      <p>Welcome to the docs.</p>
      <h2>Getting Started</h2>
    </main>
  `);

  await page.evaluate(() => {
    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      if (body.input !== 'Summarize this page') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
      }

      return {
        ok: true,
        async json() {
          return {
            mode: 'page',
            speech: 'This page is documentation with a Getting Started section.',
            summary: 'This page is documentation with a Getting Started section.',
            answer: '',
            suggestions: ['Try: read the title.'],
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    window.chrome.storage.sync.get = (_defaults: unknown, cb: (res: unknown) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: true
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('Summarize this page', 'en', 'offscreen');
  });

  await expect(page.locator('#navable-output-text')).toHaveValue(/documentation/i);
});

test('content voice toggle delegates microphone control to the background worker', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Voice</h1>
      <p>Toggle routing test.</p>
    </main>
  `);

  await page.evaluate(() => {
    const messages: Array<any> = [];
    const chromeMock = {
      runtime: {
        _listeners: [] as any[],
        onMessage: {
          addListener(fn: any) {
            chromeMock.runtime._listeners.push(fn);
          }
        },
        sendMessage(payload: any) {
          messages.push(payload);
          return Promise.resolve({ ok: true });
        }
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US', overlay: false, autostart: true } });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    };

    // @ts-ignore
    window.__messages = messages;
    // @ts-ignore
    window.chrome = chromeMock;
    // @ts-ignore
    // @ts-ignore
    (globalThis as any).chrome = chromeMock;
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('M');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  const messages = await page.evaluate(() => {
    // @ts-ignore
    return window.__messages;
  });

  expect(messages).toContainEqual({ type: 'voice:toggle' });
});

test('background start and stop lifecycle proxies through the offscreen voice owner', async ({ page }) => {
  await page.evaluate(() => {
    const offscreenActions: Array<string> = [];
    const localStore: Record<string, unknown> = {};
    let offscreenCreated = 0;

    const chromeMock = {
      commands: {
        onCommand: {
          addListener() {}
        }
      },
      tabs: {
        onCreated: { addListener() {} },
        onUpdated: { addListener() {} },
        onActivated: { addListener() {} },
        query() {
          return Promise.resolve([{ id: 7, url: 'https://example.com' }]);
        },
        create(createProperties: any) {
          return Promise.resolve({ id: 8, url: createProperties?.url || 'about:blank' });
        },
        update(tabId: number, updateProperties: any) {
          return Promise.resolve({ id: tabId || 7, url: updateProperties?.url || 'https://example.com' });
        },
        sendMessage() {
          return Promise.resolve({ ok: true });
        }
      },
      offscreen: {
        createDocument() {
          offscreenCreated += 1;
          return Promise.resolve();
        }
      },
      runtime: {
        _listeners: [] as any[],
        getURL(path?: string) {
          const p = String(path || '').replace(/^\/+/, '');
          return 'chrome-extension://test-extension/' + p;
        },
        getContexts() {
          return Promise.resolve(offscreenCreated > 0 ? [{}] : []);
        },
        onMessage: {
          addListener(fn: any) {
            chromeMock.runtime._listeners.push(fn);
          }
        },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        sendMessage(payload: any) {
          if (payload?.type === 'voice:offscreen') {
            offscreenActions.push(String(payload.action || ''));
            if (payload.action === 'start') {
              return Promise.resolve({
                ok: true,
                status: {
                  supports: true,
                  permissionGranted: true,
                  listening: true,
                  lastError: '',
                  language: payload.payload?.language || 'en-US'
                }
              });
            }
            if (payload.action === 'stop') {
              return Promise.resolve({
                ok: true,
                status: {
                  supports: true,
                  permissionGranted: true,
                  listening: false,
                  lastError: '',
                  language: 'ar-SA'
                }
              });
            }
            if (payload.action === 'requestPermission') {
              return Promise.resolve({
                ok: true,
                status: {
                  supports: true,
                  permissionGranted: true,
                  listening: false,
                  lastError: '',
                  language: 'en-US'
                }
              });
            }
          }
          return Promise.resolve({ ok: true });
        }
      },
      storage: {
        local: {
          get(defaults: any, cb: (res: any) => void) {
            cb({ ...(defaults || {}), ...localStore });
          },
          set(values: any, cb?: () => void) {
            Object.assign(localStore, values || {});
            if (typeof cb === 'function') cb();
          }
        },
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US', autostart: false } });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    };

    // @ts-ignore
    window.__offscreenActions = offscreenActions;
    // @ts-ignore
    window.__offscreenCreated = () => offscreenCreated;
    // @ts-ignore
    window.chrome = chromeMock;
    // @ts-ignore
    // @ts-ignore
    (globalThis as any).chrome = chromeMock;
  });

  await page.addScriptTag({ path: 'src/background.js' });

  const startStatus = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).startVoiceListeningInExtension('ar-SA');
  });
  const stopStatus = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).stopVoiceListeningInExtension();
  });
  const currentStatus = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).getVoiceStatus();
  });
  const actions = await page.evaluate(() => {
    // @ts-ignore
    return window.__offscreenActions;
  });
  const offscreenCreated = await page.evaluate(() => {
    // @ts-ignore
    return window.__offscreenCreated();
  });

  expect(offscreenCreated).toBe(1);
  expect(actions).toEqual(['start', 'stop']);
  expect(startStatus).toMatchObject({ ok: true, listening: true, language: 'ar-SA' });
  expect(stopStatus).toMatchObject({ ok: true, listening: false, language: 'ar-SA' });
  expect(currentStatus).toMatchObject({ ok: true, listening: false, language: 'en-US' });
});

test('new tab voice commands use the background status language for assistant answers', async ({ page }) => {
  await page.setContent(`
    <div id="clock"></div>
    <div id="greeting"></div>
    <button id="btnMicToggle" type="button">Start listening</button>
    <div id="micStatus"></div>
  `);

  await page.evaluate(() => {
    const listeners: Array<(msg: any) => void> = [];
    let assistantPayload: any = null;

    const chromeMock = {
      runtime: {
        sendMessage(payload: any) {
          if (payload?.type === 'voice:getStatus') {
            return Promise.resolve({
              ok: true,
              supports: true,
              permissionGranted: true,
              listening: true,
              lastError: '',
              language: 'fr-FR'
            });
          }
          if (payload?.type === 'navable:assistant') {
            assistantPayload = payload;
            return Promise.resolve({ ok: true, speech: 'Bonjour.' });
          }
          return Promise.resolve({ ok: true });
        },
        onMessage: {
          addListener(fn: (msg: any) => void) {
            listeners.push(fn);
          }
        }
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US' } });
          }
        },
        onChanged: {
          addListener() {}
        }
      },
      tabs: {
        create() {
          return Promise.resolve();
        },
        update() {
          return Promise.resolve();
        }
      }
    };

    // @ts-ignore
    window.__assistantPayload = () => assistantPayload;
    // @ts-ignore
    window.__runtimeListeners = listeners;
    // @ts-ignore
    window.chrome = chromeMock;
    // @ts-ignore
    // @ts-ignore
    (globalThis as any).chrome = chromeMock;
  });

  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/newtab/newtab.js' });

  await page.evaluate(() => {
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('micStatus');
    return !!status && /Listening|écoute|أستمع/.test(String(status.textContent || ''));
  });

  await page.evaluate(() => {
    // @ts-ignore
    for (const fn of window.__runtimeListeners) {
      fn({ type: 'VOICE_COMMAND', text: 'Bonjour' });
    }
  });

  await expect(page.locator('#micStatus')).toContainText('Bonjour');

  const assistantPayload = await page.evaluate(() => {
    // @ts-ignore
    return window.__assistantPayload();
  });

  expect(assistantPayload).toMatchObject({
    type: 'navable:assistant',
    input: 'Bonjour',
    outputLanguage: 'fr'
  });
});
