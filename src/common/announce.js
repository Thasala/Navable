(function () {
  var REGION_ID_POLITE = 'navable-live-region-polite';
  var REGION_ID_ASSERT = 'navable-live-region-assertive';

  function ensureRegion(id, politeness) {
    var node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', politeness);
      node.setAttribute('aria-atomic', 'true');
      Object.assign(node.style, {
        position: 'fixed',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: '0'
      });
      (document.body || document.documentElement).appendChild(node);
    }
    return node;
  }

  var throttle;
  function setText(node, text) {
    clearTimeout(throttle);
    throttle = setTimeout(function () {
      // Clear then set to ensure SRs announce repeated text
      node.textContent = '';
      setTimeout(function () { node.textContent = text; }, 20);
    }, 50);
  }

  // Expose as a function and alias .speak
  function NavableAnnounce(text, opts) {
    opts = opts || {};
    var mode = opts.mode === 'assertive' ? 'assertive' : 'polite';
    var id = mode === 'assertive' ? REGION_ID_ASSERT : REGION_ID_POLITE;
    var node = ensureRegion(id, mode);
    setText(node, text);
  }

  NavableAnnounce.speak = NavableAnnounce;
  // make it truly global in the content world
  window.NavableAnnounce = NavableAnnounce;
})();
