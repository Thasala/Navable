register().catch(e=>console.error('[Navable] top-level register error',e));
chrome.runtime.onInstalled.addListener(()=>register().catch(e=>console.error('[Navable] onInstalled error',e)));
chrome.runtime.onStartup.addListener(()=>register().catch(e=>console.error('[Navable] onStartup error',e)));

async function register() {
  const existing = await chrome.scripting.getRegisteredContentScripts().catch(()=>[]);
  if (existing.find(s => s.id === 'navable-auto')) {
    await chrome.scripting.unregisterContentScripts({ ids: ['navable-auto'] });
  }
  await chrome.scripting.registerContentScripts([{
    id: 'navable-auto',
    matches: ['http://*/*','https://*/*'],
    js: ['src/common/announce.js','src/content.js'],
    runAt: 'document_idle',
    world: 'ISOLATED'
  }]);
  console.log('[Navable] content scripts registered');
}
