FROM python:3.13-slim

WORKDIR /app
COPY plugins/search/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY sdk/python /sdk
RUN pip install --no-cache-dir /sdk
COPY plugins/search/service.py plugins/search/droneos-plugin.json /app/
COPY plugins/search/ui /app/ui

# Search plugin. Localhost only: operators reach it through /api/v1/plugins/search.
CMD uvicorn service:app --host 127.0.0.1 --port 8093
