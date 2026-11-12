"""Local static server for dist/ with correct wasm MIME type, then opens the game."""
import http.server
import os
import socketserver
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import threading
import webbrowser
from functools import partial
from pathlib import Path

PORT = int(os.environ.get("PORT") or next((a for a in sys.argv[1:] if a.isdigit()), 8765))
DIST = Path(__file__).resolve().parent.parent / "dist"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".js": "text/javascript", ".json": "application/json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    socketserver.TCPServer.allow_reuse_address = True
    lan = "--lan" in sys.argv
    with socketserver.ThreadingTCPServer(("0.0.0.0" if lan else "127.0.0.1", PORT), partial(Handler, directory=str(DIST))) as httpd:
        url = f"http://127.0.0.1:{PORT}/"
        print(f"✷ CLAWD is running at {url}  (Ctrl+C to stop)")
        if lan:
            import socket
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("10.255.255.255", 1))
                ip = s.getsockname()[0]
                s.close()
            except OSError:
                ip = "<this-PC's-IP>"
            print(f"  On your phone (same Wi-Fi): http://{ip}:{PORT}/")
        if "--no-browser" not in sys.argv:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
