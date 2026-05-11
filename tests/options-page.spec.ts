import { expect, test } from '@playwright/test';

test('options page mic button uses Navable command tools on the extension page', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="btnMicToggle" type="button" aria-label="Start listening"></button>
      <p id="micStatus" aria-live="polite">Voice tools are ready for this settings page.</p>
      <select id="languageMode">
        <option value="auto">Auto-detect</option>
        <option value="en">English</option>
        <option value="ar">Arabic</option>
      </select>
      <select id="outputMode">
        <option value="screen_reader">Screen reader</option>
        <option value="chrome_tts">Chrome TTS</option>
      </select>
      <input id="continuous" type="checkbox">
      <input id="aiEnabled" type="checkbox">
      <input id="noSensitiveSites" type="checkbox">
      <input id="noFormFields" type="checkbox">
      <button id="openShortcuts" type="button">Configure Shortcuts</button>
      <div id="saveStatus"></div>
    </main>
  `);

  await page.evaluate(() => {
    const listeners: Function[] = [];
    const fakeRecognizer = {
      on() {},
      start() {
        // @ts-ignore
        window.__recognizerStarted = true;
      },
      stop() {}
    };
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: () => fakeRecognizer
    };
    // @ts-ignore
    window.chrome = {
      runtime: {
        getURL: (path = '') => `chrome-extension://navable/${path}`,
        onMessage: {
          addListener(fn: Function) {
            listeners.push(fn);
          }
        },
        sendMessage: async () => ({ ok: true })
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({
              navable_settings: {
                language: 'en-US',
                languageMode: 'auto',
                outputMode: 'screen_reader',
                autostart: false
              }
            });
          },
          set(_items: any, cb?: () => void) {
            if (typeof cb === 'function') cb();
          }
        },
        onChanged: {
          addListener() {}
        }
      },
      tabs: {
        create: async ({ url }: { url: string }) => {
          // @ts-ignore
          window.__createdTabs = [...((window.__createdTabs as string[]) || []), url];
        }
      }
    };
  });

  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });
  await page.addScriptTag({ path: 'src/options/options.js' });

  await page.evaluate(() => {
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  });

  await page.locator('#btnMicToggle').click();

  await expect(page.locator('#micStatus')).toContainText('Listening');
  await expect.poll(async () => {
    return page.evaluate(() => {
      // @ts-ignore
      return !!window.__recognizerStarted;
    });
  }).toBe(true);
});

test('options page settings can be changed with direct Navable commands', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="btnMicToggle" type="button" aria-label="Start listening"></button>
      <p id="micStatus" aria-live="polite">Voice tools are ready for this settings page.</p>
      <label for="outputMode">Output Mode</label>
      <select id="outputMode">
        <option value="screen_reader">Screen reader</option>
        <option value="chrome_tts">Chrome TTS</option>
      </select>
      <label for="languageMode">Language</label>
      <select id="languageMode">
        <option value="auto">Auto-detect</option>
        <option value="en">English</option>
        <option value="ar">Arabic</option>
      </select>
      <label><input id="continuous" type="checkbox"> Continuous Listening</label>
      <label><input id="aiEnabled" type="checkbox"> Enable AI</label>
      <label><input id="noSensitiveSites" type="checkbox"> Skip Sensitive Sites</label>
      <label><input id="noFormFields" type="checkbox" checked disabled> Form Field Protection</label>
      <button id="openShortcuts" type="button">Configure Shortcuts</button>
      <div id="saveStatus"></div>
    </main>
  `);

  await page.evaluate(() => {
    // @ts-ignore
    window.__savedSettings = [];
    window.fetch = async () => {
      throw new Error('assistant should not be called for settings commands');
    };
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: () => ({ on() {}, start() {}, stop() {} })
    };
    // @ts-ignore
    window.chrome = {
      runtime: {
        getURL: (path = '') => `chrome-extension://navable/${path}`,
        onMessage: { addListener() {} },
        sendMessage: async () => ({ ok: true })
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({
              navable_settings: {
                language: 'en-US',
                languageMode: 'auto',
                outputMode: 'screen_reader',
                autostart: false,
                aiEnabled: false,
                noSensitiveSites: false
              }
            });
          },
          set(items: any, cb?: () => void) {
            // @ts-ignore
            window.__savedSettings.push(items.navable_settings);
            if (typeof cb === 'function') cb();
          }
        },
        onChanged: { addListener() {} }
      },
      tabs: { create: async () => {} }
    };
  });

  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });
  await page.addScriptTag({ path: 'src/options/options.js' });

  await page.evaluate(() => {
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  });

  async function command(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      return await window.NavableTools.handleTranscript(utterance, 'en', 'typed');
    }, text);
  }

  await command('set output mode to chrome tts');
  await command('set language to Arabic');
  await command('turn on continuous listening');
  await command('enable AI');
  await command('turn on skip sensitive sites');

  expect(await page.$eval('#outputMode', (el) => (el as HTMLSelectElement).value)).toBe('chrome_tts');
  expect(await page.$eval('#languageMode', (el) => (el as HTMLSelectElement).value)).toBe('ar');
  expect(await page.$eval('#continuous', (el) => (el as HTMLInputElement).checked)).toBe(true);
  expect(await page.$eval('#aiEnabled', (el) => (el as HTMLInputElement).checked)).toBe(true);
  expect(await page.$eval('#noSensitiveSites', (el) => (el as HTMLInputElement).checked)).toBe(true);

  const saved = await page.evaluate(() => {
    // @ts-ignore
    return window.__savedSettings;
  });
  expect(saved.length).toBeGreaterThanOrEqual(5);
  expect(saved[saved.length - 1]).toMatchObject({
    languageMode: 'ar',
    outputMode: 'chrome_tts',
    autostart: true,
    aiEnabled: true,
    noSensitiveSites: true
  });

  const locked = await command('turn off form field protection');
  expect(String((locked as any).message || '')).toContain('always on by design');
  expect(await page.$eval('#noFormFields', (el) => (el as HTMLInputElement).checked)).toBe(true);
});
