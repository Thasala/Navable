
import { test, expect } from '@playwright/test';

const ANNOUNCER_CODE = `
  (function(){
    var REGION_ID_POLITE = 'navable-live-region-polite';
    var REGION_ID_ASSERT = 'navable-live-region-assertive';

    function ensureRegion(id, politeness) {
      var node = document.getElementById(id);
      if (!node) {
        node = document.createElement('div');
        node.id = id;
        node.setAttribute('role','status');
        node.setAttribute('aria-live', politeness);
        node.setAttribute('aria-atomic','true');
        Object.assign(node.style, {
          position:'fixed', width:'1px', height:'1px', padding:'0', margin:'-1px',
          overflow:'hidden', clip:'rect(0 0 0 0)', whiteSpace:'nowrap', border:'0'
        });
        document.body.appendChild(node);
      }
      return node;
    }

    var throttle;
    function setText(node, text){
      clearTimeout(throttle);
      throttle = setTimeout(function(){
        node.textContent = '';
        setTimeout(function(){ node.textContent = text; }, 20);
      }, 50);
    }

    // make it truly global
    window.NavableAnnounce = function(text, opts){
      opts = opts || {};
      var mode = opts.mode === 'assertive' ? 'assertive' : 'polite';
      var id = mode === 'assertive' ? REGION_ID_ASSERT : REGION_ID_POLITE;
      var node = ensureRegion(id, mode);
      setText(node, text);
    };
  })();
`;

test('announce helper creates/updates live region', async ({ page }) => {
  await page.setContent('<main><h1>Test</h1><button id="b">Focus me</button></main>');
  await page.addScriptTag({ content: ANNOUNCER_CODE });

  // Focus page to ensure key events / SR-like behavior permitted
  await page.click('#b');

  // Call the announcer from the page context
  await page.evaluate(() => {
    // @ts-ignore
    window.NavableAnnounce('Navable: direct announce works.', { mode: 'polite' });
  });

  const politeRegion = page.locator('#navable-live-region-polite');
  // Wait for the text to appear (the announcer uses small timeouts)
  await expect(politeRegion).toHaveText(/Navable: direct announce works\./, { timeout: 5000 });
});
