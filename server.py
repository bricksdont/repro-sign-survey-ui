#!/usr/bin/env python3
"""
Local dev server with a PDF proxy endpoint.

Serves static files normally, and proxies PDFs via /proxy-pdf?url=<encoded>
so that pdf.js can render any PDF regardless of CORS or X-Frame-Options headers.

Usage:
    python3 server.py        # serves on port 8765
    python3 server.py 9000   # custom port
"""

import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from urllib.request import urlopen, Request
from urllib.error import URLError

PORT = 8765

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Match /pdf/<anything>.pdf?url=<encoded>
        if urlparse(self.path).path.startswith('/pdf/'):
            self._proxy_pdf()
        else:
            super().do_GET()

    def _proxy_pdf(self):
        query = parse_qs(urlparse(self.path).query)
        url = query.get('url', [None])[0]
        if not url:
            self.send_error(400, 'Missing url parameter')
            return
        url = unquote(url)
        try:
            req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urlopen(req, timeout=30) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
        except URLError as e:
            self.send_error(502, f'Could not fetch PDF: {e.reason}')
        except BrokenPipeError:
            pass  # client disconnected before transfer completed

    def log_message(self, fmt, *args):
        print(f'  {self.address_string()} {fmt % args}')


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    httpd = ThreadingHTTPServer(('', port), Handler)
    print(f'Serving at http://localhost:{port}')
    print(f'PDF proxy: http://localhost:{port}/proxy-pdf?url=<encoded-url>')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
