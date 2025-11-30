import { test, expect } from '@playwright/test';

const SPEECH_STUB = `
  (function(){
    function ensureRegion(){
      let n=document.getElementById('navable-live-region-polite');
      if(!n){ n=document.createElement('div'); n.id='navable-live-region-polite'; n.setAttribute('role','status'); n.setAttribute('aria-live','polite'); document.body.appendChild(n); }
      return n;
    }
    function speak(text){ ensureRegion().textContent = String(text||''); return Promise.resolve(true);} 
    function supportsRecognition(){ return true; }
    function createRecognizer(){
      let listening=false; const handlers={start:new Set(),end:new Set(),error:new Set(),result:new Set()};
      const rec={ start(){listening=true; handlers.start.forEach(fn=>fn());}, stop(){listening=false; handlers.end.forEach(fn=>fn());}, abort(){listening=false; handlers.end.forEach(fn=>fn());}, isListening(){return listening;}, on(evt,fn){handlers[evt]?.add(fn);}, off(evt,fn){handlers[evt]?.delete(fn);} };
      // test hook
      // @ts-ignore
      rec.emit=(evt,payload)=>{ handlers[evt]?.forEach(fn=>fn(payload)); };
      // @ts-ignore
      window._navableTestRecognizer=rec; return rec;
    }
    // @ts-ignore
    window.NavableSpeech={ speak, supportsRecognition, createRecognizer };
  })();
`;

test('open first and second link; read first heading; focus second button', async ({ page }) => {
  await page.setContent(`
    <main style="height:1500px">
      <h1>Heading One</h1>
      <a id="l1" href="#one">One</a>
      <a id="l2" href="#two">Two</a>
      <button id="b1">Alpha</button>
      <button id="b2">Beta</button>
    </main>
  `);
  // inject announce + stub speech + content
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ content: SPEECH_STUB });
  await page.addScriptTag({ path: 'src/content.js' });

  // Activate listening (hotkey Alt+Shift+M)
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('m');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  // open first link
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'open first link' }); });
  await page.waitForTimeout(50);
  await expect(page).toHaveURL(/#one$/);

  // open second link
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'open second link' }); });
  await page.waitForTimeout(50);
  await expect(page).toHaveURL(/#two$/);

  // read first heading
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'read first heading' }); });
  const polite = page.locator('#navable-live-region-polite');
  await expect(polite).toContainText('Heading: Heading One');

  // focus second button
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'focus second button' }); });
  const active = await page.evaluate(() => document.activeElement && (document.activeElement as HTMLElement).id);
  expect(active).toBe('b2');
});

