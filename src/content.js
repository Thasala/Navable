(function () {
  console.log('[Navable] content script loaded on', location.href);

  // marker so tests can verify injection
  let m = document.getElementById('navable-marker');
  if (!m) {
    m = document.createElement('meta');
    m.id = 'navable-marker';
    m.setAttribute('data-injected','true');
    document.documentElement.appendChild(m);
  }

  function ensureLiveRegion(){
    let r=document.getElementById('navable-live-region-polite');
    if(!r){ r=document.createElement('div'); r.id='navable-live-region-polite';
      r.setAttribute('role','status'); r.setAttribute('aria-live','polite');
      r.style.position='fixed'; r.style.bottom='8px'; r.style.right='8px';
      r.style.padding='4px 8px'; r.style.background='rgba(0,0,0,0.6)';
      r.style.color='#fff'; r.style.fontSize='12px'; r.style.zIndex='2147483647';
      document.documentElement.appendChild(r);
    } return r;
  }

  // Fallback hotkey: Alt+Shift+;
  document.addEventListener('keydown',(e)=>{
    if(e.altKey && e.shiftKey && e.key===';'){
      const r=ensureLiveRegion();
      r.textContent='Navable: test announcement (fallback hotkey).';
    }
  },{capture:true});

  // Popup → content message
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'announce') {
      const r = ensureLiveRegion();
      r.textContent = msg.text || 'Navable: announcement.';
    }
  });
})();
