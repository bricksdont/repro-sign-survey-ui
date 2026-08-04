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

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

async function pbGet(path) {
  const res = await fetch(PB_URL + path,
    { headers: { Authorization: `Bearer ${getToken()}` } });
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

// Populates the #version-badge element (markup: <a id="version-badge"><img
// class="version-badge-icon">...<span id="version-badge-text">...) from
// package.json, fetched fresh every page load — a quick visual check that
// you're not looking at a stale cached page. No-ops if the page doesn't
// have the markup.
function initVersionBadge() {
  const badge = document.getElementById('version-badge');
  if (!badge) return;
  fetch('package.json').then(r => r.json()).then(pkg => {
    document.getElementById('version-badge-text').textContent = `v${pkg.version}`;
    badge.href = `https://github.com/bricksdont/repro-sign-survey-ui/releases/tag/v${pkg.version}`;
    badge.target = '_blank';
    badge.rel = 'noopener noreferrer';
    badge.classList.remove('hidden');
  }).catch(() => {}); // decorative — silently do nothing if unavailable
}

async function pbPatch(path, body) {
  const res = await fetch(PB_URL + path, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
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
