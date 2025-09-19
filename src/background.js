// Send message to the active tab
async function sendToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return chrome.tabs.sendMessage(tab.id, payload);
}

// Keyboard command → announce
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'announce-test') {
    try {
      await sendToActiveTab({
        type: 'announce',
        text: 'Navable is ready. Press H for help in later phases.',
        mode: 'polite'
      });
    } catch (err) {
      console.warn('[Navable] announce-test failed', err);
    }
  }
});
