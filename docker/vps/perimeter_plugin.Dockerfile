FROM python:3.13-slim

WORKDIR /app
COPY plugins/perimeter/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY sdk/python /sdk
RUN pip install --no-cache-dir /sdk
COPY plugins/perimeter/service.py plugins/perimeter/droneos-plugin.json /app/
COPY plugins/perimeter/ui /app/ui

# Fence check plugin. Localhost only: operators reach it through /api/v1/plugins/perimeter.
CMD uvicorn service:app --host 127.0.0.1 --port 8095
