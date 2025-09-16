async function sendToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) {
    return chrome.tabs.sendMessage(tab.id, payload);
  }
  throw new Error('No active tab');
}

document.getElementById('btnAnnounce').addEventListener('click', async () => {
  try {
    await sendToActiveTab({
      type: 'announce',
      text: 'Navable: popup test announcement.',
      mode: 'polite'
    });
    window.close();
  } catch (e) {
    console.error(e);
  }
});
