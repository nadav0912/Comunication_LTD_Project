'use strict';

// Tiny fetch wrapper attached to window.api (plan A7 — plain <script>, no modules). Every request
// is same-origin with credentials so the session cookie rides along. Server errors surface as a
// thrown Error carrying { status, details } for the page to render.
(function () {
  async function request(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { error: text }; }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status}).`);
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return data;
  }

  window.api = {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
    del: (url) => request('DELETE', url),
  };
})();
