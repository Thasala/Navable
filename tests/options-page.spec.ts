import { expect, test } from '@playwright/test';

test('options page mic button uses Navable command tools on the extension page', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="btnMicToggle" type="button" aria-label="Start listening"></button>
      <p id="micStatus" aria-live="polite">Voice tools are ready for this settings page.</p>
      <select id="languageMode"><option value="auto">Auto</option></select>
      <select id="outputMode"><option value="screen_reader">Screen reader</option></select>
      <input id="continuous" type="checkbox">
      <input id="aiEnabled" type="checkbox">
      <select id="aiMode"><option value="off">Off</option></select>
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
