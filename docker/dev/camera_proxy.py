#!/usr/bin/env python3
"""
Camera MJPEG Stream Proxy
Relays camera stream from srv01 to VPS
"""

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote
import requests
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('camera_proxy')

LISTEN_HOST = '0.0.0.0'
LISTEN_PORT = 8080
UPSTREAM_HOST = '<tailscale-ip>'  # srv01 Tailscale IP
UPSTREAM_PORT = 8080
CONNECT_TIMEOUT_S = 5
READ_TIMEOUT_S = 15

class CameraProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        logger.info(f"{self.address_string()} - {format % args}")
    
    def do_GET(self):
        # Decode URL-encoded path to avoid double-encoding (e.g. %2F -> /)
        # web_video_server requires raw topic names, not URL-encoded
        decoded_path = unquote(self.path)
        upstream_url = f"http://{UPSTREAM_HOST}:{UPSTREAM_PORT}{decoded_path}"
        logger.info(f"Proxying request to {upstream_url}")
        
        response = None
        try:
            # Stream response from upstream with finite read timeout to prevent hung sockets
            response = requests.get(
                upstream_url,
                stream=True,
                timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
            )

            # Forward status and headers
            self.send_response(response.status_code)
            for header, value in response.headers.items():
                if header.lower() not in ['transfer-encoding', 'connection']:
                    self.send_header(header, value)
            self.end_headers()

            # Stream body chunks — flush after each to push MJPEG frames immediately
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    self.wfile.write(chunk)
                    self.wfile.flush()

        except (BrokenPipeError, ConnectionResetError):
            # Client disconnected mid-stream — normal for browser camera tab switches
            logger.debug(f"Client disconnected from {decoded_path}")
            return

        except requests.RequestException as e:
            logger.error(f"Error proxying request: {e}")
            self.send_error(502, f"Bad Gateway: {e}")

        finally:
            if response is not None:
                response.close()

if __name__ == '__main__':
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), CameraProxyHandler)
    logger.info(f"Camera proxy listening on {LISTEN_HOST}:{LISTEN_PORT} (threaded)")
    logger.info(f"Forwarding to {UPSTREAM_HOST}:{UPSTREAM_PORT}")
    server.serve_forever()
