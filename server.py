from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
import os
import sys
import webbrowser

HOST = "127.0.0.1"
PORT = 8765
ALLOWED_SUFFIXES = ("bunkr.cr", "bunkr.pk", "bunkr.si", "bunkr.la")


def allowed_host(host):
    host = (host or "").lower().strip(".")
    if host == "dl.bunkr.cr":
        return True
    return any(host == suffix or host.endswith("." + suffix) for suffix in ALLOWED_SUFFIXES)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/page":
            return self.proxy_page(parsed)
        return super().do_GET()

    def proxy_page(self, parsed):
        query = parse_qs(parsed.query)
        target = (query.get("url") or [""])[0]
        try:
            u = urlparse(target)
        except Exception:
            return self.fail(400, "URL invalida")

        if u.scheme != "https" or not allowed_host(u.hostname):
            return self.fail(403, "Host nao permitido")

        try:
            req = Request(
                target,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,video/*;q=0.9,*/*;q=0.8",
                },
            )
            with urlopen(req, timeout=30) as r:
                body = r.read()
                ctype = r.headers.get("Content-Type", "application/octet-stream")
                final_url = r.geturl()
                self.send_response(r.status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("X-Source-Url", final_url)
                self.end_headers()
                self.wfile.write(body)
        except Exception as exc:
            self.fail(502, f"Falha ao consultar a pagina: {exc}")

    def fail(self, status, message):
        data = message.encode("utf-8", "replace")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    url = f"http://{HOST}:{PORT}/"
    print(f"Teste Tesoura local: {url}")
    print("Feche esta janela para encerrar.")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
