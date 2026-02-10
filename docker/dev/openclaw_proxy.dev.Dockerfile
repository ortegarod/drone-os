# OpenClaw Proxy (dev)
# Serves a small FastAPI app that proxies Web UI chat -> OpenClaw gateway over localhost.

FROM python:3.10-slim

WORKDIR /app

# Install python deps
COPY web_interface/backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# The proxy needs websockets in addition to the base backend reqs.
RUN pip install --no-cache-dir websockets==12.0

# Source is bind-mounted at runtime for fast iteration.

EXPOSE 3031

CMD ["python3", "/app/openclaw_proxy.py"]
