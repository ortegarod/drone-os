FROM python:3.13-slim

WORKDIR /app
COPY plugins/inspect/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY sdk/python /sdk
RUN pip install --no-cache-dir /sdk
COPY plugins/inspect/service.py plugins/inspect/droneos-plugin.json /app/
COPY plugins/inspect/ui /app/ui

# Example plugin. Localhost only: operators reach it through /api/v1/plugins/inspect.
CMD uvicorn service:app --host 127.0.0.1 --port 8092
