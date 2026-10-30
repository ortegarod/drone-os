FROM python:3.13-slim

WORKDIR /app
COPY dispatch/requirements.txt /app/dispatch/requirements.txt
RUN pip install --no-cache-dir -r dispatch/requirements.txt
# droneos client: the only way these services reach the drones (through the fleet API)
COPY sdk/python /tmp/droneos-sdk
RUN pip install --no-cache-dir /tmp/droneos-sdk && rm -rf /tmp/droneos-sdk
COPY dispatch/ /app/dispatch/

CMD ["python3", "dispatch/bridge.py"]
