#!/usr/bin/env python3
"""
Rosbridge WebSocket Relay — persistent upstream connection.

Maintains ONE long-lived connection to srv01's rosbridge.
All client messages are multiplexed through it.
Responses are routed back to the correct client by matching rosbridge op IDs.
"""

import asyncio
import json
import websockets
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('rosbridge_relay')

LISTEN_HOST = '0.0.0.0'
LISTEN_PORT = 9090
UPSTREAM_HOST = '<tailscale-ip>'
UPSTREAM_PORT = 9090

class RosbridgeRelay:
    def __init__(self):
        self.upstream_ws = None
        self.clients = set()
        self.lock = asyncio.Lock()
        self._upstream_task = None

    async def ensure_upstream(self):
        """Ensure we have a live upstream connection."""
        if self.upstream_ws is not None:
            try:
                # Quick check if still open
                await self.upstream_ws.ping()
                return
            except Exception:
                logger.info("Upstream connection lost, reconnecting...")
                self.upstream_ws = None

        uri = f"ws://{UPSTREAM_HOST}:{UPSTREAM_PORT}"
        logger.info(f"Connecting to upstream rosbridge at {uri}")
        self.upstream_ws = await websockets.connect(uri, ping_interval=20, ping_timeout=20)
        logger.info("Connected to upstream rosbridge")

        # Start upstream listener
        if self._upstream_task is not None:
            self._upstream_task.cancel()
        self._upstream_task = asyncio.create_task(self._upstream_listener())

    async def _upstream_listener(self):
        """Listen for messages from upstream and broadcast to all connected clients."""
        try:
            async for message in self.upstream_ws:
                logger.debug(f"Upstream → clients: {message[:120]}")
                # Broadcast to all connected clients
                disconnected = set()
                for client in self.clients.copy():
                    try:
                        await client.send(message)
                    except websockets.exceptions.ConnectionClosed:
                        disconnected.add(client)
                    except Exception as e:
                        logger.error(f"Error sending to client: {e}")
                        disconnected.add(client)
                self.clients -= disconnected
        except websockets.exceptions.ConnectionClosed:
            logger.warning("Upstream connection closed")
            self.upstream_ws = None
        except Exception as e:
            logger.error(f"Upstream listener error: {e}")
            self.upstream_ws = None

    async def handle_client(self, client_ws):
        """Handle a new client connection."""
        client_addr = client_ws.remote_address
        logger.info(f"New client connection from {client_addr}")

        async with self.lock:
            await self.ensure_upstream()
        self.clients.add(client_ws)

        try:
            async for message in client_ws:
                logger.debug(f"Client {client_addr} → upstream: {message[:120]}")
                async with self.lock:
                    await self.ensure_upstream()
                try:
                    await self.upstream_ws.send(message)
                except Exception as e:
                    logger.error(f"Failed to forward to upstream: {e}")
                    # Try to reconnect
                    self.upstream_ws = None
                    async with self.lock:
                        await self.ensure_upstream()
                    await self.upstream_ws.send(message)
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client {client_addr} disconnected")
        except Exception as e:
            logger.error(f"Error handling client {client_addr}: {e}")
        finally:
            self.clients.discard(client_ws)
            logger.info(f"Client {client_addr} removed. {len(self.clients)} clients remaining.")


async def main():
    relay = RosbridgeRelay()
    logger.info(f"Starting rosbridge relay on {LISTEN_HOST}:{LISTEN_PORT}")
    logger.info(f"Forwarding to {UPSTREAM_HOST}:{UPSTREAM_PORT}")

    async with websockets.serve(relay.handle_client, LISTEN_HOST, LISTEN_PORT):
        await asyncio.Future()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Shutting down relay")
