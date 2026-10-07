from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen
import json
import os
import re
import sys
import webbrowser

HOST = "127.0.0.1"
PORT = 8765
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36"

BUNKR_HOST_RE = re.compile(r"^(?:[a-z0-9-]+\.)?bunkr\.[a-z0-9-]{2,12}$", re.I)
CDN_HOST_RE = re.compile(r"(^|\.)cdn\.cr$", re.I)
LEGACY_DOWNLOAD_RE = re.compile(r"^https://dl\.bunkr\.[a-z0-9.-]+/file/\d+(?:[/?#]|$)", re.I)
ITEM_PATH_RE = re.compile(r"^/(?:f|i|v)/[^/?#]+(?:[/?#]|$)", re.I)


def is_bunkr_page(url):
    return url.scheme == "https" and bool(BUNKR_HOST_RE.match(url.hostname or ""))


def is_item_page(url):
    return is_bunkr_page(url) and bool(ITEM_PATH_RE.match(url.path or ""))


def is_allowed_cdn(url):
    return url.scheme == "https" and bool(CDN_HOST_RE.search(url.hostname or ""))


def is_allowed_media(url, raw):
    if LEGACY_DOWNLOAD_RE.match(raw):
        return True
    query = parse_qs(url.query)
    return is_allowed_cdn(url) and bool(query.get("token")) and bool(query.get("ex"))


def unescape_inline(value):
    return str(value or "").replace("\\/", "/")


def extract_signed_sources(html):
    cdn = re.search(r'jsCDN\s*=\s*"([^"]+)"', html, re.I)
    sign = re.search(r'signUrl\s*=\s*"([^"]+)"', html, re.I)
    js_type = re.search(r'jsType\s*=\s*"([^"]+)"', html, re.I)
    slug = re.search(r'jsSlug\s*=\s*"([^"]+)"', html, re.I)
    if not cdn or not sign:
        return None
    return {
        "cdn_url": unescape_inline(cdn.group(1)),
        "sign_url": unescape_inline(sign.group(1)),
        "content_type": unescape_inline(js_type.group(1) if js_type else ""),
        "title": unescape_inline(slug.group(1) if slug else ""),
    }


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.end_headers()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/page":
            return self.handle_api(parsed, head_only=True)
        return super().do_HEAD()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/page":
            return self.handle_api(parsed, head_only=False)
        return super().do_GET()

    def handle_api(self, parsed, head_only=False):
        query = parse_qs(parsed.query)
        target = (query.get("url") or [""])[0]
        mode = (query.get("mode") or ["page"])[0]

        try:
            target_url = urlparse(target)
        except Exception:
            return self.fail(400, "URL invalida")

        if not target:
            return self.fail(400, "URL ausente")

        if mode == "resolve":
            if head_only:
                return self.fail(405, "Resolve aceita apenas GET")
            if not is_item_page(target_url):
                return self.fail(403, "Resolve aceita apenas paginas de item do Bunkr")
            return self.resolve_media(target)

        if mode == "media":
            if not is_allowed_media(target_url, target):
                return self.fail(403, "Proxy de midia aceita apenas URL CDN assinada")
            return self.proxy_media(target, head_only=head_only)

        if not is_bunkr_page(target_url):
            return self.fail(403, "Host nao permitido")
        return self.proxy_page(target, head_only=head_only)

    def fetch(self, target, headers=None, method="GET"):
        req = Request(target, method=method, headers=headers or {})
        return urlopen(req, timeout=30)

    def proxy_page(self, target, head_only=False):
        try:
            headers = {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            }
            with self.fetch(target, headers=headers, method="HEAD" if head_only else "GET") as response:
                ctype = response.headers.get("Content-Type", "application/octet-stream")
                body = b"" if head_only else response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", ctype)
                if not head_only:
                    self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("X-Source-Url", response.geturl())
                self.end_headers()
                if body:
                    self.wfile.write(body)
        except Exception as exc:
            self.fail(502, f"Falha ao consultar a pagina: {exc}")

    def resolve_media(self, target):
        try:
            page_headers = {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            }
            with self.fetch(target, headers=page_headers) as response:
                html = response.read().decode("utf-8", "replace")
                final_page = response.geturl()

            source = extract_signed_sources(html)
            if not source:
                return self.fail(502, "jsCDN/signUrl nao encontrados na pagina")

            cdn = urlparse(source["cdn_url"])
            sign = urlparse(source["sign_url"])
            if not is_allowed_cdn(cdn) or not is_allowed_cdn(sign):
                return self.fail(403, "Host CDN/assinatura nao confiavel")

            sign_query = urlencode({"path": cdn.path})
            separator = "&" if sign.query else "?"
            sign_target = source["sign_url"] + separator + sign_query
            sign_headers = {
                "User-Agent": USER_AGENT,
                "Accept": "application/json,*/*;q=0.1",
                "Referer": final_page,
            }

            with self.fetch(sign_target, headers=sign_headers) as response:
                payload = json.loads(response.read().decode("utf-8", "replace"))

            if "token" not in payload or "ex" not in payload:
                return self.fail(502, "Resposta de assinatura sem token/ex")

            cdn_query = urlencode({"token": str(payload["token"]), "ex": str(payload["ex"])})
            signed_url = cdn._replace(query=cdn_query).geturl()
            result = {
                "url": signed_url,
                "contentType": source["content_type"],
                "title": source["title"],
                "sourceUrl": final_page,
            }
            data = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            self.fail(502, f"Falha ao resolver a midia: {exc}")

    def proxy_media(self, target, head_only=False):
        try:
            headers = {
                "User-Agent": USER_AGENT,
                "Accept": "video/*,application/octet-stream;q=0.9,*/*;q=0.1",
            }
            if self.headers.get("Range"):
                headers["Range"] = self.headers["Range"]

            with self.fetch(target, headers=headers, method="HEAD" if head_only else "GET") as response:
                self.send_response(response.status)
                for name in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"):
                    value = response.headers.get(name)
                    if value:
                        self.send_header(name, value)
                self.send_header("Content-Disposition", "inline")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("X-Source-Url", response.geturl())
                self.end_headers()

                if not head_only:
                    while True:
                        chunk = response.read(1024 * 256)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
        except Exception as exc:
            self.fail(502, f"Falha ao consultar a midia: {exc}")

    def fail(self, status, message):
        data = message.encode("utf-8", "replace")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if self.command != "HEAD":
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
