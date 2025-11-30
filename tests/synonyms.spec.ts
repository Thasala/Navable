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

test('go to <label> opens link; click <label> opens link', async ({ page }) => {
  await page.setContent(`<main><a href="#pricing">Pricing</a><a href="#docs">Docs</a></main>`);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ content: SPEECH_STUB });
  await page.addScriptTag({ path: 'src/content.js' });

  // Toggle listening
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('m');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'go to pricing' }); });
  await page.waitForTimeout(50);
  await expect(page).toHaveURL(/#pricing$/);

  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'click docs' }); });
  await page.waitForTimeout(50);
  await expect(page).toHaveURL(/#docs$/);
});

test('activate focused and read selection', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="act" onclick="window._activated=(window._activated||0)+1">Go</button>
      <p id="p">Hello pick me</p>
      <script>document.getElementById('act').focus();</script>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ content: SPEECH_STUB });
  await page.addScriptTag({ path: 'src/content.js' });

  // listen
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('m');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  // activate focused
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'activate focused' }); });
  await page.waitForFunction(() => (window as any)._activated === 1);
  await expect(page.evaluate(() => (window as any)._activated)).resolves.toBe(1);

  // select text
  await page.evaluate(() => {
    const el = document.getElementById('p');
    const r = document.createRange();
    r.selectNodeContents(el!);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(r);
  });
  // read selection
  await page.evaluate(() => { /* @ts-ignore */ window._navableTestRecognizer.emit('result', { transcript: 'read selection' }); });
  const polite = page.locator('#navable-live-region-polite');
  await expect(polite).toContainText('Selection: Hello pick me');
});

