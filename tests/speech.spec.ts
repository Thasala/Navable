import { test, expect } from '@playwright/test';

const SPEECH_STUB = `
  (function(){
    const listeners = {};
    function speak(text){
      // use live region as our side effect for tests
      let n = document.getElementById('navable-live-region-polite');
      if (!n) { n = document.createElement('div'); n.id='navable-live-region-polite'; n.setAttribute('role','status'); n.setAttribute('aria-live','polite'); document.body.appendChild(n); }
      n.textContent = String(text||'');
      return Promise.resolve(true);
    }
    function supportsRecognition(){ return true; }
    function createRecognizer(){
      let listening=false; 
      const handlers = { start:new Set(), end:new Set(), error:new Set(), result:new Set() };
      const rec = {
        start(){ listening=true; handlers.start.forEach(fn=>fn()); },
        stop(){ listening=false; handlers.end.forEach(fn=>fn()); },
        abort(){ listening=false; handlers.end.forEach(fn=>fn()); },
        isListening(){ return listening; },
        on(evt, fn){ handlers[evt]?.add(fn); },
        off(evt, fn){ handlers[evt]?.delete(fn); }
      };
      // test hook
      rec.emit = function(evt, payload){ handlers[evt]?.forEach(fn=>fn(payload)); };
      window._navableTestRecognizer = rec;
      return rec;
    }
    window.NavableSpeech = { speak, supportsRecognition, createRecognizer };
  })();
`;

test('voice: scroll down and read title', async ({ page }) => {
  await page.setContent('<main style="height:2000px"><h1>Alpha</h1><p>Body</p></main>');
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ content: SPEECH_STUB }); // inject stub first
  await page.addScriptTag({ path: 'src/content.js' }); // then content

  // Toggle listening via hotkey Alt+Shift+M
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('m');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  await page.evaluate(() => {
    // @ts-ignore
    window._navableTestRecognizer.emit('result', { transcript: 'scroll down' });
  });

  // Wait for scroll to happen
  await page.waitForTimeout(100);
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(0);

  await page.evaluate(() => {
    // @ts-ignore
    window._navableTestRecognizer.emit('result', { transcript: 'read title' });
  });
  const polite = page.locator('#navable-live-region-polite');
  await expect(polite).toContainText('Title: Alpha');
});

