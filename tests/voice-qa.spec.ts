import { expect, test } from '@playwright/test';

test('unknown spoken question falls back to a brief AI answer', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Home</h1>
      <p>Welcome.</p>
    </main>
  `);

  await page.evaluate(() => {
    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      if (body.input !== 'Who is Ada Lovelace?') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
      }

      return {
        ok: true,
        async json() {
          return {
            mode: 'answer',
            speech: 'Ada Lovelace was a mathematician who wrote the first published algorithm for a machine.',
            summary: '',
            answer: 'Ada Lovelace was a mathematician who wrote the first published algorithm for a machine.',
            suggestions: [],
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    (window as any).chrome.storage.sync.get = (_defaults: any, cb: (res: any) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: false
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.handleTranscript);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('Who is Ada Lovelace?', 'en');
  });

  await expect(page.locator('#navable-live-region-assertive')).toContainText('Ada Lovelace');
  await expect(page.locator('#navable-output-text')).toHaveValue(/Ada Lovelace/);
});

test('short spoken questions on content tabs stay on the answer path', async ({ page }) => {
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
      if (body.input !== 'moon facts') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
      }
      if (body.purpose !== 'answer') {
        throw new Error(`Unexpected purpose: ${String(body.purpose || '')}`);
      }
      if (body.pageStructure) {
        throw new Error('General questions should not include page structure');
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
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    (window as any).chrome.storage.sync.get = (_defaults: any, cb: (res: any) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: false
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.handleTranscript);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('moon facts', 'en');
  });

  await expect(page.locator('#navable-live-region-assertive')).toContainText("Earth's natural satellite");
  await expect(page.locator('#navable-output-text')).toHaveValue(/Earth's natural satellite/);
});

test('page follow-up questions reuse session memory on content tabs', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Docs</h1>
      <p>Welcome to the docs.</p>
      <h2>Getting Started</h2>
    </main>
  `);

  await page.evaluate(() => {
    let callCount = 0;

    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      callCount += 1;
      const body = JSON.parse(String(init?.body || '{}'));

      if (callCount === 1) {
        if (body.input !== 'help me here') {
          throw new Error(`Unexpected first input: ${String(body.input || '')}`);
        }
        if (body.purpose !== 'page') {
          throw new Error(`Unexpected first purpose: ${String(body.purpose || '')}`);
        }
        if (
          !body.pageStructure ||
          !Array.isArray(body.pageStructure.headings) ||
          body.pageStructure.headings[0]?.label !== 'Docs'
        ) {
          throw new Error('Missing first page structure');
        }
        if (body.sessionContext !== null) {
          throw new Error('First page request should not have prior session context');
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
              plan: { steps: [] }
            };
          }
        };
      }

      if (body.input !== 'tell me more') {
        throw new Error(`Unexpected second input: ${String(body.input || '')}`);
      }
      if (body.purpose !== 'page') {
        throw new Error(`Unexpected second purpose: ${String(body.purpose || '')}`);
      }
      if (
        !body.pageStructure ||
        !Array.isArray(body.pageStructure.headings) ||
        body.pageStructure.headings[0]?.label !== 'Docs'
      ) {
        throw new Error('Missing follow-up page structure');
      }
      if (body.sessionContext?.lastPurpose !== 'page') {
        throw new Error(`Missing follow-up purpose memory: ${String(body.sessionContext?.lastPurpose || '')}`);
      }
      if (!String(body.sessionContext?.lastPage?.summary || '').includes('docs page')) {
        throw new Error('Missing prior page summary in session context');
      }

      return {
        ok: true,
        async json() {
          return {
            mode: 'page',
            speech: 'The Getting Started section explains setup.',
            summary: 'The Getting Started section explains setup.',
            answer: '',
            suggestions: [],
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    (window as any).chrome.storage.sync.get = (_defaults: any, cb: (res: any) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: false
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.handleTranscript);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('help me here', 'en');
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('tell me more', 'en');
  });

  await expect(page.locator('#navable-output-text')).toHaveValue(/Getting Started/);
  await expect(page.locator('#navable-output-text')).toHaveValue(/Getting Started/);
});

test('spoken question retries assistant directly when background returns a generic error', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Space</h1>
      <p>The moon orbits Earth.</p>
    </main>
  `);

  await page.evaluate(() => {
    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      if (body.input !== 'What is the moon?') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
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
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    (window as any).chrome.storage.sync.get = (_defaults: any, cb: (res: any) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: false
        }
      });
    };
    // @ts-ignore
    (window as any).chrome.runtime.sendMessage = async () => ({
      ok: false,
      error: 'I could not answer that right now.'
    });
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.handleTranscript);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('What is the moon?', 'en');
  });

  await expect(page.locator('#navable-live-region-assertive')).toContainText("Earth's natural satellite");
  await expect(page.locator('#navable-output-text')).toHaveValue(/Earth's natural satellite/);
});

test('direct assistant fallback keeps session memory for follow-up questions', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Space</h1>
      <p>The moon orbits Earth.</p>
    </main>
  `);

  await page.evaluate(() => {
    let callCount = 0;

    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      callCount += 1;
      const body = JSON.parse(String(init?.body || '{}'));

      if (callCount === 1) {
        if (body.input !== 'What is the moon?') {
          throw new Error(`Unexpected first input: ${String(body.input || '')}`);
        }
        if (body.sessionContext !== null) {
          throw new Error('First direct fallback request should not have prior session context');
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
              plan: { steps: [] }
            };
          }
        };
      }

      if (body.input !== 'tell me more') {
        throw new Error(`Unexpected second input: ${String(body.input || '')}`);
      }
      if (body.purpose !== 'answer') {
        throw new Error(`Unexpected second purpose: ${String(body.purpose || '')}`);
      }
      if (body.sessionContext?.lastPurpose !== 'answer') {
        throw new Error(`Missing follow-up answer purpose: ${String(body.sessionContext?.lastPurpose || '')}`);
      }
      if (body.sessionContext?.lastEntity !== 'moon') {
        throw new Error(`Missing follow-up entity: ${String(body.sessionContext?.lastEntity || '')}`);
      }
      if (!String(body.sessionContext?.lastAnswer || '').includes("Earth's natural satellite")) {
        throw new Error('Missing prior answer in follow-up session context');
      }

      return {
        ok: true,
        async json() {
          return {
            mode: 'answer',
            speech: 'It affects tides and helps stabilize Earths axial tilt.',
            summary: '',
            answer: 'It affects tides and helps stabilize Earths axial tilt.',
            suggestions: [],
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    (window as any).chrome.storage.sync.get = (_defaults: any, cb: (res: any) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: false
        }
      });
    };
    // @ts-ignore
    (window as any).chrome.runtime.sendMessage = async () => ({
      ok: false,
      error: 'I could not answer that right now.'
    });
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.handleTranscript);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('What is the moon?', 'en');
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('tell me more', 'en');
  });

  await expect(page.locator('#navable-output-text')).toHaveValue(/stabilize Earths axial tilt/);
});

test('summary requests use the unified assistant endpoint', async ({ page }) => {
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
      if (body.purpose !== 'summary') {
        throw new Error(`Unexpected purpose: ${String(body.purpose || '')}`);
      }
      if (!body.pageStructure || !body.pageStructure.headings || body.pageStructure.headings[0]?.label !== 'Docs') {
        throw new Error('Missing page structure');
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
    (window as any).chrome.storage.sync.get = (_defaults: any, cb: (res: any) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: false
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).runPlanner('Summarize this page', 'en', false);
  });

  expect(result.ok).toBe(true);
  expect(result.summary).toContain('documentation');
  expect(result.description).toContain('Suggestions: Try: read the title.');
  await expect(page.locator('#navable-live-region-assertive')).toContainText(/documentation/);
  await expect(page.locator('#navable-output-text')).toHaveValue(/documentation/);
});

test('summary plan keeps the summary output visible while follow-up steps run', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Docs</h1>
      <p>Welcome to the docs.</p>
      <h2>Getting Started</h2>
      <button id="inspect" onclick="window.summaryPlanRan=(window.summaryPlanRan||0)+1">Inspect docs</button>
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
      if (body.purpose !== 'summary') {
        throw new Error(`Unexpected purpose: ${String(body.purpose || '')}`);
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
            plan: { steps: [{ action: 'click_element', targetType: 'button', label: 'Inspect docs' }] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    (window as any).chrome.storage.sync.get = (_defaults: any, cb: (res: any) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary_plan',
          language: 'en-US',
          autostart: false
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).runPlanner('Summarize this page', 'en', false);
  });

  expect(result.ok).toBe(true);
  expect(result.plan?.steps?.length).toBe(1);
  await page.waitForFunction(() => (window as any).summaryPlanRan === 1);
  await expect(page.locator('#navable-live-region-assertive')).toContainText(/documentation/);
  await expect(page.locator('#navable-output-text')).toHaveValue(/documentation/);
});

test('new tab spoken question stays on the existing live output path', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="btnMicToggle" type="button">Start listening</button>
      <div id="micStatus">Not listening.</div>
    </main>
  `);

  await page.evaluate(() => {
    // @ts-ignore
    (window as any).chrome = {};
    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      if (body.input !== 'What is the moon?') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
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
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/newtab/newtab.js' });

  await page.waitForFunction(() => (window as any).NavableNewtabTools?.handleTranscript);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableNewtabTools.handleTranscript('What is the moon?', 'en');
  });

  await expect(page.locator('#micStatus')).toContainText("Earth's natural satellite");
  await expect(page.locator('#navable-live-region-assertive')).toContainText("Earth's natural satellite");
  await expect(page.locator('#navable-output-text')).toHaveValue(/Earth's natural satellite/);
});
