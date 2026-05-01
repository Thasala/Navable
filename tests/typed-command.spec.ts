import { expect, test } from '@playwright/test';

test('content script handles typed command messages through the normal assistant flow', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Docs</h1>
      <p>Welcome to the docs.</p>
    </main>
  `);

  await page.evaluate(() => {
    const listeners: Array<(msg: any, sender: any, sendResponse: (res: any) => void) => any> = [];
    const messages: any[] = [];

    // @ts-ignore
    window.chrome = {
      runtime: {
        _listeners: listeners,
        sendMessage: async (payload: any) => {
          messages.push(payload);
          if (payload.type === 'planner:run') {
            return { ok: false, unhandled: true };
          }
          if (payload.type === 'navable:assistant') {
            return {
              ok: true,
              speech: "The moon is Earth's natural satellite.",
              summary: '',
              answer: "The moon is Earth's natural satellite.",
              plan: { steps: [] }
            };
          }
          return { ok: true };
        },
        onMessage: {
          addListener(fn: any) {
            listeners.push(fn);
          }
        }
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US', autostart: false, overlay: false } });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    };

    // @ts-ignore
    window.__contentListeners = listeners;
    // @ts-ignore
    window.__contentMessages = messages;
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: () => ({
        start() {},
        stop() {},
        on() { return this; }
      })
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    return await new Promise((resolve, reject) => {
      try {
        const maybeAsync = listener(
          { type: 'navable:runTypedCommand', text: 'What is the moon?', detectedLanguage: 'en' },
          {},
          resolve
        );
        if (maybeAsync !== true) resolve(undefined);
      } catch (err) {
        reject(err);
      }
    });
  });

  const messages = await page.evaluate(() => {
    // @ts-ignore
    return window.__contentMessages;
  });

  expect(result).toMatchObject({
    ok: true,
    speech: "The moon is Earth's natural satellite.",
    feedback: {
      status: 'success',
      message: "The moon is Earth's natural satellite."
    }
  });
  expect(messages[0].type).toBe('planner:run');
  expect(messages[1].type).toBe('navable:assistant');
  expect(messages[1].input).toBe('What is the moon?');
});

test('typed open-site command returns loading feedback while the page opens', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Docs</h1>
      <p>Welcome to the docs.</p>
    </main>
  `);

  await page.evaluate(() => {
    const listeners: Array<(msg: any, sender: any, sendResponse: (res: any) => void) => any> = [];

    // @ts-ignore
    window.chrome = {
      runtime: {
        sendMessage: async (payload: any) => {
          if (payload.type === 'navable:openSite') {
            return {
              ok: true,
              url: 'https://example.com/',
              speech: 'Opening example.com',
              feedback: {
                status: 'loading',
                message: 'Opening example.com'
              }
            };
          }
          if (payload.type === 'planner:run') {
            return { ok: false, unhandled: true };
          }
          return { ok: true };
        },
        onMessage: {
          addListener(fn: any) {
            listeners.push(fn);
          }
        }
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US', autostart: false, overlay: false } });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    };

    // @ts-ignore
    window.__contentListeners = listeners;
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: () => ({
        start() {},
        stop() {},
        on() { return this; }
      })
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    return await new Promise((resolve, reject) => {
      try {
        const maybeAsync = listener(
          { type: 'navable:runTypedCommand', text: 'open example dot com', detectedLanguage: 'en' },
          {},
          resolve
        );
        if (maybeAsync !== true) resolve(undefined);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(result).toMatchObject({
    ok: true,
    speech: 'Opening example.com',
    feedback: {
      status: 'loading',
      message: 'Opening example.com'
    }
  });
});
