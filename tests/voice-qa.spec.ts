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
