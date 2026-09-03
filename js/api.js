const PB_URL = (() => {
  const param = new URLSearchParams(window.location.search).get('backend');
  // Persist an explicit override so it survives redirects and page navigation
  if (param === 'local' || param === 'remote') localStorage.setItem('pb_backend', param);
  const stored = localStorage.getItem('pb_backend');
  if (stored === 'local')  return 'http://localhost:8090';
  if (stored === 'remote') return 'https://repro-sign-survey-backend.fly.dev';
  return window.location.hostname === 'localhost'
    ? 'http://localhost:8090'
    : 'https://repro-sign-survey-backend.fly.dev';
})();

// Matches the backend's actual PocketBase authToken.duration (432000s = 5
// days on the users collection) — previously 24h, which discarded still-
// valid sessions early and forced a relogin on nearly every once-a-day visit
// since this window doesn't slide with activity, only resets on login.
const SESSION_TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

function getToken() {
  const token  = localStorage.getItem('pb_token');
  const expiry = localStorage.getItem('pb_token_expiry');
  if (!token || !expiry || Date.now() > Number(expiry)) {
    logout();
    return null;
  }
  return token;
}
function getUserId()       { return localStorage.getItem('pb_user_id'); }
function getEmail()        { return localStorage.getItem('pb_email'); }
function isAuthenticated() { return !!getToken(); }
function logout() {
  ['pb_token', 'pb_user_id', 'pb_token_expiry', 'pb_email'].forEach(k => localStorage.removeItem(k));
}

function requireAuth() {
  if (!isAuthenticated())
    window.location.href = `login.html?next=${encodeURIComponent(window.location.href)}`;
}

const REQUEST_TIMEOUT_MS = 10000; // catches both an unreachable backend (fetch rejects immediately) and one that hangs without responding

// fetch() only rejects on network-level failures (backend unreachable, DNS
// failure) — it does NOT reject on HTTP error statuses, those still resolve
// normally with res.ok = false. Wrapping every request in this lets pbGet/
// pbPatch convert that rejection into a normal failure their callers already
// know how to handle, instead of an uncaught promise rejection that silently
// aborts whatever was awaiting it (e.g. leaving an autosave indicator stuck
// on "Saving…" forever).
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function pbGet(path) {
  let res;
  try {
    res = await fetchWithTimeout(PB_URL + path,
      { headers: { Authorization: `Bearer ${getToken()}` } });
  } catch (err) {
    throw new Error(`GET ${path} → ${err.name === 'AbortError' ? 'timed out' : 'network error'}`);
  }
  if (res.status === 401) { logout(); requireAuth(); return null; }
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function pbGetAll(collection, extraParams = '') {
  const perPage = 500;
  let page = 1;
  let all = [];
  while (true) {
    const result = await pbGet(
      `/api/collections/${collection}/records?perPage=${perPage}&page=${page}${extraParams}`
    );
    if (!result) return all;
    all = all.concat(result.items);
    if (all.length >= result.totalItems) break;
    page++;
  }
  return all;
}

async function pbPatch(path, body) {
  let res;
  try {
    res = await fetchWithTimeout(PB_URL + path, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 0, data: null };
  }
  return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
}

// ---- JSON export ------------------------------------------------------------
// server.py's own /export route (same origin as the current page — deliberately
// NOT PB_URL, which points at PocketBase directly) proxies PocketBase with
// locking fields stripped. It requires the caller's own token as a header,
// which a plain <a href> can never attach — every "Download JSON" button
// calls this instead, mirroring the old dataset-confirmation-overview.js's
// Blob + <a download> pattern, just fetching from /export instead of doing
// the PocketBase call directly.
async function downloadExport(collection, id) {
  const params = new URLSearchParams({ collection });
  if (id) params.set('id', id);
  const res = await fetch(`/export?${params.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Export failed (${res.status})`);
  }
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `${collection}${id ? `-${id}` : ''}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

// ---- OAuth2 (Slack, etc.) --------------------------------------------------
// PocketBase OAuth2; the flow is:
//   1. startOAuth2()   — fetch the provider's authURL, stash the
//                        bits we need to finish the exchange, redirect to it.
//   2. provider sends the browser back to oauth-redirect.html?state=…&code=…
//   3. completeOAuth2() — verify state, POST the code, store the session.

// Absolute URL the provider redirects back to. Must be whitelisted in the
// Slack app config.
function oauthRedirectURL() {
  return new URL('oauth-redirect.html', window.location.href).href;
}

// Sanitize a post-login `next` destination to prevent open redirects: only
// same-origin targets are allowed; anything else falls back to `index.html`.
function sameOriginNext(next, fallback = 'index.html') {
  if (!next) return fallback;
  try {
    const url = new URL(next, window.location.href);
    return url.origin === window.location.origin ? url.href : fallback;
  } catch {
    return fallback;
  }
}

// List the OAuth2 providers registered on the backend (each has name/state/
// codeVerifier/authURL). Slack lives in the generic `oidc` slot.
async function listOAuth2Providers() {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-methods`);
  if (!res.ok) throw new Error('Cannot load sign-in methods from the backend.');
  const methods = await res.json();
  return methods.oauth2?.providers || [];
}

async function startOAuth2(provider, next = 'index.html') {
  const providers = await listOAuth2Providers();
  const p = providers.find(x => x.name === provider);
  if (!p) throw new Error(`"${provider}" sign-in is not enabled on the backend.`);

  const redirectURL = oauthRedirectURL();
  // sessionStorage survives the same-tab redirect out to Slack and back.
  sessionStorage.setItem('pb_oauth_provider', p.name);
  sessionStorage.setItem('pb_oauth_state', p.state);
  sessionStorage.setItem('pb_oauth_verifier', p.codeVerifier);
  sessionStorage.setItem('pb_oauth_redirect', redirectURL);
  sessionStorage.setItem('pb_oauth_next', next);

  // authURL ends with `redirect_uri=`; append our (encoded) callback URL.
  window.location.href = p.authURL + encodeURIComponent(redirectURL);
}

async function completeOAuth2() {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error');
  if (error) {
    const desc = url.searchParams.get('error_description');
    throw new Error(`Sign-in failed: ${desc || error}`);
  }
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code) throw new Error('Missing authorization response from the provider.');

  if (state !== sessionStorage.getItem('pb_oauth_state'))
    throw new Error('Sign-in state mismatch — please try again.');

  const provider     = sessionStorage.getItem('pb_oauth_provider');
  const codeVerifier = sessionStorage.getItem('pb_oauth_verifier');
  const redirectURL  = sessionStorage.getItem('pb_oauth_redirect');
  const next         = sameOriginNext(sessionStorage.getItem('pb_oauth_next'));

  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-oauth2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, code, codeVerifier, redirectURL }),
  });
  if (!res.ok) throw new Error('Could not complete sign-in.');
  const { token, record } = await res.json();

  localStorage.setItem('pb_token', token);
  localStorage.setItem('pb_user_id', record.id);
  localStorage.setItem('pb_token_expiry', String(Date.now() + SESSION_TTL_MS));
  localStorage.setItem('pb_email', record.email || '');

  ['pb_oauth_provider', 'pb_oauth_state', 'pb_oauth_verifier', 'pb_oauth_redirect', 'pb_oauth_next']
    .forEach(k => sessionStorage.removeItem(k));

  return next;
}
