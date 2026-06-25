const PB_URL = (() => {
  const param = new URLSearchParams(window.location.search).get('backend');
  if (param === 'local')  return 'http://localhost:8090';
  if (param === 'remote') return 'https://repro-sign-survey.fly.dev';
  return window.location.hostname === 'localhost'
    ? 'http://localhost:8090'
    : 'https://repro-sign-survey.fly.dev';
})();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getToken() {
  const token  = localStorage.getItem('pb_token');
  const expiry = localStorage.getItem('pb_token_expiry');
  if (!token || !expiry || Date.now() > Number(expiry)) {
    localStorage.removeItem('pb_token');
    localStorage.removeItem('pb_user_id');
    localStorage.removeItem('pb_token_expiry');
    return null;
  }
  return token;
}
function getUserId()       { return localStorage.getItem('pb_user_id'); }
function isAuthenticated() { return !!getToken(); }

function requireAuth() {
  if (!isAuthenticated())
    window.location.href = `login.html?next=${encodeURIComponent(window.location.href)}`;
}

async function pbGet(path) {
  const res = await fetch(PB_URL + path,
    { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
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
