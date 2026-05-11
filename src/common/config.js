(function (root) {
  if (!root || root.NavableConfig) return;

  // Replace this with your Render HTTPS URL before building a production demo.
  var DEFAULT_BACKEND_BASE_URL = 'https://navable.onrender.com';

  function normalizeBaseUrl(value) {
    var url = String(value || '').trim().replace(/\/+$/, '');
    if (!url) return DEFAULT_BACKEND_BASE_URL;
    return url;
  }

  function getBackendBaseUrl() {
    var override = root.__NAVABLE_CONFIG__ && root.__NAVABLE_CONFIG__.backendBaseUrl;
    return normalizeBaseUrl(override || DEFAULT_BACKEND_BASE_URL);
  }

  function buildApiUrl(path) {
    var normalizedPath = String(path || '');
    if (!normalizedPath.startsWith('/')) normalizedPath = '/' + normalizedPath;
    return getBackendBaseUrl() + normalizedPath;
  }

  root.NavableConfig = {
    DEFAULT_BACKEND_BASE_URL: DEFAULT_BACKEND_BASE_URL,
    getBackendBaseUrl: getBackendBaseUrl,
    buildApiUrl: buildApiUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
