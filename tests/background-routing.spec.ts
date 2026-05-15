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

test('runPlanner resolves page-local follow-up actions from visible controls', async ({ page }) => {
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

    const pageStructure = {
      title: 'Facebook',
      url: 'https://www.facebook.com/',
      counts: { headings: 1, links: 0, buttons: 2, inputs: 0 },
      headings: [{ label: 'Facebook' }],
      links: [],
      buttons: [
        { label: 'Notifications', tag: 'button' },
        { label: "What's on your mind, Sam?", tag: 'button' }
      ],
      inputs: [],
      excerpt: 'Notifications. What is on your mind, Sam?'
    };

    const readResponse = await (window as any).runPlanner('read notifications', 'en', true, {
      sourceTabId: 42,
      pageStructure
    });
    const postResponse = await (window as any).runPlanner('create a post', 'en', true, {
      sourceTabId: 42,
      pageStructure
    });

    return { readResponse, postResponse, calls };
  });

  expect(result.readResponse.ok).toBe(true);
  expect(result.readResponse.plan.steps).toEqual([
    { action: 'focus_element', target: 'button', label: 'Notifications' },
    { action: 'read_focused' }
  ]);
  expect(result.postResponse.ok).toBe(true);
  expect(result.postResponse.plan.steps).toEqual([
    { action: 'click_element', target: 'button', label: "What's on your mind, Sam?" }
  ]);
  expect(result.calls).toHaveLength(2);
});

test('page-context assistant runtime requests execute plans on the sender tab without re-querying the active tab', async ({ page }) => {
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
      if (body.input !== 'help me here') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
      }
      if (body.purpose !== 'page') {
        throw new Error(`Unexpected purpose: ${String(body.purpose || '')}`);
      }
      if (!body.pageStructure || body.pageStructure.title !== 'Docs') {
        throw new Error('Missing sender page structure');
      }

      return {
        ok: true,
        async json() {
          return {
            mode: 'page',
            speech: 'You are on the docs page.',
            summary: 'You are on the docs page.',
            answer: '',
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
            input: 'help me here',
            outputLanguage: 'en',
            purpose: 'page',
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

  expect(result.response).toMatchObject({ ok: true, speech: 'You are on the docs page.' });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].tabId).toBe(42);
  expect(result.calls[0].payload.type).toBe('navable:executePlan');
});

test('assistant runtime requests carry session memory into answer follow-ups', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const result = await page.evaluate(async () => {
    const requestBodies: any[] = [];
    let sessionGetCalls = 0;
    let firstStoredSession: any = null;

    const originalSessionGet = window.chrome.storage.session.get.bind(window.chrome.storage.session);
    // @ts-ignore
    window.chrome.storage.session.get = (query: any, cb: (res: any) => void) => {
      sessionGetCalls += 1;
      originalSessionGet(query, cb);
    };

    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      requestBodies.push(body);

      if (body.input === 'What is the moon?') {
        return {
          ok: true,
          async json() {
            return {
              mode: 'answer',
              speech: "The moon is Earth's natural satellite.",
              summary: '',
              answer: "The moon is Earth's natural satellite.",
              suggestions: [],
              plan: { steps: [] }
            };
          }
        };
      }

      if (body.input === 'tell me more') {
        return {
          ok: true,
          async json() {
            return {
              mode: 'answer',
              speech: 'It affects tides and stabilizes Earths axial tilt.',
              summary: '',
              answer: 'It affects tides and stabilizes Earths axial tilt.',
              suggestions: [],
              plan: { steps: [] }
            };
          }
        };
      }

      throw new Error(`Unexpected input: ${String(body.input || '')}`);
    };

    // @ts-ignore
    const listener = window.chrome.runtime._listeners[window.chrome.runtime._listeners.length - 1];

    async function sendAssistant(payload: any) {
      return await new Promise((resolve, reject) => {
        try {
          const maybeAsync = listener(payload, { tab: { id: 42 } }, resolve);
          if (maybeAsync !== true) resolve(undefined);
        } catch (err) {
          reject(err);
        }
      });
    }

    await sendAssistant({
      type: 'navable:assistant',
      input: 'What is the moon?',
      outputLanguage: 'en',
      purpose: 'answer',
      pageContext: false,
      autoExecutePlan: false
    });
    firstStoredSession = window.chrome.storage.session._data['navable.session.42'];

    await sendAssistant({
      type: 'navable:assistant',
      input: 'tell me more',
      outputLanguage: 'en',
      purpose: 'auto',
      pageContext: false,
      autoExecutePlan: false
    });

    return {
      requestBodies,
      firstStoredSession,
      storedSession: window.chrome.storage.session._data['navable.session.42'],
      sessionGetCalls
    };
  });

  expect(result.requestBodies[0].purpose).toBe('answer');
  expect(result.requestBodies[0].sessionContext).toBeNull();
  expect(result.requestBodies[1].purpose).toBe('answer');
  expect(result.requestBodies[1].pageStructure).toBeNull();
  expect(result.requestBodies[1].sessionContext?.lastPurpose).toBe('answer');
  expect(result.requestBodies[1].sessionContext?.lastAnswer).toContain("Earth's natural satellite");
  expect(result.requestBodies[1].sessionContext?.lastEntity).toBe('moon');
  expect(result.firstStoredSession?.lastPurpose).toBe('answer');
  expect(result.firstStoredSession?.lastAnswer).toContain("Earth's natural satellite");
  expect(result.storedSession?.lastPurpose).toBe('answer');
  expect(result.storedSession?.lastAnswer).toContain('It affects tides');
  expect(result.sessionGetCalls).toBeGreaterThan(0);
});

test('content assistant requests omit the current page structure for general questions', async ({ page }) => {
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
  expect(captured[1].purpose).toBe('answer');
  expect(captured[1].pageContext).toBe(false);
  expect(captured[1].pageStructure).toBeNull();
});

test('content assistant requests include the current page structure for explicit page help', async ({ page }) => {
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
            speech: 'You are on the docs page.',
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
    await (window as any).NavableTools.handleTranscript('help me here', 'en', 'native');
  });

  const captured = await page.evaluate(() => {
    // @ts-ignore
    return window.__capturedMessages;
  });

  expect(captured[0].type).toBe('planner:run');
  expect(captured[1].type).toBe('navable:assistant');
  expect(captured[1].purpose).toBe('page');
  expect(captured[1].pageContext).toBe(true);
  expect(captured[1].pageStructure.title).toBe('Docs');
});

test('content assistant treats current-page answer requests as page context', async ({ page }) => {
  await page.setContent(`
    <html>
      <head>
        <title>Quiz</title>
      </head>
      <body>
        <main>
          <h1>Question 1</h1>
          <fieldset>
            <legend>During Industry 1.0, what marked a major shift in production?</legend>
            <label><input type="radio" name="q1" value="phone" /> Introduction of the telephone in 1850.</label>
            <label><input type="radio" name="q1" value="steam" /> Development of James Watt's steam engine in 1763.</label>
          </fieldset>
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
            speech: "The best answer shown is James Watt's steam engine in 1763.",
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

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('What is the answer to the question on the current page?', 'en', 'native');
  });

  const captured = await page.evaluate(() => {
    // @ts-ignore
    return window.__capturedMessages;
  });

  expect(captured[0].type).toBe('planner:run');
  expect(captured[1].type).toBe('navable:assistant');
  expect(captured[1].purpose).toBe('page');
  expect(captured[1].pageContext).toBe(true);
  expect(captured[1].pageStructure.title).toBe('Quiz');
  expect(String(captured[1].pageStructure.excerpt || '')).toContain("Development of James Watt's steam engine in 1763.");
});

test('content resolves affirmative page follow-ups against current page context', async ({ page }) => {
  await page.setContent(`
    <html>
      <head>
        <title>Facebook</title>
      </head>
      <body>
        <main>
          <h1>Facebook</h1>
          <button>Notifications</button>
          <button>What's on your mind, Sam?</button>
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
          if (payload.type === 'planner:run') {
            return { ok: false, unhandled: true };
          }
          if (payload.type === 'navable:assistant' && payload.input === 'help me here') {
            return {
              ok: true,
              mode: 'page',
              speech: 'This Facebook page includes notifications. I can read your notifications.',
              summary: 'This Facebook page includes notifications.',
              answer: '',
              suggestions: [],
              plan: { steps: [] }
            };
          }
          if (payload.type === 'navable:assistant' && payload.input === 'read notifications') {
            return {
              ok: true,
              mode: 'page',
              speech: 'Notifications is the visible notification control.',
              summary: 'Notifications is the visible notification control.',
              answer: '',
              suggestions: [],
              plan: { steps: [] }
            };
          }
          throw new Error(`Unexpected message: ${JSON.stringify(payload)}`);
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

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('help me here', 'en', 'native');
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('ok go ahead and read them', 'en', 'native');
  });

  const captured = await page.evaluate(() => {
    // @ts-ignore
    return window.__capturedMessages;
  });

  expect(captured[0]).toMatchObject({ type: 'planner:run', command: 'help me here' });
  expect(captured[1]).toMatchObject({ type: 'navable:assistant', input: 'help me here', purpose: 'page', pageContext: true });
  expect(captured[2]).toMatchObject({ type: 'planner:run', command: 'read notifications' });
  expect(captured[3]).toMatchObject({ type: 'navable:assistant', input: 'read notifications', purpose: 'page', pageContext: true });
  expect(captured[3].pageStructure.title).toBe('Facebook');
});
