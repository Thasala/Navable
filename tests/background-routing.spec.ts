import { expect, test } from '@playwright/test';

test('runPlanner executes steps on the sender tab when provided', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const result = await page.evaluate(async () => {
    const calls: Array<{ tabId: number; payload: any }> = [];

    // @ts-ignore
    window.chrome.tabs.query = async () => [{ id: 7 }];
    // @ts-ignore
    window.chrome.tabs.sendMessage = async (tabId: number, payload: any) => {
      calls.push({ tabId, payload });
      return { ok: true };
    };

    const response = await (window as any).runPlanner(
      'scroll down',
      'en',
      false,
      {
        sourceTabId: 42,
        pageStructure: {
          title: 'Docs',
          url: 'https://example.com/docs',
          counts: { headings: 1, links: 0, buttons: 0 },
          headings: [{ label: 'Docs' }],
          links: [],
          buttons: [],
          inputs: [],
          excerpt: 'Welcome.'
        }
      }
    );

    return { response, calls };
  });

  expect(result.response.ok).toBe(true);
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].tabId).toBe(42);
  expect(result.calls[0].payload.type).toBe('navable:executePlan');
});

test('assistant runtime requests execute plans on the sender tab without re-querying the active tab', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const result = await page.evaluate(async () => {
    const calls: Array<{ tabId: number; payload: any }> = [];

    // @ts-ignore
    window.chrome.tabs.query = async () => {
      throw new Error('active tab lookup should not run');
    };
    // @ts-ignore
    window.chrome.tabs.sendMessage = async (tabId: number, payload: any) => {
      calls.push({ tabId, payload });
      return { ok: true };
    };

    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      if (body.input !== 'What is the moon?') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
      }
      if (!body.pageStructure || body.pageStructure.title !== 'Docs') {
        throw new Error('Missing sender page structure');
      }

      return {
        ok: true,
        async json() {
          return {
            mode: 'answer',
            speech: "The moon is Earth's natural satellite.",
            summary: '',
            answer: "The moon is Earth's natural satellite.",
            suggestions: [],
            plan: { steps: [{ action: 'scroll', direction: 'down' }] }
          };
        }
      };
    };

    // @ts-ignore
    const listener = window.chrome.runtime._listeners[window.chrome.runtime._listeners.length - 1];
    const response = await new Promise((resolve, reject) => {
      try {
        const maybeAsync = listener(
          {
            type: 'navable:assistant',
            input: 'What is the moon?',
            outputLanguage: 'en',
            pageContext: true,
            pageStructure: {
              title: 'Docs',
              url: 'https://example.com/docs',
              counts: { headings: 1, links: 0, buttons: 0 },
              headings: [{ label: 'Docs' }],
              links: [],
              buttons: [],
              inputs: [],
              excerpt: 'Welcome.'
            },
            autoExecutePlan: true
          },
          { tab: { id: 42 } },
          resolve
        );
        if (maybeAsync !== true) resolve(undefined);
      } catch (err) {
        reject(err);
      }
    });

    return { response, calls };
  });

  expect(result.response).toMatchObject({ ok: true, speech: "The moon is Earth's natural satellite." });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].tabId).toBe(42);
  expect(result.calls[0].payload.type).toBe('navable:executePlan');
});

test('content assistant requests include the current page structure', async ({ page }) => {
  await page.setContent(`
    <html>
      <head>
        <title>Docs</title>
      </head>
      <body>
        <main>
          <h1>Docs</h1>
          <p>Welcome to the docs.</p>
          <h2>Getting Started</h2>
        </main>
      </body>
    </html>
  `);

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });

  await page.evaluate(() => {
    const messages: any[] = [];
    // @ts-ignore
    window.chrome = {
      runtime: {
        sendMessage: async (payload: any) => {
          messages.push(payload);
          return {
            ok: true,
            speech: "The moon is Earth's natural satellite.",
            plan: { steps: [] }
          };
        },
        onMessage: {
          addListener() {}
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
    window.__capturedMessages = messages;
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

  await page.addScriptTag({ path: 'src/content.js' });
  await page.waitForFunction(() => (window as any).NavableTools?.handleTranscript);
  await page.waitForFunction(() => {
    // @ts-ignore
    return (window as any).NavableTools?.buildPageStructure?.().title === 'Docs';
  });

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('What is the moon?', 'en', 'native');
  });

  const captured = await page.evaluate(() => {
    // @ts-ignore
    return window.__capturedMessages;
  });

  expect(captured[0].type).toBe('planner:run');
  expect(captured[0].pageStructure.title).toBe('Docs');
  expect(captured[0].pageStructure.headings[0].label).toBe('Docs');
  expect(captured[1].type).toBe('navable:assistant');
  expect(captured[1].pageStructure.title).toBe('Docs');
});
