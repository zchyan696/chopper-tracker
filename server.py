from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import os, tempfile, uuid, threading, json

PORT = 7270
TEMP = tempfile.gettempdir()


class Handler(BaseHTTPRequestHandler):

    def cors(self, code, ctype, length=0):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        if length:
            self.send_header('Content-Length', str(length))
        self.end_headers()

    def do_OPTIONS(self):
        self.cors(200, 'text/plain')

    def do_GET(self):
        parsed = urlparse(self.path)
        qs     = parse_qs(parsed.query)

        # ── ping ─────────────────────────────────────────────────────────────
        if parsed.path == '/ping':
            body = b'ok'
            self.cors(200, 'text/plain', len(body))
            self.wfile.write(body)

        # ── download YouTube audio ────────────────────────────────────────────
        elif parsed.path == '/download':
            url = qs.get('url', [''])[0].strip()
            if not url:
                self._json_err(400, 'URL necessaria')
                return

            try:
                from pytubefix import YouTube
            except ImportError:
                self._json_err(500, 'pytubefix nao instalado. Execute instalar.bat')
                return

            try:
                yt     = YouTube(url)
                stream = yt.streams.filter(only_audio=True).order_by('abr').last()
                if not stream:
                    self._json_err(500, 'Nenhum stream de audio encontrado')
                    return

                ext   = stream.subtype          # 'webm' ou 'mp4'
                fname = f'smp_{uuid.uuid4().hex[:10]}.{ext}'
                stream.download(output_path=TEMP, filename=fname)
                filepath = os.path.join(TEMP, fname)

            except Exception as e:
                self._json_err(500, str(e)[:300])
                return

            ctype = {'webm': 'audio/webm', 'mp4': 'audio/mp4',
                     'ogg':  'audio/ogg',  'mp3': 'audio/mpeg'}.get(ext, 'audio/mpeg')

            with open(filepath, 'rb') as f:
                data = f.read()

            self.cors(200, ctype, len(data))
            self.wfile.write(data)

            try: os.remove(filepath)
            except: pass

        else:
            body = b'not found'
            self.cors(404, 'text/plain', len(body))
            self.wfile.write(body)

    def do_POST(self):
        if self.path == '/shutdown':
            body = b'ok'
            self.cors(200, 'text/plain', len(body))
            self.wfile.write(body)
            threading.Timer(0.3, lambda: os._exit(0)).start()

    def _json_err(self, code, msg):
        body = json.dumps({'error': msg}).encode()
        self.cors(code, 'application/json', len(body))
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # silencioso


if __name__ == '__main__':
    srv = HTTPServer(('127.0.0.1', PORT), Handler)
    print(f'Sampler server em localhost:{PORT}')
    srv.serve_forever()
