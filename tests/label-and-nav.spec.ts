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
      // @ts-ignore
      rec.emit=(evt,payload)=>{ handlers[evt]?.forEach(fn=>fn(payload)); };
      // @ts-ignore
      window._navableTestRecognizer=rec; return rec;
    }
    // @ts-ignore
    window.NavableSpeech={ speak, supportsRecognition, createRecognizer };
  })();
`;

test('open link by label and next/previous button', async ({ page }) => {
  await page.setContent(`
    <main>
      <a id="docs" href="#docs">Documentation</a>
      <a id="pricing" href="#pricing">Pricing</a>
      <button id="btn1">Start</button>
      <button id="btn2">Continue</button>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ content: SPEECH_STUB });
  await page.addScriptTag({ path: 'src/content.js' });

  // Activate listening
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('m');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  // open link by label
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'open link pricing' }); });
  await page.waitForTimeout(50);
  await expect(page).toHaveURL(/#pricing$/);

  // next button
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'next button' }); });
  const active1 = await page.evaluate(() => document.activeElement && (document.activeElement as HTMLElement).id);
  expect(active1 === 'btn1' || active1 === 'btn2').toBeTruthy();
  // move again to ensure wrap doesn't crash
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'next button' }); });
  const active2 = await page.evaluate(() => document.activeElement && (document.activeElement as HTMLElement).id);
  expect(active2 === 'btn1' || active2 === 'btn2').toBeTruthy();

  // previous button
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'previous button' }); });
  const active3 = await page.evaluate(() => document.activeElement && (document.activeElement as HTMLElement).id);
  expect(active3 === 'btn1' || active3 === 'btn2').toBeTruthy();
});

