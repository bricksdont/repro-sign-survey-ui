const PB_URL = 'http://localhost:8090';

function getToken()        { return sessionStorage.getItem('pb_token'); }
function getUserId()       { return sessionStorage.getItem('pb_user_id'); }
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
