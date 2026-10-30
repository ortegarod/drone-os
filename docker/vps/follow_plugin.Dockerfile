FROM python:3.13-slim

WORKDIR /app
COPY plugins/follow/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY sdk/python /sdk
RUN pip install --no-cache-dir /sdk
COPY plugins/follow/service.py plugins/follow/droneos-plugin.json /app/
COPY plugins/follow/ui /app/ui

# Follow plugin. Localhost only: operators reach it through /api/v1/plugins/follow.
CMD uvicorn service:app --host 127.0.0.1 --port 8094
