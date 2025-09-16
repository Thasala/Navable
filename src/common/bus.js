export async function requestToBackground(type, payload, { retries = 2 } = {}) {
  const requestId = crypto.randomUUID();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'bus:request',
        requestId,
        kind: type,
        payload
      });
      return res;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
  }
}
