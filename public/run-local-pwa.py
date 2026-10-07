from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import mimetypes
import os
import webbrowser

ROOT = Path(__file__).resolve().parent
SHELL = ROOT / "_shell.html"
mimetypes.add_type("application/manifest+json", ".webmanifest")


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        relative = unquote(urlsplit(path).path).lstrip("/")
        candidate = (ROOT / relative).resolve()
        if candidate != ROOT and ROOT not in candidate.parents:
            return str(ROOT / "__not_found__")
        if candidate.is_file():
            return str(candidate)
        # TanStack routes are handled by the client-side app router.
        if "text/html" in self.headers.get("Accept", "") and SHELL.is_file():
            return str(SHELL)
        return str(candidate)

    def log_message(self, format, *args):
        # Keep the console quiet; app requests contain no patient record data.
        pass


if not SHELL.is_file():
    raise SystemExit("The app shell is missing. Extract all files from the PWA ZIP first.")

try:
    server = ThreadingHTTPServer(("127.0.0.1", 8765), AppHandler)
except OSError as error:
    raise SystemExit("Could not start the local app because port 8765 is busy. Close another HDW CONNECT window and try again.") from error

address = f"http://localhost:{server.server_port}/"
print("HDW CONNECT is running on this PC only.")
print("Keep this window open while installing and using the app. Close it to stop the local server.")
print(f"Address: {address}")
if os.environ.get("TERMUX_VERSION"):
    print("On Android, open Chrome and enter the address above.")
else:
    webbrowser.open(address)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
