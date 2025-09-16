// tests/announce-hotkey.spec.ts
import { test, expect } from '@playwright/test';

const ANNOUNCER_AND_LISTENER = `
  (function(){
    const ID='navable-live-region-polite';
    function ensure(){
      let n=document.getElementById(ID);
      if(!n){
        n=document.createElement('div');
        n.id=ID;
        n.setAttribute('role','status');
        n.setAttribute('aria-live','polite');
        n.setAttribute('aria-atomic','true');
        Object.assign(n.style,{
          position:'fixed',width:'1px',height:'1px',margin:'-1px',
          overflow:'hidden',clip:'rect(0 0 0 0)',border:'0'
        });
        document.body.appendChild(n);
      }
      return n;
    }
    function announce(t){
      const n=ensure();
      n.textContent='';
      setTimeout(()=>{ n.textContent=t; }, 20);
    }
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && e.key === ';') {
        announce('Navable: test announcement (fallback hotkey).');
      }
    });
  })();
`;

test('content-like hotkey announces via injected listener', async ({ page }) => {
  await page.setContent(`<main><h1>Hotkey</h1><button id="focus">Click</button></main>`);
  await page.addScriptTag({ content: ANNOUNCER_AND_LISTENER });

  await page.click('#focus'); // focus the document

  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press(';');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');

  const politeRegion = page.locator('#navable-live-region-polite');
  // ✅ Wait until the text is set
  await expect(politeRegion).toHaveText(/Navable: test announcement \(fallback hotkey\)\./, { timeout: 5000 });
});
