FROM python:3.13-slim

WORKDIR /app
COPY plugins/patrol/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY sdk/python /sdk
RUN pip install --no-cache-dir /sdk
COPY plugins/patrol/service.py plugins/patrol/recorder.py plugins/patrol/droneos-plugin.json /app/
COPY plugins/patrol/ui /app/ui

# Localhost only: operators reach it through the fleet API's /api/v1/plugins/patrol proxy.
CMD uvicorn service:app --host 127.0.0.1 --port 8091
