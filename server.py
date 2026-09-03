#!/usr/bin/env python3
"""
Local dev server with a PDF proxy endpoint and a JSON export endpoint.

Serves static files normally, and proxies PDFs via /pdf/<id>.pdf?url=<encoded>
so the browser's native PDF viewer can render any PDF regardless of CORS or
X-Frame-Options headers. If the direct URL fails (dead link, paywall, etc.),
falls back to fetching <id>.pdf from a private Cloudflare R2 bucket, if R2
credentials are configured (see _r2_client()).

Also serves /export?collection=<papers|datasets|reproductions>&id=<id>,
a thin authenticated proxy onto PocketBase that returns clean JSON (locking
fields stripped) — a curlable/scriptable alternative to the old in-browser
"Download JSON" button, which could only ever save a file for someone
already logged into the web app. See _export() for the auth/field details.

Usage:
    python3 server.py        # serves on port 8765
    python3 server.py 9000   # custom port
"""

import json
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote, quote
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

try:
    import boto3
    from botocore.exceptions import ClientError, BotoCoreError
    R2_SDK_AVAILABLE = True
except ImportError:
    # boto3 isn't part of the stdlib and isn't required to run the app
    # locally — only the R2 fallback is unavailable without it.
    R2_SDK_AVAILABLE = False

PORT = 8765

# /export picks a PocketBase per request via _resolve_pb_url() below — same
# localhost-vs-deployed rule js/api.js already applies client-side from
# window.location.hostname (see CLAUDE.md's "Backend URL" section), just
# driven by the incoming Host header instead, since server.py has no
# browser location to inspect. PB_URL is an escape hatch for the rare case
# a locally-running server.py needs to point somewhere else entirely — set
# it and it always wins over the per-request auto-detection.
PB_URL_OVERRIDE = os.environ.get('PB_URL')
LOCAL_PB_URL = 'http://localhost:8090'
REMOTE_PB_URL = 'https://repro-sign-survey-backend.fly.dev'

# Deliberately not the full set of collections PocketBase exposes (e.g. no
# check_papers, metrics, users) — export is scoped to what issue-driven
# demand actually asked for.
EXPORT_COLLECTIONS = {'papers', 'datasets', 'reproductions'}

# locked_by/locked_at are per-editor session bookkeeping, not paper/dataset/
# reproduction data — same rationale as the old dataset-confirmation
# overview's stripLockingFields(), just server-side here.
LOCKING_FIELDS = ('locked_by', 'locked_at')

_r2_client_instance = None
_r2_client_checked = False


def _r2_client():
    """Lazily builds (and caches) a boto3 S3 client configured for R2.

    Returns None if boto3 isn't installed or the required R2_* environment
    variables aren't set — callers should treat that as "R2 fallback isn't
    available" rather than an error.
    """
    global _r2_client_instance, _r2_client_checked
    if _r2_client_checked:
        return _r2_client_instance
    _r2_client_checked = True

    if not R2_SDK_AVAILABLE:
        return None

    account_id = os.environ.get('R2_ACCOUNT_ID')
    access_key = os.environ.get('R2_ACCESS_KEY_ID')
    secret_key = os.environ.get('R2_SECRET_ACCESS_KEY')
    if not (account_id and access_key and secret_key):
        return None

    _r2_client_instance = boto3.client(
        's3',
        endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name='auto',
    )
    return _r2_client_instance


def _looks_like_pdf(data):
    """Real PDFs start with the %PDF- magic header. Some sources (DOI links
    that redirect to a publisher landing page, WAF/bot-challenge responses,
    etc.) return HTTP 200/202 with HTML or an empty body instead of an
    actual PDF — urlopen doesn't treat that as an error, so we have to check
    the content ourselves."""
    return bool(data) and data.lstrip()[:5] == b'%PDF-'


def _fetch_from_r2(paper_id):
    """Fetches <paper_id>.pdf from the configured R2 bucket.

    Returns the PDF bytes, or None if R2 isn't configured or the object
    doesn't exist / can't be fetched.
    """
    client = _r2_client()
    bucket = os.environ.get('R2_BUCKET_NAME')
    if not client or not bucket:
        return None
    try:
        response = client.get_object(Bucket=bucket, Key=f'{paper_id}.pdf')
        return response['Body'].read()
    except (ClientError, BotoCoreError) as e:
        print(f'  R2 fetch failed for {paper_id}.pdf: {e}')
        return None


def _strip_locking(record):
    """Strips locking fields from a record and, recursively, from every
    record nested under it via `expand` — at any depth. A reproduction's
    expanded paper, and that paper's own further-expanded datasets/metrics
    (see the `paper.datasets,paper.metrics` double expansion below), each
    carry their own independent locks (see CLAUDE.md), so this can't stop
    at one level."""
    cleaned = {k: v for k, v in record.items() if k not in LOCKING_FIELDS}
    expand = cleaned.get('expand')
    if isinstance(expand, dict):
        cleaned['expand'] = {
            key: ([_strip_locking(r) for r in val] if isinstance(val, list) else _strip_locking(val))
            for key, val in expand.items()
        }
    return cleaned


def _clean_record(record):
    return _strip_locking(record)


def _resolve_pb_url(host_header):
    """Picks which PocketBase /export talks to for one request — same
    localhost-vs-deployed rule js/api.js already applies from
    window.location.hostname, just driven by the Host header the client
    sent this request with. An explicit PB_URL env var always overrides
    this, for the rare setup that needs it."""
    if PB_URL_OVERRIDE:
        return PB_URL_OVERRIDE
    hostname = (host_header or '').split(':')[0]
    return LOCAL_PB_URL if hostname in ('localhost', '127.0.0.1') else REMOTE_PB_URL


def _pb_request(pb_url, path, auth_header):
    """GETs a PocketBase API path, forwarding the caller's own auth header
    verbatim rather than using a service credential — so /export only ever
    sees what the requesting user's own PocketBase session already can."""
    req = Request(f'{pb_url}{path}', headers={'Authorization': auth_header})
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _pb_get_all(pb_url, collection, auth_header, expand=None):
    """Pages through every record in a collection — mirrors js/api.js's
    pbGetAll(), just server-side, so a collection that ever grows past
    PocketBase's 500-per-page ceiling still exports completely."""
    items = []
    page = 1
    while True:
        qs = f'perPage=500&page={page}'
        if expand:
            qs += f'&expand={expand}'
        data = _pb_request(pb_url, f'/api/collections/{collection}/records?{qs}', auth_header)
        items.extend(data['items'])
        if len(items) >= data['totalItems']:
            break
        page += 1
    return items


def _pb_find_one(pb_url, collection, filter_expr, auth_header, expand=None):
    """Looks up a single record by a filter expression rather than
    PocketBase's own GET-by-id (which only matches its internal id) — used
    for papers/reproductions, which /export addresses by the paper's
    public paper_id slug instead. Returns None if nothing matches."""
    qs = f'filter={quote(filter_expr)}&perPage=1'
    if expand:
        qs += f'&expand={expand}'
    data = _pb_request(pb_url, f'/api/collections/{collection}/records?{qs}', auth_header)
    items = data['items']
    return items[0] if items else None


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        # Match /pdf/<anything>.pdf?url=<encoded>
        if path.startswith('/pdf/'):
            self._proxy_pdf()
        elif path == '/export':
            self._export()
        else:
            super().do_GET()

    def _proxy_pdf(self):
        path = urlparse(self.path).path
        # /pdf/<paper_id>.pdf -> <paper_id>, used as the R2 object key
        paper_id = path[len('/pdf/'):]
        if paper_id.endswith('.pdf'):
            paper_id = paper_id[:-len('.pdf')]

        query = parse_qs(urlparse(self.path).query)
        url = query.get('url', [None])[0]

        data = None
        fetch_error = None

        if url:
            url = unquote(url)
            try:
                req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urlopen(req, timeout=30) as resp:
                    fetched = resp.read()
                if _looks_like_pdf(fetched):
                    data = fetched
                else:
                    fetch_error = f'response was not a PDF ({len(fetched)} bytes, status {resp.status})'
            except URLError as e:
                fetch_error = str(e.reason)
        else:
            fetch_error = 'missing url parameter'

        if data is None:
            print(f'  Direct PDF fetch failed ({fetch_error}) for {paper_id} — trying R2 fallback')
            data = _fetch_from_r2(paper_id)

        if data is None:
            self.send_error(502, f'Could not fetch PDF: {fetch_error} (R2 fallback also unavailable)')
            return

        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
        except BrokenPipeError:
            pass  # client disconnected before transfer completed

    def _export(self):
        """GET /export?collection=<papers|datasets|reproductions>&id=<id>

        PocketBase: picked per request from the Host header — localhost ->
        the local dev backend, anything else -> the deployed one — same
        rule js/api.js already applies client-side, so this "just works"
        whether server.py itself is running locally or deployed, with no
        env var to remember. See _resolve_pb_url().

        Auth: requires an Authorization header (the caller's own PocketBase
        token, e.g. "Bearer <token>"), forwarded as-is to PocketBase — this
        endpoint has no service credential of its own, so it can only ever
        see what the requesting user's own session already can. No token
        at all -> this handler itself returns 401. A present-but-invalid/
        expired token is NOT rejected the same way, though: PocketBase's
        list/view rules treat an unparseable token exactly like "no auth",
        which for these collections (open to any logged-in user, no
        per-record restriction) just means the rule matches nothing — a
        full-collection export silently comes back empty, and a by-id
        lookup comes back as a plain 404 "not found" even for an id that
        demonstrably exists. Confirmed directly against PocketBase, not a
        server.py bug — same as what the browser already gets from a bad
        token today, just without any of this code's own auth checks.

        id: for papers, the paper_id slug; for reproductions, the *paper's*
        paper_id (reproductions has no slug of its own — the paper it
        belongs to is expanded into the response so the slug you queried
        with is still visible on the way out); for datasets, PocketBase's
        own internal id (datasets have no slug at all). This mirrors how
        the rest of the frontend already addresses each of these.
        Omitting id exports the full collection instead of one record.
        """
        query = parse_qs(urlparse(self.path).query)
        collection = query.get('collection', [None])[0]
        record_id = query.get('id', [None])[0]

        if collection not in EXPORT_COLLECTIONS:
            self._json_error(400, f'collection must be one of: {", ".join(sorted(EXPORT_COLLECTIONS))}')
            return

        auth_header = self.headers.get('Authorization')
        if not auth_header:
            self._json_error(401, 'missing Authorization header')
            return

        # Filter-expression injection guard — every real id in this schema
        # is a plain hex/alnum string, so rejecting quotes/backslashes is
        # safe and sidesteps needing to get PocketBase's own filter-string
        # escaping exactly right.
        if record_id and ('"' in record_id or '\\' in record_id):
            self._json_error(400, 'invalid id')
            return

        pb_url = _resolve_pb_url(self.headers.get('Host'))

        try:
            if collection == 'papers':
                if record_id:
                    record = _pb_find_one(pb_url, 'papers', f'paper_id="{record_id}"', auth_header, expand='datasets,metrics')
                    if not record:
                        self._json_error(404, 'paper not found')
                        return
                    result = _clean_record(record)
                else:
                    result = [_clean_record(r) for r in _pb_get_all(pb_url, 'papers', auth_header, expand='datasets,metrics')]

            elif collection == 'reproductions':
                # Double expansion: expand the paper relation, then further
                # expand that paper's own datasets/metrics relations (PocketBase's
                # dot-notation nested expand) — so the export carries full
                # dataset/metric records inline under expand.paper.expand,
                # not just the paper's bare id references to them.
                repro_expand = 'paper.datasets,paper.metrics'
                if record_id:
                    record = _pb_find_one(pb_url, 'reproductions', f'paper.paper_id="{record_id}"', auth_header, expand=repro_expand)
                    if not record:
                        self._json_error(404, 'reproduction not found for that paper')
                        return
                    result = _clean_record(record)
                else:
                    result = [_clean_record(r) for r in _pb_get_all(pb_url, 'reproductions', auth_header, expand=repro_expand)]

            else:  # datasets
                if record_id:
                    try:
                        record = _pb_request(pb_url, f'/api/collections/datasets/records/{quote(record_id)}', auth_header)
                    except HTTPError as e:
                        if e.code == 404:
                            self._json_error(404, 'dataset not found')
                            return
                        raise
                    result = _clean_record(record)
                else:
                    result = [_clean_record(r) for r in _pb_get_all(pb_url, 'datasets', auth_header)]

        except HTTPError as e:
            # Passes through PocketBase's own status (e.g. 401 for an
            # expired/invalid token) rather than masking it as a 502.
            self._json_error(e.code, f'PocketBase error: {e.reason}')
            return
        except URLError as e:
            self._json_error(502, f'could not reach PocketBase: {e.reason}')
            return

        self._json_response(200, result)

    def _json_response(self, status, payload):
        body = json.dumps(payload, indent=2).encode('utf-8')
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except BrokenPipeError:
            pass  # client disconnected before transfer completed

    def _json_error(self, status, message):
        self._json_response(status, {'error': message})

    def end_headers(self):
        path = urlparse(self.path).path
        if path.endswith('/') or path.endswith('.html'):
            # Never let browsers cache HTML — always fetch the latest markup so
            # deploys are picked up immediately.
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        elif path.endswith('.js') or path.endswith('.css'):
            # "no-cache" means "cache it, but revalidate before reuse". The
            # browser sends If-Modified-Since and gets a cheap 304 when the
            # file is unchanged.
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f'  {self.address_string()} {fmt % args}')


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    httpd = ThreadingHTTPServer(('', port), Handler)
    print(f'Serving at http://localhost:{port}')
    print(f'PDF proxy: http://localhost:{port}/pdf/<id>.pdf?url=<encoded-url>')
    pb_url_note = PB_URL_OVERRIDE if PB_URL_OVERRIDE else f'auto-detected from Host header ({LOCAL_PB_URL} for localhost, else {REMOTE_PB_URL})'
    print(f'JSON export: http://localhost:{port}/export?collection=<papers|datasets|reproductions>&id=<id> (PocketBase: {pb_url_note})')
    if not R2_SDK_AVAILABLE:
        print('  (boto3 not installed — R2 fallback disabled; pip install -r requirements.txt to enable)')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
