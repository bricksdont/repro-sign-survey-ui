#!/usr/bin/env python3
"""
Local dev server with a PDF proxy endpoint.

Serves static files normally, and proxies PDFs via /pdf/<id>.pdf?url=<encoded>
so the browser's native PDF viewer can render any PDF regardless of CORS or
X-Frame-Options headers. If the direct URL fails (dead link, paywall, etc.),
falls back to fetching <id>.pdf from a private Cloudflare R2 bucket, if R2
credentials are configured (see _r2_client()).

Usage:
    python3 server.py        # serves on port 8765
    python3 server.py 9000   # custom port
"""

import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from urllib.request import urlopen, Request
from urllib.error import URLError

try:
    import boto3
    from botocore.exceptions import ClientError, BotoCoreError
    R2_SDK_AVAILABLE = True
except ImportError:
    # boto3 isn't part of the stdlib and isn't required to run the app
    # locally — only the R2 fallback is unavailable without it.
    R2_SDK_AVAILABLE = False

PORT = 8765

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


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Match /pdf/<anything>.pdf?url=<encoded>
        if urlparse(self.path).path.startswith('/pdf/'):
            self._proxy_pdf()
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
                    data = resp.read()
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
    if not R2_SDK_AVAILABLE:
        print('  (boto3 not installed — R2 fallback disabled; pip install -r requirements.txt to enable)')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
