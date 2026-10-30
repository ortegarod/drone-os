#!/usr/bin/env python3
"""
Camera MJPEG Stream Proxy
Relays camera stream from the sim host to the VPS
"""

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote
import requests
import urllib3
import logging
import os
import time
import sys

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('camera_proxy')

# Localhost by default: browsers reach it through the frontend server (/camera).
LISTEN_HOST = os.environ.get('CAMERA_PROXY_BIND', '127.0.0.1')
LISTEN_PORT = int(os.environ.get('CAMERA_PROXY_PORT', '8080'))
# Where web_video_server runs (the sim host or the drone). Set in docker/vps/.env.
UPSTREAM_HOST = os.environ['CAMERA_UPSTREAM_HOST']
UPSTREAM_PORT = int(os.environ.get('CAMERA_UPSTREAM_PORT', '8080'))
CONNECT_TIMEOUT_S = 5
READ_TIMEOUT_S = 15
RESUME_DELAY_S = 1
MAX_RESUMES = 10  # consecutive failed resumes before giving up (client may be gone)

class CameraProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        logger.info(f"{self.address_string()} - {format % args}")
    
    def do_GET(self):
        # Decode URL-encoded path to avoid double-encoding (e.g. %2F -> /)
        # web_video_server requires raw topic names, not URL-encoded
        decoded_path = unquote(self.path)
        upstream_url = f"http://{UPSTREAM_HOST}:{UPSTREAM_PORT}{decoded_path}"
        logger.info(f"Proxying request to {upstream_url}")
        
        headers_sent = False
        failures = 0
        while failures <= MAX_RESUMES:
            response = None
            try:
                # Finite read timeout so a stalled upstream can't hang the socket forever
                response = requests.get(
                    upstream_url,
                    stream=True,
                    timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
                )

                if not headers_sent:
                    self.send_response(response.status_code)
                    for header, value in response.headers.items():
                        if header.lower() not in ['transfer-encoding', 'connection']:
                            self.send_header(header, value)
                    self.end_headers()
                    headers_sent = True

                # read1 returns whatever has arrived instead of waiting for a full buffer,
                # so each MJPEG frame goes out as soon as it lands
                while True:
                    chunk = response.raw.read1(65536)
                    if not chunk:
                        return  # upstream ended cleanly
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    failures = 0

            except (BrokenPipeError, ConnectionResetError):
                # Client disconnected (tab switch, closed page)
                logger.debug(f"Client disconnected from {decoded_path}")
                return

            except (requests.RequestException, urllib3.exceptions.HTTPError) as e:
                if not headers_sent:
                    logger.error(f"Error proxying request: {e}")
                    self.send_error(502, f"Bad Gateway: {e}")
                    return
                # Upstream stalled mid-stream (sim under load). Resume on a new upstream
                # connection inside the same response; the MJPEG boundary is unchanged,
                # so the browser keeps playing.
                logger.warning(f"Upstream stalled, resuming {decoded_path}: {e}")
                failures += 1
                time.sleep(RESUME_DELAY_S)

            finally:
                if response is not None:
                    response.close()

if __name__ == '__main__':
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), CameraProxyHandler)
    logger.info(f"Camera proxy listening on {LISTEN_HOST}:{LISTEN_PORT} (threaded)")
    logger.info(f"Forwarding to {UPSTREAM_HOST}:{UPSTREAM_PORT}")
    server.serve_forever()
