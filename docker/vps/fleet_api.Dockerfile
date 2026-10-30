FROM python:3.13-slim

WORKDIR /app
COPY fleet_api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY fleet_api/app.py fleet_api/fleet.py fleet_api/jobs.py fleet_api/accounts.py fleet_api/geofence.py /app/

# Localhost by default: clients on this host use 127.0.0.1:8090, browsers go through the frontend server.
ENV FLEET_API_BIND=127.0.0.1
CMD uvicorn app:app --host "$FLEET_API_BIND" --port 8090
